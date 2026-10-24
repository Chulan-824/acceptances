package api

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var errDeliveryEvidenceSave = errors.New("save delivery evidence")

// The caller holds s.mu across preparation, publication and the freeze transaction.
func (s *Server) publishDeliverySnapshot(ctx context.Context, snapshot DeliverySnapshot, requestHash, raw string) error {
	if s.databaseFiles() {
		return s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
			if err := s.persistDeliverySnapshotTx(ctx, tx, snapshot, requestHash, raw); err != nil {
				return err
			}
			for _, file := range snapshot.Payload.Files {
				var content fileContent
				var hash []byte
				if err := tx.QueryRowContext(ctx, `SELECT b.id,b.size_bytes,b.sha256,f.modified_at FROM run_files f JOIN archive_blobs b ON b.id=f.blob_id WHERE f.run_id=? AND f.filename=? AND b.state='ready'`, snapshot.Payload.Run.ID, file.Path).Scan(&content.blobID, &content.size, &hash, &content.modified); err != nil {
					return errors.Join(errDeliveryEvidenceSave, err)
				}
				if content.size != file.Size || hex.EncodeToString(hash) != file.SHA256 {
					return errDeliveryEvidenceSave
				}
				if err := attachFile(ctx, tx, fileOwner{"deliveries", snapshot.ID}, file.Path, content); err != nil {
					return err
				}
			}
			return nil
		})
	}
	return s.artifacts.withStage(deliveryArtifactRef{snapshotArtifact, snapshot.ID}, func(artifact *stagedDeliveryArtifact) error {
		if err := s.copyDeliveryEvidence(snapshot.Payload.Run.ID, artifact, snapshot.Payload.Files); err != nil {
			return errors.Join(errDeliveryEvidenceSave, err)
		}
		if err := artifact.seal(); err != nil {
			return errors.Join(errDeliveryEvidenceSave, err)
		}
		return artifact.publish(ctx, func() error {
			return s.persistDeliverySnapshot(ctx, snapshot, requestHash, raw)
		})
	})
}

func (s *Server) publishBusinessDocument(ctx context.Context, snapshot DeliverySnapshot, document BusinessDocument) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.databaseFiles() {
		batch, err := s.beginFileBatch(ctx)
		if err != nil {
			return err
		}
		defer batch.Close()
		root, err := s.openFiles(ctx, fileOwner{"deliveries", snapshot.ID})
		if err != nil {
			return err
		}
		defer root.Close()
		content, err := batch.write("business.html", func(w io.Writer) error {
			if document.Kind == BusinessGuideDocument {
				return renderBusinessGuide(w, root, snapshot, document)
			}
			if document.TemplateVersion == testReportTemplateVersion {
				return renderTestReport(w, root, snapshot, document)
			}
			return renderBusinessDocument(w, root, snapshot, document)
		})
		if err != nil {
			return err
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
			var status string
			if err := tx.QueryRowContext(ctx, "SELECT status FROM delivery_snapshots WHERE id=? FOR UPDATE", snapshot.ID).Scan(&status); err != nil {
				return err
			}
			if status != "valid" {
				return fmt.Errorf("生成期间交付已失效或被替代")
			}
			if err := attachFile(ctx, tx, fileOwner{"documents", document.ID}, "business.html", content); err != nil {
				return err
			}
			return persistBusinessDocumentTx(ctx, tx, document.ID, content.sha256)
		})
	}
	return s.artifacts.withStage(deliveryArtifactRef{documentArtifact, document.ID}, func(artifact *stagedDeliveryArtifact) error {
		root, err := os.OpenRoot(filepath.Join(s.dir, "deliveries", snapshot.ID, "evidence"))
		if err != nil {
			return fmt.Errorf("冻结证据不可用: %w", err)
		}
		defer root.Close()
		content, err := artifact.writeFile("business.html", func(output io.Writer) error {
			if document.Kind == BusinessGuideDocument {
				return renderBusinessGuide(output, root.FS(), snapshot, document)
			}
			if document.TemplateVersion == testReportTemplateVersion {
				return renderTestReport(output, root.FS(), snapshot, document)
			}
			return renderBusinessDocument(output, root.FS(), snapshot, document)
		})
		if err != nil {
			return err
		}
		if err = artifact.seal(); err != nil {
			return err
		}
		// Rendering remains outside the lock; validity and final publication do not.
		s.mu.Lock()
		defer s.mu.Unlock()
		if err = s.checkDocumentDelivery(ctx, snapshot.ID); err != nil {
			return err
		}
		return artifact.publish(ctx, func() error {
			return s.persistBusinessDocument(ctx, document.ID, content.sha256)
		})
	})
}

func (s *Server) copyDeliveryEvidence(runID string, artifact *stagedDeliveryArtifact, files []ArchivedFile) error {
	root, err := os.OpenRoot(filepath.Join(s.dir, "evidence", runID))
	if err != nil {
		return err
	}
	defer root.Close()
	if err = artifact.mkdir("evidence"); err != nil {
		return err
	}
	for _, item := range files {
		if err = copyVerifiedFile(root, artifact, item); err != nil {
			return err
		}
	}
	return nil
}

func copyVerifiedFile(root *os.Root, artifact *stagedDeliveryArtifact, item ArchivedFile) error {
	if !validName(item.Path) {
		return fmt.Errorf("invalid archived filename")
	}
	input, err := root.Open(item.Path)
	if err != nil {
		return err
	}
	defer input.Close()
	content, err := artifact.writeFile(filepath.Join("evidence", item.Path), func(output io.Writer) error {
		_, err := io.Copy(output, input)
		return err
	})
	if err != nil {
		return err
	}
	if content.size != item.Size || content.sha256 != item.SHA256 {
		return fmt.Errorf("evidence changed while freezing: %s", item.Path)
	}
	return nil
}
