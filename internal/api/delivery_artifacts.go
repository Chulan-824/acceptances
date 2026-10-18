package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type deliveryArtifactKind string

const (
	snapshotArtifact deliveryArtifactKind = "deliveries"
	documentArtifact deliveryArtifactKind = "documents"
)

func (kind deliveryArtifactKind) stagePrefix() string {
	switch kind {
	case snapshotArtifact:
		return ".delivery-"
	case documentArtifact:
		return ".document-"
	default:
		return ""
	}
}

type deliveryArtifactRef struct {
	kind deliveryArtifactKind
	id   string
}

// deliveryArtifacts owns the file publication protocol. The checkpoint is a
// private fault seam; production always leaves it nil.
type deliveryArtifacts struct {
	db         *sql.DB
	dir        string
	checkpoint func(phase, path string) error
}

func (a *deliveryArtifacts) check(phase, path string) error {
	if a.checkpoint != nil {
		return a.checkpoint(phase, path)
	}
	return nil
}

func (a *deliveryArtifacts) target(ref deliveryArtifactRef) string {
	return filepath.Join(a.dir, string(ref.kind), ref.id)
}

// publicationStatus deliberately ignores Delivery Effect. Any snapshot row
// owns its files, whereas only a succeeded document owns a published HTML.
// Call only after the final DB action has released its transaction/connection.
func (a *deliveryArtifacts) publicationStatus(ref deliveryArtifactRef) (string, error) {
	var query string
	switch ref.kind {
	case snapshotArtifact:
		query = "SELECT 'succeeded' FROM delivery_snapshots WHERE id=?"
	case documentArtifact:
		query = "SELECT status FROM business_documents WHERE id=?"
	default:
		return "", fmt.Errorf("unknown delivery artifact kind %q", ref.kind)
	}
	// Cleanup must remain possible after the publishing request is cancelled.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var status string
	err := a.db.QueryRowContext(ctx, query, ref.id).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return status, err
}

func (a *deliveryArtifacts) remove(path string) error {
	if err := a.check("remove", path); err != nil {
		return fmt.Errorf("clean delivery artifact: %w", err)
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("clean delivery artifact: %w", err)
	}
	return nil
}

// The caller must own the failed attempt, or be recovering before serving any
// requests. Being unpublished alone does not authorize deleting an active job.
func (a *deliveryArtifacts) removeUnpublished(ref deliveryArtifactRef) error {
	status, err := a.publicationStatus(ref)
	if err != nil {
		return fmt.Errorf("check delivery artifact ownership: %w", err)
	}
	if status == "succeeded" {
		return nil
	}
	return a.remove(a.target(ref))
}

// Called under s.mu after retry eligibility checks, before reserving generating.
func (a *deliveryArtifacts) prepareDocumentRetry(documentID string) error {
	ref := deliveryArtifactRef{documentArtifact, documentID}
	status, err := a.publicationStatus(ref)
	if err != nil {
		return fmt.Errorf("check document retry ownership: %w", err)
	}
	if status != "failed" {
		return fmt.Errorf("document is no longer failed")
	}
	return a.remove(a.target(ref))
}

type stagedDeliveryArtifact struct {
	archive *deliveryArtifacts
	ref     deliveryArtifactRef
	stage   string
	dirs    []string
	renamed bool
}

// withStage is private to the two publication entry points. Neither their
// business callers nor recovery have to arrange deferred filesystem cleanup.
func (a *deliveryArtifacts) withStage(ref deliveryArtifactRef, run func(*stagedDeliveryArtifact) error) (err error) {
	prefix := ref.kind.stagePrefix()
	if prefix == "" {
		return fmt.Errorf("unknown delivery artifact kind %q", ref.kind)
	}
	stage, err := os.MkdirTemp(a.dir, prefix)
	if err != nil {
		return err
	}
	artifact := &stagedDeliveryArtifact{archive: a, ref: ref, stage: stage, dirs: []string{stage}}
	defer func() {
		if !artifact.renamed {
			err = errors.Join(err, a.remove(stage))
		} else if err != nil {
			err = errors.Join(err, a.removeUnpublished(ref))
		}
	}()
	return run(artifact)
}

func (a *stagedDeliveryArtifact) mkdir(name string) error {
	path := filepath.Join(a.stage, name)
	if err := os.Mkdir(path, 0700); err != nil {
		return err
	}
	a.dirs = append(a.dirs, path)
	return nil
}

type artifactContent struct {
	size   int64
	sha256 string
}

type artifactWriter struct {
	io.Writer
	size int64
}

func (w *artifactWriter) Write(data []byte) (int, error) {
	n, err := w.Writer.Write(data)
	w.size += int64(n)
	return n, err
}

func (a *stagedDeliveryArtifact) writeFile(name string, write func(io.Writer) error) (artifactContent, error) {
	path := filepath.Join(a.stage, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return artifactContent{}, err
	}
	hash := sha256.New()
	writer := &artifactWriter{Writer: io.MultiWriter(file, hash)}
	writeErr := write(writer)
	syncErr := a.archive.check("sync-file", path)
	if syncErr == nil {
		syncErr = file.Sync()
	}
	closeErr := file.Close()
	return artifactContent{writer.size, hex.EncodeToString(hash.Sum(nil))}, errors.Join(writeErr, syncErr, closeErr)
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(directory.Sync(), directory.Close())
}

func (a *deliveryArtifacts) syncDirectory(path string) error {
	if err := a.check("sync-directory", path); err != nil {
		return err
	}
	return syncDirectory(path)
}

func (a *stagedDeliveryArtifact) seal() error {
	for i := len(a.dirs) - 1; i >= 0; i-- {
		if err := a.archive.syncDirectory(a.dirs[i]); err != nil {
			return err
		}
	}
	return a.archive.check("staged", a.stage)
}

// persist must end its transaction before returning, even on failure. This
// permits withStage to check durable ownership through the single DB connection.
func (a *stagedDeliveryArtifact) publish(ctx context.Context, persist func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	target := a.archive.target(a.ref)
	if err := os.Rename(a.stage, target); err != nil {
		return err
	}
	a.renamed = true
	if err := a.archive.check("renamed", target); err != nil {
		return err
	}
	if err := a.archive.syncDirectory(filepath.Dir(target)); err != nil {
		return err
	}
	if err := persist(); err != nil {
		return err
	}
	return a.archive.check("persisted", target)
}
