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
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type fileImportEntry struct {
	Kind     string    `json:"kind"`
	OwnerID  string    `json:"ownerId"`
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	SHA256   string    `json:"sha256"`
	Modified time.Time `json:"modifiedAt"`
}
type fileImportManifest struct {
	ArchiveID string            `json:"archiveId"`
	Tables    map[string]string `json:"tableSha256"`
	Files     []fileImportEntry `json:"files"`
}
type FileImportResult struct {
	ImportID       string `json:"importId"`
	Backup         string `json:"backup"`
	Files          int    `json:"files"`
	Bytes          int64  `json:"bytes"`
	Objects        int    `json:"objects"`
	Chunks         int    `json:"chunks"`
	ManifestSHA256 string `json:"manifestSha256"`
	AlreadyActive  bool   `json:"alreadyActive"`
}

// archiveReferences enumerates the business-owned files without consulting a
// local directory. Both import and database-only verification use this list.
func (s *Server) archiveReferences(ctx context.Context) ([]fileImportEntry, error) {
	result := []fileImportEntry{}
	rows, err := s.db.QueryContext(ctx, "SELECT id,report FROM runs ORDER BY id")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key, raw string
		if err = rows.Scan(&key, &raw); err != nil {
			rows.Close()
			return nil, err
		}
		var report Report
		if err = json.Unmarshal([]byte(raw), &report); err != nil {
			rows.Close()
			return nil, err
		}
		for _, file := range report.Evidence {
			result = append(result, fileImportEntry{Kind: "evidence", OwnerID: key, Name: file.Path, Size: -1})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = s.db.QueryContext(ctx, "SELECT id,payload,content_hash FROM delivery_snapshots ORDER BY id")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key, raw, hash string
		if err = rows.Scan(&key, &raw, &hash); err != nil {
			rows.Close()
			return nil, err
		}
		if digestBytes([]byte(raw)) != hash {
			rows.Close()
			return nil, fmt.Errorf("snapshot checksum mismatch")
		}
		var payload DeliveryPayload
		if err = json.Unmarshal([]byte(raw), &payload); err != nil {
			rows.Close()
			return nil, err
		}
		for _, file := range payload.Files {
			result = append(result, fileImportEntry{Kind: "deliveries", OwnerID: key, Name: file.Path, Size: file.Size, SHA256: file.SHA256})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = s.db.QueryContext(ctx, "SELECT id,content_hash FROM business_documents WHERE status='succeeded' ORDER BY id")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key, hash string
		if err = rows.Scan(&key, &hash); err != nil {
			rows.Close()
			return nil, err
		}
		result = append(result, fileImportEntry{Kind: "documents", OwnerID: key, Name: "business.html", Size: -1, SHA256: hash})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for i := range result {
		file := &result[i]
		if !validName(file.Name) || !validName(file.OwnerID) {
			return nil, fmt.Errorf("invalid archived file identity")
		}
		file.Path = filepath.ToSlash(filepath.Join(file.Kind, file.OwnerID, file.Name))
		if file.Kind == "deliveries" {
			file.Path = filepath.ToSlash(filepath.Join(file.Kind, file.OwnerID, "evidence", file.Name))
		}
		if seen[file.Path] {
			return nil, fmt.Errorf("duplicate archived file reference %s", file.Path)
		}
		seen[file.Path] = true
	}
	slices.SortFunc(result, func(a, b fileImportEntry) int { return strings.Compare(a.Path, b.Path) })
	return result, nil
}

func (s *Server) sourceFileManifest(ctx context.Context) (fileImportManifest, error) {
	manifest := fileImportManifest{Tables: map[string]string{}}
	if err := s.db.QueryRowContext(ctx, "SELECT archive_id FROM schema_migrations WHERE version=1").Scan(&manifest.ArchiveID); err != nil {
		return manifest, err
	}
	for _, table := range archiveTables {
		rows, err := readArchiveTable(ctx, s.db, table)
		if err != nil {
			return manifest, err
		}
		manifest.Tables[table.name] = tableDigest(rows)
	}
	files, err := s.archiveReferences(ctx)
	if err != nil {
		return manifest, err
	}
	expected := map[string]bool{}
	for i := range files {
		entry := &files[i]
		expected[entry.Path] = true
		root, err := legacyFileSet(s.dir, fileOwner{entry.Kind, entry.OwnerID})
		if err != nil {
			return manifest, err
		}
		file, err := root.Open(entry.Name)
		if err != nil {
			root.Close()
			return manifest, err
		}
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			file.Close()
			root.Close()
			return manifest, fmt.Errorf("nonregular source file %s", entry.Path)
		}
		hash := sha256.New()
		size, copyErr := io.Copy(hash, file)
		closeErr := errors.Join(file.Close(), root.Close())
		if err = errors.Join(copyErr, closeErr); err != nil {
			return manifest, err
		}
		actual := hex.EncodeToString(hash.Sum(nil))
		if entry.Size >= 0 && size != entry.Size || entry.SHA256 != "" && entry.SHA256 != actual {
			return manifest, fmt.Errorf("source file integrity mismatch: %s", entry.Path)
		}
		entry.Size = size
		entry.SHA256 = actual
		entry.Modified = info.ModTime().UTC()
	}
	actualCount := 0
	for _, kind := range []string{"evidence", "deliveries", "documents"} {
		base := filepath.Join(s.dir, kind)
		if _, err := os.Lstat(base); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return manifest, err
		}
		err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.Type()&fs.ModeSymlink != 0 {
				return fmt.Errorf("source symlink refused: %s", path)
			}
			if entry.IsDir() {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("source nonregular file refused: %s", path)
			}
			rel, err := filepath.Rel(s.dir, path)
			if err != nil {
				return err
			}
			if !expected[filepath.ToSlash(rel)] {
				return fmt.Errorf("unreferenced source file: %s", rel)
			}
			actualCount++
			return nil
		})
		if err != nil {
			return manifest, err
		}
	}
	if actualCount != len(files) {
		return manifest, fmt.Errorf("source file set differs from database references")
	}
	manifest.Files = files
	return manifest, nil
}

