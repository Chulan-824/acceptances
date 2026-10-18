package api

import (
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) recoverDeliveryArtifacts() error {
	if _, err := s.db.Exec("UPDATE business_documents SET status='failed',error='服务重启中断了生成，请重试。',completed_at=? WHERE status='generating'", now()); err != nil {
		return err
	}
	kinds := []deliveryArtifactKind{snapshotArtifact, documentArtifact}
	for _, kind := range kinds {
		entries, err := os.ReadDir(filepath.Join(s.dir, string(kind)))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err = s.artifacts.removeUnpublished(deliveryArtifactRef{kind, entry.Name()}); err != nil {
				return err
			}
		}
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		for _, kind := range kinds {
			if strings.HasPrefix(entry.Name(), kind.stagePrefix()) {
				if err = s.artifacts.remove(filepath.Join(s.dir, entry.Name())); err != nil {
					return err
				}
				break
			}
		}
	}
	return nil
}
