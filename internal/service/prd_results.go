package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/google/uuid"
)

type PRDProof struct {
	ConnectorToken, ClaimToken string
	Attempt                    int
}

func claimedImport(ctx context.Context, store PRDStore, id string, proof PRDProof) (PRDImport, error) {
	task, err := ownedImport(ctx, store, id)
	if err != nil {
		return task, err
	}
	if _, err = authenticatedConnector(ctx, store, task.Value.ConnectorID, proof.ConnectorToken); err != nil {
		return task, err
	}
	if task.Value.Attempt != proof.Attempt || proof.ClaimToken == "" || subtle.ConstantTimeCompare([]byte(task.ClaimHash), []byte(prdHash(proof.ClaimToken))) != 1 {
		return task, prdError("PRD_CLAIM_INVALID")
	}
	return task, nil
}

func (s *PRD) Result(ctx context.Context, id string, proof PRDProof, bundle prd.Bundle) (prd.Import, error) {
	// Persist expiry before returning a state error, and reject stale claimants before staging bytes.
	if _, err := s.GetImport(ctx, id); err != nil {
		return prd.Import{}, err
	}
	raw, err := json.Marshal(bundle.Manifest)
	if err != nil {
		return prd.Import{}, err
	}
	resultHash := prdHash(string(raw))
	var result prd.Import
	var needFiles bool
	check := func(store PRDStore) error {
		task, err := claimedImport(ctx, store, id, proof)
		if err != nil {
			return err
		}
		result = task.Value
		if task.Value.Status == "ready" || task.Value.Status == "confirmed" {
			if task.ResultHash != resultHash {
				return prdError("PRD_RESULT_CONFLICT")
			}
			return nil
		}
		if task.Value.Status != "fetching" {
			return prdError("PRD_IMPORT_" + strings.ToUpper(task.Value.Status))
		}
		source, err := prd.NormalizeURL(task.Value.URL)
		if err != nil {
			return err
		}
		if source.Realm != bundle.Manifest.Realm || source.Kind == "docx" && source.Token != bundle.Manifest.DocumentID {
			return prdError("SOURCE_MISMATCH")
		}
		needFiles = true
		return nil
	}
	if err := s.mutate(ctx, check); err != nil || !needFiles {
		return result, err
	}
	refs, closeFiles, err := s.stage(ctx, bundle.Files)
	if err != nil {
		return result, err
	}
	defer closeFiles()
	var stateErr error
	err = s.mutate(ctx, func(store PRDStore) error {
		task, err := claimedImport(ctx, store, id, proof)
		if err != nil {
			return err
		}
		if err = expirePRD(ctx, store, &task); err != nil {
			return err
		}
		if task.Value.Status == "ready" || task.Value.Status == "confirmed" {
			if task.ResultHash != resultHash {
				return prdError("PRD_RESULT_CONFLICT")
			}
			result = task.Value
			return nil
		}
		if task.Value.Status != "fetching" {
			stateErr = prdError("PRD_IMPORT_" + strings.ToUpper(task.Value.Status))
			return nil
		}
		task.Value.Status, task.Value.Phase = "ready", "ready"
		task.Value.Manifest = &bundle.Manifest
		task.Value.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		task.Value.ExpiresAt = time.Now().UTC().Add(candidateImportTTL).Format(time.RFC3339Nano)
		task.SourceHash, task.ResourceHash, task.ResultHash = bundle.SourceHash, bundle.ResourceHash, resultHash
		if err = store.UpdateImport(ctx, task); err != nil {
			return err
		}
		if err = store.InsertFiles(ctx, id, refs); err != nil {
			return err
		}
		result = task.Value
		return nil
	})
	if err == nil {
		err = stateErr
	}
	return result, err
}

