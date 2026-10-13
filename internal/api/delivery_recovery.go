package api

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) recoverDeliveryArtifacts() error {
	if _, err := s.db.Exec("UPDATE business_documents SET status='failed',error='服务重启中断了生成，请重试。',completed_at=? WHERE status='generating'", now()); err != nil {
		return err
	}
	for _, scope := range []struct{ directory, query string }{
		{"deliveries", "SELECT id FROM delivery_snapshots WHERE id=?"},
		{"documents", "SELECT id FROM business_documents WHERE id=? AND status='succeeded'"},
	} {
		entries, err := os.ReadDir(filepath.Join(s.dir, scope.directory))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			var key string
			err = s.db.QueryRow(scope.query, entry.Name()).Scan(&key)
			if err == sql.ErrNoRows {
				if err = os.RemoveAll(filepath.Join(s.dir, scope.directory, entry.Name())); err != nil {
					return fmt.Errorf("clean delivery artifact: %w", err)
				}
			} else if err != nil {
				return err
			}
		}
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".delivery-") || strings.HasPrefix(entry.Name(), ".document-") {
			if err = os.RemoveAll(filepath.Join(s.dir, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
