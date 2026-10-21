package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var errDeliveryEvidenceSave = errors.New("save delivery evidence")

// The caller holds s.mu across preparation, publication and the freeze transaction.
func (s *Server) publishDeliverySnapshot(ctx context.Context, snapshot DeliverySnapshot, requestHash, raw string) error {
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
	return s.artifacts.withStage(deliveryArtifactRef{documentArtifact, document.ID}, func(artifact *stagedDeliveryArtifact) error {
		root, err := os.OpenRoot(filepath.Join(s.dir, "deliveries", snapshot.ID, "evidence"))
		if err != nil {
			return fmt.Errorf("冻结证据不可用: %w", err)
		}
		defer root.Close()
		content, err := artifact.writeFile("business.html", func(output io.Writer) error {
			if document.Kind == BusinessGuideDocument {
				return renderBusinessGuide(output, root, snapshot, document)
			}
			if document.TemplateVersion == testReportTemplateVersion {
				return renderTestReport(output, root, snapshot, document)
			}
			return renderBusinessDocument(output, root, snapshot, document)
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