func (s *PRD) Failure(ctx context.Context, id string, proof PRDProof, code, phase string, retryable bool) error {
	if !slices.Contains([]string{"LARK_AUTH_REQUIRED", "LARK_SCOPE_REQUIRED", "LARK_PERMISSION_DENIED", "LARK_NOT_FOUND", "LARK_RATE_LIMITED", "LARK_VERSION_CHANGED", "LARK_IDENTITY_CHANGED", "LARK_FETCH_FAILED", "LARK_INVALID_RESULT", "LARK_REALM_MISMATCH", "LARK_UNSUPPORTED_DOCUMENT", "LARK_LIMIT_EXCEEDED", "IMPORT_TIMEOUT", "PLATFORM_UNAVAILABLE"}, code) || !slices.Contains([]string{"reading", "uploading"}, phase) {
		return prdError("INVALID_INPUT")
	}
	if _, err := s.GetImport(ctx, id); err != nil {
		return err
	}
	return s.mutate(ctx, func(store PRDStore) error {
		task, err := claimedImport(ctx, store, id, proof)
		if err != nil {
			return err
		}
		if task.Value.Status == "failed" && task.Value.ErrorCode == code {
			return nil
		}
		if task.Value.Status != "fetching" {
			return prdError("PRD_IMPORT_" + strings.ToUpper(task.Value.Status))
		}
		task.Value.Status, task.Value.ErrorCode, task.Value.Phase = "failed", code, phase
		task.Value.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return store.UpdateImport(ctx, task)
	})
}

func (s *PRD) Confirm(ctx context.Context, id, expected string, acceptPartial bool) (prd.Snapshot, bool, error) {
	if _, err := s.GetImport(ctx, id); err != nil {
		return prd.Snapshot{}, false, err
	}
	var result prd.Snapshot
	var created bool
	var stateErr error
	err := s.mutate(ctx, func(store PRDStore) error {
		task, err := ownedImport(ctx, store, id)
		if err != nil {
			return err
		}
		if task.Value.Status == "confirmed" {
			result, err = store.GetSnapshot(ctx, task.Value.ConfirmedSnapshotID)
			return err
		}
		if err = expirePRD(ctx, store, &task); err != nil {
			return err
		}
		if task.Value.Status != "ready" {
			stateErr = prdError("PRD_IMPORT_" + strings.ToUpper(task.Value.Status))
			return nil
		}
		m := task.Value.Manifest
		if m == nil {
			return errors.New("ready PRD has no manifest")
		}
		if m.Completeness == "partial" && !acceptPartial {
			return prdError("PRD_PARTIAL_CONFIRMATION_REQUIRED")
		}
		if err = store.CheckFiles(ctx, id, m.Files); err != nil {
			return err
		}
		current, err := store.CurrentSnapshot(ctx, task.Value.CampaignID)
		if err != nil {
			return err
		}
		if current != expected {
			return prdError("PRD_HEAD_CHANGED")
		}
		previous, err := store.ListSnapshots(ctx, task.Value.CampaignID)
		if err != nil {
			return err
		}
		if current != "" {
			head, err := store.GetSnapshot(ctx, current)
			if err != nil {
				return err
			}
			if head.Manifest.Realm != m.Realm || head.Manifest.DocumentID != m.DocumentID {
				return prdError("SOURCE_MISMATCH")
			}
			newer, validHead := new(big.Int).SetString(head.Manifest.RevisionID, 10)
			candidate, validCandidate := new(big.Int).SetString(m.RevisionID, 10)
			if !validHead || !validCandidate {
				return errors.New("stored PRD revision is invalid")
			}
			if candidate.Cmp(newer) < 0 {
				return prdError("PRD_REVISION_STALE")
			}
			if staleSheetRevision(head.Manifest, *m) {
				return prdError("PRD_REVISION_STALE")
			}
		}
		for _, old := range previous {
			if old.Manifest.Realm != m.Realm || old.Manifest.DocumentID != m.DocumentID {
				return prdError("SOURCE_MISMATCH")
			}
			if old.Manifest.RevisionID != m.RevisionID || old.Manifest.NormalizerVersion != m.NormalizerVersion {
				continue
			}
			if old.SourceHash != task.SourceHash {
				return prdError("IMPORT_INCONSISTENT")
			}
			if resourcesChanged(old.Manifest, *m) {
				return prdError("IMPORT_INCONSISTENT")
			}
			if old.ResourceHash == task.ResourceHash || savedResourcesCover(old.Manifest, *m) {
				if result.ID == "" || len(resourceFiles(old.Manifest)) > len(resourceFiles(result.Manifest)) {
					result = old
				}
			}
		}
		if result.ID == "" {
			result = prd.Snapshot{ID: uuid.NewString(), CampaignID: task.Value.CampaignID, ImportID: id, SourceURL: task.Value.URL, SourceHash: task.SourceHash, ResourceHash: task.ResourceHash, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), CreatedBy: model.CurrentUser(ctx), Manifest: *m}
			fingerprint := prdHash(m.Realm + "\x00" + m.DocumentID + "\x00" + m.RevisionID + "\x00" + m.NormalizerVersion + "\x00" + task.SourceHash + "\x00" + task.ResourceHash)
			if err = store.InsertSnapshot(ctx, result, fingerprint); err != nil {
				return err
			}
			created = true
		}
		if err = store.SetCurrentSnapshot(ctx, task.Value.CampaignID, result.ID); err != nil {
			return err
		}
		task.Value.Status, task.Value.ConfirmedSnapshotID = "confirmed", result.ID
		task.Value.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return store.UpdateImport(ctx, task)
	})
	if err == nil {
		err = stateErr
	}
	return result, created, err
}

