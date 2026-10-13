package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) migrateDeliveries(backupExisting bool) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 3 {
		return nil
	}
	if backupExisting {
		path := filepath.Join(s.dir, "archive.before-v3."+time.Now().UTC().Format("20060102T150405")+"."+id()+".db")
		if _, err := s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'"); err != nil {
			return fmt.Errorf("back up archive before delivery migration: %w", err)
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
CREATE TABLE delivery_snapshots (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,campaign_id TEXT NOT NULL,source_run_id TEXT NOT NULL,
 version INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
 payload TEXT NOT NULL,content_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'valid',
 successor_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
 UNIQUE(campaign_id,version));
CREATE INDEX deliveries_by_run ON delivery_snapshots(source_run_id);
CREATE INDEX deliveries_by_campaign ON delivery_snapshots(campaign_id);
CREATE TABLE delivery_requests (
 request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id));
CREATE TABLE delivery_events (
 id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id),
 kind TEXT NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX delivery_events_by_snapshot ON delivery_events(delivery_id);
CREATE TABLE business_documents (
 id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES delivery_snapshots(id),
 version INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,template_version TEXT NOT NULL,
 status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,error TEXT NOT NULL DEFAULT '',
 content_hash TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',
 UNIQUE(delivery_id,version));
CREATE TRIGGER immutable_delivery_content BEFORE UPDATE OF
 project_id,campaign_id,source_run_id,version,request_id,request_hash,payload,content_hash,created_at
 ON delivery_snapshots BEGIN SELECT RAISE(ABORT,'delivery content is immutable'); END;
CREATE TRIGGER preserve_delivery_archive BEFORE DELETE ON delivery_snapshots
 BEGIN SELECT RAISE(ABORT,'delivery archive must be retained'); END;
CREATE TRIGGER preserve_delivery_events BEFORE UPDATE ON delivery_events
 BEGIN SELECT RAISE(ABORT,'delivery events are immutable'); END;
CREATE TRIGGER preserve_delivery_event_history BEFORE DELETE ON delivery_events
 BEGIN SELECT RAISE(ABORT,'delivery events must be retained'); END;
CREATE TRIGGER immutable_successful_document BEFORE UPDATE ON business_documents
 WHEN OLD.status='succeeded'
 BEGIN SELECT RAISE(ABORT,'successful document is immutable'); END;
PRAGMA user_version=3;`)
	if err != nil {
		return fmt.Errorf("migrate delivery archive: %w", err)
	}
	return tx.Commit()
}
