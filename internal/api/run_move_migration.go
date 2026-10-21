package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) migrateRunMoves(backupExisting bool) error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 5 {
		return nil
	}
	if backupExisting {
		path := filepath.Join(s.dir, "archive.before-v5."+time.Now().UTC().Format("20060102T150405")+"."+id()+".db")
		if _, err := s.db.Exec("VACUUM INTO '" + strings.ReplaceAll(path, "'", "''") + "'"); err != nil {
			return fmt.Errorf("back up archive before run move migration: %w", err)
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
CREATE TABLE run_moves (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL UNIQUE,from_campaign_id TEXT NOT NULL,to_campaign_id TEXT NOT NULL,
 reason TEXT NOT NULL,created_at TEXT NOT NULL,CHECK(from_campaign_id<>to_campaign_id));
CREATE INDEX moves_by_run ON run_moves(run_id);
CREATE TRIGGER immutable_run_move BEFORE UPDATE ON run_moves
 BEGIN SELECT RAISE(ABORT,'run move is immutable'); END;
PRAGMA user_version=5;`)
	if err != nil {
		return fmt.Errorf("migrate run moves: %w", err)
	}
	return tx.Commit()
}