func resourceFiles(m prd.Manifest) map[string]map[string]bool {
	files := make(map[string]map[string]bool)
	for _, r := range m.Resources {
		if r.Status == "saved" {
			for _, f := range m.Files {
				if f.Name == r.Filename {
					id := r.Kind + "\x00" + r.ResourceID
					if r.Kind == "sheet" {
						id += "\x00" + r.SheetID + "\x00" + r.RevisionID
					}
					if files[id] == nil {
						files[id] = make(map[string]bool)
					}
					files[id][f.SHA256] = true
				}
			}
		}
	}
	return files
}

func resourcesChanged(old, next prd.Manifest) bool {
	saved := resourceFiles(old)
	for id, hashes := range resourceFiles(next) {
		if previous, ok := saved[id]; ok {
			for hash := range hashes {
				if !previous[hash] {
					return true
				}
			}
		}
	}
	return false
}

func savedResourcesCover(old, next prd.Manifest) bool {
	before, after := resourceFiles(old), resourceFiles(next)
	if len(before) < len(after) || resourcesChanged(old, next) {
		return false
	}
	for id, hashes := range after {
		for hash := range hashes {
			if !before[id][hash] {
				return false
			}
		}
	}
	return old.Completeness == "complete" || len(before) > len(after)
}

func (s *PRD) ImportFile(ctx context.Context, id, name string) (string, prd.File, error) {
	task, err := s.GetImport(ctx, id)
	if err != nil {
		return "", prd.File{}, err
	}
	if task.Status != "ready" && task.Status != "confirmed" || task.Manifest == nil {
		return "", prd.File{}, prdError("PRD_FILE_NOT_FOUND")
	}
	return findPRDFile(id, *task.Manifest, name)
}

func (s *PRD) SnapshotFile(ctx context.Context, id, name string) (string, prd.File, error) {
	snapshot, err := s.Snapshot(ctx, id)
	if err != nil {
		return "", prd.File{}, err
	}
	return findPRDFile(snapshot.ImportID, snapshot.Manifest, name)
}

func findPRDFile(importID string, m prd.Manifest, name string) (string, prd.File, error) {
	for _, file := range m.Files {
		if file.Name == name {
			return importID, file, nil
		}
	}
	return "", prd.File{}, prdError("PRD_FILE_NOT_FOUND")
}
