package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The report and evidence remain immutable. Only review metadata and derived
// acceptance states change when an archive adopts item-level human review.
func (s *Server) migrateCheckReviews(backupExisting bool) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 2 {
		return nil
	}
	if backupExisting {
		name := "archive.before-v2." + time.Now().UTC().Format("20060102T150405") + "." + id() + ".db"
		backup := filepath.Join(s.dir, name)
		// VACUUM INTO includes committed WAL content and produces a consistent
		// SQLite snapshot, unlike copying archive.db while WAL is enabled.
		if _, err := s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(backup, "'", "''") + "'"); err != nil {
			return fmt.Errorf("back up archive before schema migration: %w", err)
		}
		if err := os.Chmod(backup, 0600); err != nil {
			return fmt.Errorf("protect archive backup: %w", err)
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`ALTER TABLE reviews ADD COLUMN check_id TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
UPDATE reviews SET legacy=1 WHERE kind IN ('accepted','rejected');
CREATE INDEX reviews_by_run ON reviews(run_id);
UPDATE runs SET status='pending' WHERE status<>'void';
UPDATE campaigns SET status='pending';
PRAGMA user_version=2;`)
	if err != nil {
		return fmt.Errorf("migrate item-level human reviews: %w", err)
	}
	return tx.Commit()
}
