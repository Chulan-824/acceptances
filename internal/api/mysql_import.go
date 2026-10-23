package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type archiveTable struct {
	name     string
	columns  string
	sequence bool
}

// Parent tables precede their children. Column lists are explicit so raw report
// bytes and original timestamps survive independently of either SQL dialect.
var archiveTables = []archiveTable{
	{"projects", "id,name,description,created_at", false},
	{"repositories", "id,project_id,name,source", false},
	{"campaigns", "id,project_id,title,description,status,latest_run_id,created_at", false},
	{"runs", "id,campaign_id,submission_id,hash,report,status,void_reason,created_at", true},
	{"reviews", "id,run_id,kind,body,created_at,check_id,legacy", true},
	{"delivery_snapshots", "id,project_id,campaign_id,source_run_id,version,request_id,request_hash,payload,content_hash,status,successor_id,created_at", true},
	{"delivery_requests", "request_id,request_hash,delivery_id", false},
	{"delivery_events", "id,delivery_id,kind,reason,reference,created_at", true},
	{"business_documents", "id,delivery_id,kind,guide,version,request_id,template_version,status,attempts,error,content_hash,created_at,completed_at", false},
	{"run_moves", "id,run_id,request_id,from_campaign_id,to_campaign_id,reason,created_at", true},
	{"run_consolidations", "id,request_id,source_run_id,primary_run_id,from_campaign_id,reason,created_at", true},
}

type MySQLImportResult struct {
	Backup          string            `json:"backup"`
	Rows            map[string]int    `json:"rows"`
	TableSHA256     map[string]string `json:"tableSha256"`
	Files           int               `json:"files"`
	FileBytes       int64             `json:"fileBytes"`
	AlreadyImported bool              `json:"alreadyImported"`
}

type archiveQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readArchiveTable(ctx context.Context, db archiveQueryer, table archiveTable, mysql bool) ([][]string, error) {
	columns, order := table.columns, strings.Split(table.columns, ",")[0]
	if table.sequence {
		order = "rowid"
		if mysql {
			order = "seq"
		}
		columns += "," + order
	}
	rows, err := db.QueryContext(ctx, "SELECT "+columns+" FROM "+table.name+" ORDER BY "+order)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	width := len(strings.Split(columns, ","))
	result := [][]string{}
	for rows.Next() {
		values := make([]any, width)
		pointers := make([]any, width)
		for i := range values {
			pointers[i] = &values[i]
		}
		if err = rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make([]string, width)
		for i, v := range values {
			switch v := v.(type) {
			case []byte:
				row[i] = string(v)
			case nil:
				return nil, fmt.Errorf("unexpected NULL in %s", table.name)
			default:
				row[i] = fmt.Sprint(v)
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func tableDigest(rows [][]string) string {
	data, _ := json.Marshal(rows)
	return digestBytes(data)
}

// MigrateSQLiteToMySQL requires a stopped source server and a v6 SQLite
// archive. It never updates the source or overwrites populated destination data.
// A consistent file backup is completed before the first destination INSERT.
func MigrateSQLiteToMySQL(ctx context.Context, dir, dsn string) (result MySQLImportResult, err error) {
	dir, err = filepath.Abs(dir)
	if err != nil {
		return result, err
	}
	directory, err := lockArchiveDirectory(dir)
	if err != nil {
		return result, err
	}
	defer func() {
		directory.stop()
		err = errors.Join(err, directory.release())
	}()
	if info, statErr := os.Stat(filepath.Join(dir, "archive.db-wal")); statErr == nil && info.Size() > 0 {
		return result, fmt.Errorf("SQLite WAL is nonempty; stop its server and checkpoint it before migration")
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return result, statErr
	}
	sourceURL := url.URL{Scheme: "file", Path: filepath.ToSlash(filepath.Join(dir, "archive.db"))}
	// Do not use immutable=1: it disables SQLite's locks and change detection.
	// EXCLUSIVE locking mode also excludes idle legacy WAL connections that do
	// not know about the application directory lock. No source DML is executed.
	sourceURL.RawQuery = "mode=rw&_pragma=busy_timeout(0)&_pragma=locking_mode(EXCLUSIVE)"
	source, err := sql.Open("sqlite", sourceURL.String())
	if err != nil {
		return result, err
	}
	defer source.Close()
	source.SetMaxOpenConns(1)
	if _, err = source.ExecContext(ctx, "BEGIN EXCLUSIVE"); err != nil {
		return result, fmt.Errorf("cannot exclusively lock SQLite source; stop all source connections before migration: %w", err)
	}
	// Keep this single connection and its read snapshot locked through backup,
	// import commit and directory binding. ROLLBACK makes no source data changes.
	defer func() { _, _ = source.ExecContext(context.Background(), "ROLLBACK") }()
	if info, statErr := os.Stat(filepath.Join(dir, "archive.db-wal")); statErr == nil && info.Size() > 0 {
		return result, fmt.Errorf("SQLite WAL changed before source lock; stop its server and checkpoint it before migration")
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return result, statErr
	}
	var version int
	var integrity string
	if err = source.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return result, err
	}
	if version != 6 {
		return result, fmt.Errorf("SQLite schema must be v6, got %d; upgrade a backup with the previous server first", version)
	}
	if err = source.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
		return result, err
	}
	if integrity != "ok" {
		return result, fmt.Errorf("SQLite integrity check failed")
	}
	foreign, err := source.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return result, err
	}
	invalid := foreign.Next()
	err = foreign.Err()
	foreign.Close()
	if err != nil {
		return result, err
	}
	if invalid {
		return result, fmt.Errorf("SQLite foreign key check failed")
	}
	data := map[string][][]string{}
	result.Rows = map[string]int{}
	result.TableSHA256 = map[string]string{}
	for _, table := range archiveTables {
		rows, readErr := readArchiveTable(ctx, source, table, false)
		if readErr != nil {
			return result, readErr
		}
		data[table.name] = rows
		result.Rows[table.name] = len(rows)
		result.TableSHA256[table.name] = tableDigest(rows)
	}
	db, err := connectMySQL(dsn)
	if err != nil {
		return result, err
	}
	s := &Server{db: db, dir: dir, mysql: true}
	defer s.Close()
	if err = s.acquireMySQLLease(ctx); err != nil {
		return result, err
	}
	if err = s.migrateMySQL(ctx); err != nil {
		return result, err
	}
	// A pre-existing binding must match before import can touch the destination.
	if _, statErr := os.Stat(filepath.Join(dir, ".mysql-storage.json")); statErr == nil {
		if err = s.bindMySQLDirectory(true); err != nil {
			return result, err
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return result, statErr
	}
	empty := true
	for _, table := range archiveTables {
		var count int
		if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table.name).Scan(&count); err != nil {
			return result, err
		}
		if count > 0 {
			empty = false
		}
	}
	if !empty {
		for _, table := range archiveTables {
			rows, readErr := readArchiveTable(ctx, db, table, true)
			if readErr != nil {
				return result, readErr
			}
			if tableDigest(rows) != result.TableSHA256[table.name] {
				return result, fmt.Errorf("destination %s contains different data; refusing to overwrite", table.name)
			}
		}
		result.AlreadyImported = true
		return result, s.bindMySQLDirectory(true)
	}
	result.Backup, result.Files, result.FileBytes, err = backupArchive(dir)
	if err != nil {
		return result, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err = s.checkTransactionLease(ctx, tx); err != nil {
		return result, err
	}
	for _, table := range archiveTables {
		columns := table.columns
		if table.sequence {
			columns += ",seq"
		}
		width := len(strings.Split(columns, ","))
		query := "INSERT INTO " + table.name + "(" + columns + ") VALUES(" + strings.TrimSuffix(strings.Repeat("?,", width), ",") + ")"
		for _, row := range data[table.name] {
			values := make([]any, len(row))
			for i, v := range row {
				values[i] = v
			}
			if _, err = tx.ExecContext(ctx, query, values...); err != nil {
				return result, fmt.Errorf("import %s: %w", table.name, err)
			}
		}
		rows, readErr := readArchiveTable(ctx, tx, table, true)
		if readErr != nil {
			return result, readErr
		}
		if tableDigest(rows) != result.TableSHA256[table.name] {
			return result, fmt.Errorf("imported %s differs from SQLite", table.name)
		}
	}
	if err = s.checkTransactionLease(ctx, tx); err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, fmt.Errorf("import commit result unknown; rerun migration to inspect persisted data: %w", err)
	}
	if err = s.bindMySQLDirectory(true); err != nil {
		return result, err
	}
	receipt, _ := json.MarshalIndent(result, "", "  ")
	err = os.WriteFile(filepath.Join(result.Backup, "migration.json"), receipt, 0600)
	return result, err
}

type backupFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

func backupArchive(dir string) (string, int, int64, error) {
	parent := filepath.Join(dir, ".backups")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", 0, 0, err
	}
	backup, err := os.MkdirTemp(parent, "mysql-import-"+time.Now().UTC().Format("20060102T150405")+"-")
	if err != nil {
		return "", 0, 0, err
	}
	files := []backupFile{}
	var size int64
	err = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if entry.IsDir() && rel == ".backups" {
			return filepath.SkipDir
		}
		target := filepath.Join(backup, "data", rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("archive backup refuses nonregular file %s", rel)
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(output, hash), input)
		syncErr := output.Sync()
		closeErr := output.Close()
		if err = errors.Join(copyErr, syncErr, closeErr); err != nil {
			return err
		}
		files = append(files, backupFile{filepath.ToSlash(rel), n, hex.EncodeToString(hash.Sum(nil))})
		size += n
		return nil
	})
	if err != nil {
		return backup, 0, 0, err
	}
	manifest, _ := json.MarshalIndent(files, "", "  ")
	err = os.WriteFile(filepath.Join(backup, "files.json"), manifest, 0600)
	return backup, len(files), size, err
}
