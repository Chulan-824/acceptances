package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/google/uuid"
)

func ownedConnector(ctx context.Context, store PRDStore, id string) (PRDConnector, error) {
	v, err := store.GetConnector(ctx, id)
	if errors.Is(err, ErrPRDRecordNotFound) || err == nil && v.UserID != model.CurrentUser(ctx).ID {
		return v, prdError("CONNECTOR_NOT_FOUND")
	}
	return v, err
}

func authenticatedConnector(ctx context.Context, store PRDStore, id, token string) (PRDConnector, error) {
	v, err := ownedConnector(ctx, store, id)
	if err != nil {
		return v, err
	}
	if v.Disconnected {
		return v, prdError("CONNECTOR_DISCONNECTED")
	}
	if token == "" || subtle.ConstantTimeCompare([]byte(v.TokenHash), []byte(prdHash(token))) != 1 {
		return v, prdError("CONNECTOR_AUTH_REQUIRED")
	}
	return v, nil
}

func ownedImport(ctx context.Context, store PRDStore, id string) (PRDImport, error) {
	v, err := store.GetImport(ctx, id)
	if errors.Is(err, ErrPRDRecordNotFound) || err == nil && v.UserID != model.CurrentUser(ctx).ID {
		return v, prdError("PRD_IMPORT_NOT_FOUND")
	}
	return v, err
}

func expirePRD(ctx context.Context, store PRDStore, v *PRDImport) error {
	if v.Value.Status != "queued" && v.Value.Status != "fetching" && v.Value.Status != "ready" {
		return nil
	}
	expires, err := time.Parse(time.RFC3339Nano, v.Value.ExpiresAt)
	if err != nil {
		return err
	}
	code := ""
	if time.Now().After(expires) {
		code = "PRD_IMPORT_EXPIRED"
	}
	if v.Value.Status == "fetching" && time.Now().After(v.LeaseExpires) {
		code = "CONNECTOR_LOST"
	}
	if code == "" {
		return nil
	}
	v.Value.Status, v.Value.ErrorCode, v.Value.UpdatedAt = "expired", code, time.Now().UTC().Format(time.RFC3339Nano)
	if err = store.ClearCandidateFiles(ctx, v.Value.ID); err != nil {
		return err
	}
	return store.UpdateImport(ctx, *v)
}

func (s *PRD) CreateImport(ctx context.Context, campaign, url, connector, requestID string) (prd.Import, error) {
	normalized, err := prd.NormalizeURL(url)
	if err != nil {
		return prd.Import{}, prdError("INVALID_PRD_URL")
	}
	if strings.TrimSpace(requestID) == "" || len(requestID) > 200 {
		return prd.Import{}, prdError("INVALID_INPUT")
	}
	var result prd.Import
	err = s.mutate(ctx, func(store PRDStore) error {
		exists, err := store.CampaignExists(ctx, campaign)
		if err != nil {
			return err
		}
		if !exists {
			return prdError("CAMPAIGN_NOT_FOUND")
		}
		executor, err := ownedConnector(ctx, store, connector)
		if err != nil {
			return err
		}
		hash := prdHash(normalized.URL + "\x00" + connector)
		previous, err := store.FindImport(ctx, model.CurrentUser(ctx).ID, campaign, requestID)
		if err == nil {
			if previous.RequestHash != hash {
				return prdError("PRD_REQUEST_CONFLICT")
			}
			if err = expirePRD(ctx, store, &previous); err != nil {
				return err
			}
			result = previous.Value
			return nil
		}
		if !errors.Is(err, ErrPRDRecordNotFound) {
			return err
		}
		seen, err := time.Parse(time.RFC3339Nano, executor.Value.LastSeenAt)
		if err != nil {
			return err
		}
		if executor.Disconnected || time.Since(seen) > connectorOnlineFor {
			return prdError("CONNECTOR_OFFLINE")
		}
		current, err := store.CurrentSnapshot(ctx, campaign)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		result = prd.Import{ID: uuid.NewString(), CampaignID: campaign, ConnectorID: connector, URL: normalized.URL, Status: "queued", BaseSnapshotID: current, CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), ExpiresAt: now.Add(queuedImportTTL).Format(time.RFC3339Nano), CreatedBy: model.CurrentUser(ctx)}
		return store.InsertImport(ctx, PRDImport{Value: result, UserID: model.CurrentUser(ctx).ID, ClientRequestID: requestID, RequestHash: hash})
	})
	return result, err
}

func (s *PRD) GetImport(ctx context.Context, id string) (prd.Import, error) {
	var record PRDImport
	err := s.mutate(ctx, func(store PRDStore) error {
		var err error
		record, err = ownedImport(ctx, store, id)
		if err != nil {
			return err
		}
		return expirePRD(ctx, store, &record)
	})
	return record.Value, err
}

