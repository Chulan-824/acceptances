package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	schema "github.com/Chulan-824/acceptances/db"
	"github.com/go-sql-driver/mysql"
)

// OpenMySQL owns both the database lease and the local directory lock. Recovery
// cannot remove in-flight files even if the MySQL lease connection disappears.
func OpenMySQL(dir, dsn string) (*Server, error) {
	db, err := connectMySQL(dsn)
	if err != nil {
		return nil, err
	}
	s := &Server{db: db, mysql: true}
	s.dir, err = filepath.Abs(dir)
	if err == nil {
		err = s.acquireMySQLLease(context.Background())
	}
	if err == nil {
		err = s.migrateMySQL(context.Background())
	}
	if err == nil {
		err = s.initializeFileArchive(context.Background())
	}
	if err == nil && !s.databaseFiles() {
		err = s.bootstrapEmptyFiles(context.Background())
	}
	if err == nil && !s.databaseFiles() {
		s.directory, err = lockArchiveDirectory(s.dir)
		if err == nil {
			err = s.bindMySQLDirectory(false)
		}
	}
	if err == nil && !s.databaseFiles() {
		for _, name := range []string{"evidence", "deliveries", "documents"} {
			if err = os.MkdirAll(filepath.Join(s.dir, name), 0700); err != nil {
				break
			}
		}
	}
	if err == nil {
		if s.databaseFiles() {
			s.directory = &archiveDirectory{refs: 1}
			// A retained binding is still checked, but an empty local directory
			// is valid after restoring a complete database-only archive.
			if _, statErr := os.Stat(filepath.Join(s.dir, ".mysql-storage.json")); statErr == nil {
				err = s.bindMySQLDirectory(false)
			} else if !errors.Is(statErr, os.ErrNotExist) {
				err = statErr
			}
		} else {
			s.artifacts = &deliveryArtifacts{db: db, dir: s.dir, mysql: true}
		}
	}
	if err == nil {
		err = s.cleanupOrphans()
	}
	if err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

func connectMySQL(dsn string) (*sql.DB, error) {
	cfg, err := mysql.ParseDSN(strings.TrimSpace(dsn))
	if err != nil {
		return nil, fmt.Errorf("invalid MySQL connection configuration")
	}
	if cfg.DBName == "" {
		return nil, fmt.Errorf("MySQL database name is required")
	}
	cfg.MultiStatements = false
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.Timeout = 10 * time.Second
	cfg.ReadTimeout = 30 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["time_zone"] = "'+00:00'"
	// The driver's handshake supports the legacy binary collation. Tables use
	// utf8mb4_0900_bin independently, preserving case-sensitive identity keys.
	cfg.Collation = "utf8mb4_bin"
	if err = cfg.Apply(mysql.Charset("utf8mb4", "utf8mb4_bin")); err != nil {
		return nil, err
	}
	connector, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, fmt.Errorf("invalid MySQL connector configuration")
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect MySQL: %w", err)
	}
	return db, nil
}

func (s *Server) acquireMySQLLease(ctx context.Context) error {
	var database string
	if err := s.db.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&database); err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(database))
	s.leaseName = "acceptances:" + hex.EncodeToString(sum[:24])
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	var acquired int
	if err = conn.QueryRowContext(ctx, "SELECT GET_LOCK(?,0),CONNECTION_ID()", s.leaseName).Scan(&acquired, &s.leaseID); err != nil || acquired != 1 {
		conn.Close()
		return fmt.Errorf("MySQL archive is already in use or its lease is unavailable")
	}
	// This dedicated connection is not returned to the pool while the lease lives.
	if _, err = conn.ExecContext(ctx, "SET SESSION wait_timeout=31536000"); err != nil {
		conn.Close()
		return err
	}
	s.lease = conn
	return nil
}

func (s *Server) checkMySQLLease(ctx context.Context) error {
	return s.checkTransactionLease(ctx, s.db)
}

type archiveLeaseQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Server) checkTransactionLease(ctx context.Context, db archiveLeaseQueryer) error {
	if !s.mysql {
		return nil
	}
	var owned int
	// Request cancellation can close a MySQL connection. Keep request contexts
	// away from the dedicated lease connection so an aborted fetch cannot release
	// the archive lock and disable every subsequent request.
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(IS_USED_LOCK(?)=?,0)", s.leaseName, s.leaseID).Scan(&owned); err != nil {
		return err
	}
	if owned != 1 {
		return fmt.Errorf("MySQL archive lease was lost; restart the server")
	}
	return nil
}

