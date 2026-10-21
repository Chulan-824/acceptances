package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Existing HTML remains byte-for-byte unchanged and belongs to test_report.
func (s *Server) migrateDocumentKinds(backupExisting bool) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 4 {
		return nil
	}
	if backupExisting {
		path := filepath.Join(s.dir, "archive.before-v4."+time.Now().UTC().Format("20060102T150405")+"."+id()+".db")
		if _, err := s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'"); err != nil {
			return fmt.Errorf("back up archive before document migration: %w", err)
		}
		if err := os.Chmod(path, 0600); err != nil {
			return err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
DROP TRIGGER immutable_successful_document;
ALTER TABLE business_documents RENAME TO legacy_business_documents;
CREATE TABLE business_documents (
 id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id),
 kind TEXT NOT NULL DEFAULT 'test_report' CHECK(kind IN ('test_report','business_guide')),
 guide TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,template_version TEXT NOT NULL,
 status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,error TEXT NOT NULL DEFAULT '',
 content_hash TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',
 UNIQUE(delivery_id,kind,version));
INSERT INTO business_documents(id,delivery_id,version,request_id,template_version,status,attempts,error,content_hash,created_at,completed_at)
 SELECT id,delivery_id,version,request_id,template_version,status,attempts,error,content_hash,created_at,completed_at FROM legacy_business_documents;
DROP TABLE legacy_business_documents;
CREATE TRIGGER immutable_successful_document BEFORE UPDATE ON business_documents
 WHEN OLD.status='succeeded'
 BEGIN SELECT RAISE(ABORT,'successful document is immutable'); END;
CREATE TRIGGER immutable_document_input BEFORE UPDATE OF delivery_id,kind,guide,version,request_id,template_version,created_at ON business_documents
 BEGIN SELECT RAISE(ABORT,'document input is immutable'); END;
PRAGMA user_version=4;`)
	if err != nil {
		return fmt.Errorf("migrate document kinds: %w", err)
	}
	return tx.Commit()
}