func (s *PRD) Poll(ctx context.Context, connector, token, activeID string, attempt int, claimToken string) (*prd.Claim, error) {
	var result *prd.Claim
	var stateErr error
	err := s.mutate(ctx, func(store PRDStore) error {
		executor, err := authenticatedConnector(ctx, store, connector, token)
		if err != nil {
			return err
		}
		executor.Value.LastSeenAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err = store.UpdateConnector(ctx, executor); err != nil {
			return err
		}
		if activeID != "" {
			task, err := ownedImport(ctx, store, activeID)
			if err != nil {
				return err
			}
			if task.Value.ConnectorID != connector || task.Value.Attempt != attempt || claimToken == "" || subtle.ConstantTimeCompare([]byte(task.ClaimHash), []byte(prdHash(claimToken))) != 1 {
				return prdError("PRD_CLAIM_INVALID")
			}
			if err = expirePRD(ctx, store, &task); err != nil {
				return err
			}
			if task.Value.Status != "fetching" {
				stateErr = prdError("PRD_IMPORT_" + strings.ToUpper(task.Value.Status))
				return nil
			}
			task.LeaseExpires = time.Now().UTC().Add(claimLeaseFor)
			task.Value.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			if err = store.UpdateImport(ctx, task); err != nil {
				return err
			}
			result = &prd.Claim{ImportID: task.Value.ID, CampaignID: task.Value.CampaignID, URL: task.Value.URL, Attempt: attempt, ClaimToken: claimToken, LeaseExpiresAt: task.LeaseExpires.Format(time.RFC3339Nano)}
			return nil
		}
		tasks, err := store.PendingImports(ctx, connector)
		if err != nil {
			return err
		}
		for _, task := range tasks {
			if err = expirePRD(ctx, store, &task); err != nil {
				return err
			}
			if task.Value.Status != "queued" {
				continue
			}
			token, err := prdToken()
			if err != nil {
				return err
			}
			now := time.Now().UTC()
			task.Value.Status, task.Value.Attempt, task.Value.UpdatedAt = "fetching", task.Value.Attempt+1, now.Format(time.RFC3339Nano)
			task.Value.Phase = "reading"
			task.Value.ExpiresAt = now.Add(fetchingImportTTL).Format(time.RFC3339Nano)
			task.ClaimHash, task.LeaseExpires = prdHash(token), now.Add(claimLeaseFor)
			if err = store.UpdateImport(ctx, task); err != nil {
				return err
			}
			result = &prd.Claim{ImportID: task.Value.ID, CampaignID: task.Value.CampaignID, URL: task.Value.URL, Attempt: task.Value.Attempt, ClaimToken: token, LeaseExpiresAt: task.LeaseExpires.Format(time.RFC3339Nano)}
			break
		}
		return nil
	})
	if err == nil {
		err = stateErr
	}
	return result, err
}

func (s *PRD) CancelImport(ctx context.Context, id string) error {
	return s.mutate(ctx, func(store PRDStore) error {
		v, err := ownedImport(ctx, store, id)
		if err != nil {
			return err
		}
		if v.Value.Status == "confirmed" {
			return prdError("PRD_ALREADY_CONFIRMED")
		}
		if v.Value.Status == "cancelled" {
			return nil
		}
		v.Value.Status, v.Value.UpdatedAt = "cancelled", time.Now().UTC().Format(time.RFC3339Nano)
		if err = store.ClearCandidateFiles(ctx, id); err != nil {
			return err
		}
		return store.UpdateImport(ctx, v)
	})
}

func (s *PRD) Snapshots(ctx context.Context, campaign string) (prd.SnapshotList, error) {
	s.mutations.Lock()
	defer s.mutations.Unlock()
	exists, err := s.store.CampaignExists(ctx, campaign)
	if err != nil {
		return prd.SnapshotList{}, err
	}
	if !exists {
		return prd.SnapshotList{}, prdError("CAMPAIGN_NOT_FOUND")
	}
	current, err := s.store.CurrentSnapshot(ctx, campaign)
	if err != nil {
		return prd.SnapshotList{}, err
	}
	items, err := s.store.ListSnapshots(ctx, campaign)
	return prd.SnapshotList{CurrentSnapshotID: current, Items: items}, err
}

func (s *PRD) Snapshot(ctx context.Context, id string) (prd.Snapshot, error) {
	v, err := s.store.GetSnapshot(ctx, id)
	if errors.Is(err, ErrPRDRecordNotFound) {
		return v, prdError("PRD_SNAPSHOT_NOT_FOUND")
	}
	return v, err
}