// MigrateFilesToMySQL retains source attachments and backups while moving
// legacy MySQL file storage into the database. It requires a stopped writer.
func MigrateFilesToMySQL(ctx context.Context, dir, dsn string) (result FileImportResult, err error) {
	dir, err = filepath.Abs(dir)
	if err != nil {
		return result, err
	}
	directory, err := lockArchiveDirectory(dir)
	if err != nil {
		return result, err
	}
	defer func() { directory.stop(); err = errors.Join(err, directory.release()) }()
	db, err := connectMySQL(dsn)
	if err != nil {
		return result, err
	}
	s := &Server{db: db, dir: dir}
	defer s.Close()
	if err = s.acquireMySQLLease(ctx); err != nil {
		return result, err
	}
	if err = s.migrateMySQL(ctx); err != nil {
		return result, err
	}
	if err = s.initializeFileArchive(ctx); err != nil {
		return result, err
	}
	if s.databaseFiles() {
		result, err = s.verifyDatabaseFiles(ctx)
		result.AlreadyActive = err == nil
		return result, err
	}
	if err = s.bindMySQLDirectory(); err != nil {
		return result, err
	}
	manifest, err := s.sourceFileManifest(ctx)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return result, err
	}
	result.ManifestSHA256 = digestBytes(raw)
	hashBytes, _ := hex.DecodeString(result.ManifestSHA256)
	result.Files = len(manifest.Files)
	for _, file := range manifest.Files {
		result.Bytes += file.Size
	}
	var status string
	err = db.QueryRowContext(ctx, "SELECT id,backup_directory,status FROM archive_file_imports WHERE archive_id=? AND source_manifest_sha256=?", manifest.ArchiveID, hashBytes).Scan(&result.ImportID, &result.Backup, &status)
	if errors.Is(err, sql.ErrNoRows) {
		result.ImportID = id()
		result.Backup, _, _, err = backupArchive(dir)
		if err != nil {
			return result, err
		}
		_, err = db.ExecContext(ctx, `INSERT INTO archive_file_imports(id,archive_id,source_directory,backup_directory,source_manifest_sha256,source_manifest,status,source_files,source_bytes) VALUES(?,?,?,?,?,?,'planned',?,?)`, result.ImportID, manifest.ArchiveID, dir, result.Backup, hashBytes, string(raw), result.Files, result.Bytes)
	}
	if err != nil {
		return result, err
	}
	defer func() {
		if err != nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = db.ExecContext(cleanup, "UPDATE archive_file_imports SET status='failed',error=? WHERE id=? AND status<>'activated'", err.Error(), result.ImportID)
		}
	}()
	if _, err = db.ExecContext(ctx, "UPDATE archive_file_imports SET status='importing',error='' WHERE id=?", result.ImportID); err != nil {
		return result, err
	}
	s.files.mysql = true // Only this stopped migration uses the new writer so far.
	for index, file := range manifest.Files {
		if err = s.importFile(ctx, file); err != nil {
			return result, fmt.Errorf("import %s: %w", file.Path, err)
		}
		if index%100 == 0 {
			slog.InfoContext(ctx, "导入归档文件", "completed", index+1, "total", result.Files)
		}
	}
	if _, err = db.ExecContext(ctx, "UPDATE archive_file_imports SET status='verifying' WHERE id=?", result.ImportID); err != nil {
		return result, err
	}
	result.Objects, result.Chunks, err = s.verifyFileEntries(ctx, manifest.Files)
	if err != nil {
		return result, err
	}
	after, err := s.sourceFileManifest(ctx)
	if err != nil {
		return result, err
	}
	afterRaw, _ := json.Marshal(after)
	if digestBytes(afterRaw) != result.ManifestSHA256 {
		return result, fmt.Errorf("source files or business records changed during import")
	}
	err = s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
		var mode string
		if err := tx.QueryRowContext(ctx, "SELECT backend FROM archive_file_storage WHERE singleton=1 FOR UPDATE").Scan(&mode); err != nil {
			return err
		}
		if mode != "filesystem" {
			return fmt.Errorf("file backend changed during import")
		}
		if _, err := tx.ExecContext(ctx, "UPDATE archive_file_imports SET status='verified',verified_files=?,verified_bytes=?,verified_at=UTC_TIMESTAMP(6) WHERE id=?", result.Files, result.Bytes, result.ImportID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE archive_file_imports SET status='activated',activated_at=UTC_TIMESTAMP(6) WHERE id=?", result.ImportID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE archive_file_storage SET backend='mysql',active_import_id=?,generation=generation+1,updated_at=UTC_TIMESTAMP(6) WHERE singleton=1", result.ImportID)
		return err
	})
	if err != nil {
		return result, fmt.Errorf("activation result may be unknown; rerun migration to inspect: %w", err)
	}
	receipt, _ := json.MarshalIndent(result, "", "  ")
	err = os.WriteFile(filepath.Join(result.Backup, "file-migration.json"), receipt, 0600)
	return result, err
}