func (s *Server) migrateMySQL(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
 version INT UNSIGNED PRIMARY KEY, checksum CHAR(64) CHARACTER SET ascii NOT NULL,
 archive_id CHAR(36) CHARACTER SET ascii NOT NULL, dirty BOOLEAN NOT NULL,
 applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
 ) ENGINE=InnoDB`)
	if err != nil {
		return err
	}
	entries, err := schema.MySQL.ReadDir("migrations/mysql")
	if err != nil {
		return err
	}
	names := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	slices.Sort(names)
	type appliedMigration struct {
		checksum, archive string
		dirty             bool
	}
	applied := map[int]appliedMigration{}
	rows, err := s.db.QueryContext(ctx, "SELECT version,checksum,archive_id,dirty FROM schema_migrations ORDER BY version")
	if err != nil {
		return err
	}
	for rows.Next() {
		var version int
		var record appliedMigration
		if err = rows.Scan(&version, &record.checksum, &record.archive, &record.dirty); err != nil {
			rows.Close()
			return err
		}
		applied[version] = record
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(applied) > len(names) {
		return fmt.Errorf("MySQL schema is newer than this server")
	}
	archiveID := id()
	if first, ok := applied[1]; ok {
		archiveID = first.archive
	}
	// Validate the entire history before any DDL. Never repair dirty migrations
	// or replace the original archive identity automatically.
	for version, record := range applied {
		if version < 1 || version > len(names) {
			return fmt.Errorf("unsupported MySQL schema version %d", version)
		}
		data, readErr := schema.MySQL.ReadFile("migrations/mysql/" + names[version-1])
		if readErr != nil {
			return readErr
		}
		if version > len(applied) || record.dirty || record.archive != archiveID || record.checksum != digestBytes(data) {
			return fmt.Errorf("MySQL schema version/checksum mismatch or interrupted migration; inspect schema_migrations before recovery")
		}
	}
	for index, name := range names {
		version := index + 1
		if _, ok := applied[version]; ok {
			continue
		}
		data, readErr := schema.MySQL.ReadFile("migrations/mysql/" + name)
		if readErr != nil {
			return readErr
		}
		if _, err = s.db.ExecContext(ctx, "INSERT INTO schema_migrations(version,checksum,archive_id,dirty) VALUES(?,?,?,1)", version, digestBytes(data), archiveID); err != nil {
			return err
		}
		for statement := range strings.SplitSeq(string(data), "-- statement\n") {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if _, err = s.db.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("MySQL schema %s: %w", name, err)
			}
		}
		if _, err = s.db.ExecContext(ctx, "UPDATE schema_migrations SET dirty=0 WHERE version=?", version); err != nil {
			return err
		}
	}
	return nil
}

type mysqlBinding struct {
	ArchiveID string `json:"archiveId"`
	Database  string `json:"database"`
}

func (s *Server) bindMySQLDirectory(imported bool) error {
	var current mysqlBinding
	if err := s.db.QueryRow("SELECT archive_id,DATABASE() FROM schema_migrations WHERE version=1").Scan(&current.ArchiveID, &current.Database); err != nil {
		return err
	}
	path := filepath.Join(s.dir, ".mysql-storage.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var saved mysqlBinding
		if err = json.Unmarshal(data, &saved); err != nil {
			return err
		}
		if saved != current {
			return fmt.Errorf("data directory belongs to another MySQL archive; refusing file cleanup")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if !imported {
		if _, err = os.Stat(filepath.Join(s.dir, "archive.db")); err == nil {
			return fmt.Errorf("SQLite archive exists; run server --migrate-sqlite before starting MySQL")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		for _, table := range archiveTables {
			var count int
			if err = s.db.QueryRow("SELECT COUNT(*) FROM " + table.name).Scan(&count); err != nil {
				return err
			}
			if count != 0 {
				return fmt.Errorf("MySQL archive is populated but this directory is not bound to it")
			}
		}
		for _, name := range []string{"evidence", "deliveries", "documents"} {
			entries, readErr := os.ReadDir(filepath.Join(s.dir, name))
			if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
				return readErr
			}
			if len(entries) > 0 {
				return fmt.Errorf("unbound archive files exist; refusing startup cleanup")
			}
		}
	}
	if err = os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	data, err = json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(s.dir, ".mysql-storage-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	syncErr := file.Sync()
	if err = errors.Join(writeErr, syncErr, file.Close()); err != nil {
		return err
	}
	// Link publishes a complete, synced file atomically without replacing an
	// existing binding. A crash can leave only a temporary file or a valid final
	// binding, both safe to retry after checking the archive identity.
	if err = os.Link(file.Name(), path); err != nil {
		return err
	}
	return syncDirectory(s.dir)
}

func (s *Server) orderColumn() string {
	if s.mysql {
		return "seq"
	}
	return "rowid"
}

func (s *Server) followUpSourceSQL() string {
	if s.mysql {
		return "JSON_UNQUOTE(JSON_EXTRACT(report,'$.followUp.sourceRunId'))"
	}
	return "json_extract(report,'$.followUp.sourceRunId')"
}

func (s *Server) lockArchiveRow(ctx context.Context, tx *sql.Tx, table, key string) error {
	if !s.mysql {
		return nil
	}
	var found string
	return tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE id=? FOR UPDATE", key).Scan(&found)
}
