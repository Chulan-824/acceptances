package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) migrateRunConsolidations(backupExisting bool) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 6 {
		return nil
	}
	if backupExisting {
		path := filepath.Join(s.dir, "archive.before-v6."+time.Now().UTC().Format("20060102T150405")+"."+id()+".db")
		if _, err := s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'"); err != nil {
			return fmt.Errorf("back up run consolidation archive: %w", err)
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
	_, err = tx.Exec(`CREATE TABLE run_consolidations (
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,
 source_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
 primary_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 from_campaign_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,
 CHECK(source_run_id<>primary_run_id));
 CREATE INDEX consolidations_by_primary ON run_consolidations(primary_run_id);
 CREATE TRIGGER immutable_run_consolidation BEFORE UPDATE ON run_consolidations
 BEGIN SELECT RAISE(ABORT,'run consolidation is immutable'); END;
 PRAGMA user_version=6;`)
	if err != nil {
		return fmt.Errorf("migrate run consolidation: %w", err)
	}
	return tx.Commit()
}