func (s *Server) importFile(ctx context.Context, file fileImportEntry) error {
	owner := fileOwner{file.Kind, file.OwnerID}
	if content, err := s.lookupFileContent(ctx, owner, file.Name); err == nil {
		if content.sha256 != file.SHA256 || content.size != file.Size {
			return fmt.Errorf("existing file reference differs; refusing overwrite")
		}
		return nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	root, err := legacyFileSet(s.dir, owner)
	if err != nil {
		return err
	}
	defer root.Close()
	input, err := root.Open(file.Name)
	if err != nil {
		return err
	}
	defer input.Close()
	batch, err := s.beginFileBatch(ctx)
	if err != nil {
		return err
	}
	defer batch.Close()
	content, err := batch.put(file.Name, input)
	if err != nil {
		return err
	}
	if content.sha256 != file.SHA256 || content.size != file.Size {
		return fmt.Errorf("source changed during import")
	}
	content.modified = file.Modified
	return s.deliveryTransaction(ctx, func(tx *sql.Tx) error { return attachFile(ctx, tx, owner, file.Name, content) })
}

func (s *Server) lookupFileContent(ctx context.Context, owner fileOwner, name string) (fileContent, error) {
	var content fileContent
	table, column, err := owner.relation()
	if err != nil {
		return content, err
	}
	query := "SELECT b.id,b.size_bytes,b.sha256,f.modified_at FROM " + table + " f JOIN archive_blobs b ON b.id=f.blob_id WHERE f." + column + "=? AND b.state='ready'"
	args := []any{owner.id}
	if owner.kind != "documents" {
		query += " AND f.filename=?"
		args = append(args, name)
	}
	var hash []byte
	err = s.db.QueryRowContext(ctx, query, args...).Scan(&content.blobID, &content.size, &hash, &content.modified)
	content.sha256 = hex.EncodeToString(hash)
	return content, err
}

func (s *Server) verifyFileEntries(ctx context.Context, entries []fileImportEntry) (int, int, error) {
	verified := map[uint64]bool{}
	counts := map[string]int{}
	for _, file := range entries {
		content, err := s.lookupFileContent(ctx, fileOwner{file.Kind, file.OwnerID}, file.Name)
		if err != nil {
			return 0, 0, err
		}
		if file.Size >= 0 && content.size != file.Size || file.SHA256 != "" && content.sha256 != file.SHA256 {
			return 0, 0, fmt.Errorf("database file reference mismatch: %s", file.Path)
		}
		if !verified[content.blobID] {
			if err = verifyBlob(ctx, s.db, content.blobID, content.size, content.sha256); err != nil {
				return 0, 0, err
			}
			verified[content.blobID] = true
		}
		counts[file.Kind]++
	}
	for _, kind := range []string{"evidence", "deliveries", "documents"} {
		table, _, _ := (fileOwner{kind, ""}).relation()
		var count int
		if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			return 0, 0, err
		}
		if count != counts[kind] {
			return 0, 0, fmt.Errorf("extra or missing database file references in %s", table)
		}
	}
	var chunks int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM archive_blob_chunks c WHERE EXISTS(SELECT 1 FROM run_files f WHERE f.blob_id=c.blob_id) OR EXISTS(SELECT 1 FROM delivery_files f WHERE f.blob_id=c.blob_id) OR EXISTS(SELECT 1 FROM document_files f WHERE f.blob_id=c.blob_id)`).Scan(&chunks); err != nil {
		return 0, 0, err
	}
	return len(verified), chunks, nil
}

func (s *Server) verifyDatabaseFiles(ctx context.Context) (FileImportResult, error) {
	result := FileImportResult{}
	entries, err := s.archiveReferences(ctx)
	if err != nil {
		return result, err
	}
	result.Files = len(entries)
	result.Objects, result.Chunks, err = s.verifyFileEntries(ctx, entries)
	if err != nil {
		return result, err
	}
	for _, entry := range entries {
		content, readErr := s.lookupFileContent(ctx, fileOwner{entry.Kind, entry.OwnerID}, entry.Name)
		if readErr != nil {
			return result, readErr
		}
		result.Bytes += content.size
	}
	var active sql.NullString
	if err = s.db.QueryRowContext(ctx, "SELECT active_import_id FROM archive_file_storage WHERE singleton=1").Scan(&active); err != nil {
		return result, err
	}
	if active.Valid {
		result.ImportID = active.String
		var hash []byte
		if err = s.db.QueryRowContext(ctx, "SELECT backup_directory,source_manifest_sha256 FROM archive_file_imports WHERE id=?", active.String).Scan(&result.Backup, &hash); err != nil {
			return result, err
		}
		result.ManifestSHA256 = hex.EncodeToString(hash)
	}
	return result, nil
}
