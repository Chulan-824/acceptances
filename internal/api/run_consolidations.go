package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// RunConsolidation groups an earlier verification under a complete later Run.
// It never combines check results or changes either original report.
type RunConsolidation struct {
	ID             string `json:"id"`
	RequestID      string `json:"requestId"`
	SourceRunID    string `json:"sourceRunId"`
	PrimaryRunID   string `json:"primaryRunId"`
	FromCampaignID string `json:"fromCampaignId"`
	Reason         string `json:"reason"`
	CreatedAt      string `json:"createdAt"`
}
type ConsolidatedRun struct {
	RunConsolidation
	Title         string `json:"title"`
	VerifiedAt    string `json:"verifiedAt"`
	EvidenceCount int    `json:"evidenceCount"`
}
type ConsolidateRunInput struct {
	RequestID      string `json:"requestId"`
	SourceRunID    string `json:"sourceRunId"`
	FromCampaignID string `json:"fromCampaignId"`
	Reason         string `json:"reason"`
}

func (s *Server) consolidateRun(w http.ResponseWriter, r *http.Request) {
	var in ConsolidateRunInput
	if !decode(w, r, &in) {
		return
	}
	primaryID := r.PathValue("id")
	if strings.TrimSpace(in.RequestID) == "" || len(in.RequestID) > 200 || in.SourceRunID == "" || in.SourceRunID == primaryID || in.FromCampaignID == "" || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 4000 {
		fail(w, 400, "INVALID_CONSOLIDATION_INPUT")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	var c RunConsolidation
	err = tx.QueryRowContext(r.Context(), `SELECT id,request_id,source_run_id,primary_run_id,from_campaign_id,reason,created_at FROM run_consolidations WHERE request_id=?`, in.RequestID).Scan(&c.ID, &c.RequestID, &c.SourceRunID, &c.PrimaryRunID, &c.FromCampaignID, &c.Reason, &c.CreatedAt)
	created := false
	if err == nil {
		if c.SourceRunID != in.SourceRunID || c.PrimaryRunID != primaryID || c.FromCampaignID != in.FromCampaignID || c.Reason != in.Reason {
			fail(w, 409, "CONSOLIDATION_REQUEST_CONFLICT")
			return
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		var sourceRaw, primaryRaw, sourceCampaign, primaryCampaign, sourceProject, primaryProject, sourceStatus, primaryStatus string
		var sourceOrder, primaryOrder int64
		read := func(key string, raw, campaign, project, status *string, order *int64) error {
			return tx.QueryRowContext(r.Context(), `SELECT r.report,r.campaign_id,c.project_id,r.status,r.`+s.orderColumn()+` FROM runs r JOIN campaigns c ON c.id=r.campaign_id WHERE r.id=?`, key).Scan(raw, campaign, project, status, order)
		}
		if err = read(in.SourceRunID, &sourceRaw, &sourceCampaign, &sourceProject, &sourceStatus, &sourceOrder); err == nil {
			err = read(primaryID, &primaryRaw, &primaryCampaign, &primaryProject, &primaryStatus, &primaryOrder)
		}
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "RUN_NOT_FOUND")
			return
		}
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if sourceCampaign != in.FromCampaignID {
			fail(w, 409, "RUN_CAMPAIGN_CHANGED")
			return
		}
		if sourceProject != primaryProject {
			fail(w, 409, "CROSS_PROJECT_MOVE_FORBIDDEN")
			return
		}
		if sourceStatus == "void" || primaryStatus == "void" {
			fail(w, 409, "RUN_VOID")
			return
		}
		if sourceOrder >= primaryOrder {
			fail(w, 409, "LATER_PRIMARY_RUN_REQUIRED")
			return
		}
		var conflict bool
		err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM run_consolidations WHERE source_run_id IN (?,?) OR primary_run_id=?)`, in.SourceRunID, primaryID, in.SourceRunID).Scan(&conflict)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if conflict {
			fail(w, 409, "RUN_ALREADY_CONSOLIDATED")
			return
		}
		err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM delivery_snapshots WHERE source_run_id IN (?,?))`, in.SourceRunID, primaryID).Scan(&conflict)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if conflict {
			fail(w, 409, "RUN_HAS_FROZEN_DELIVERY")
			return
		}
		var source, primary Report
		if err = json.Unmarshal([]byte(sourceRaw), &source); err == nil {
			err = json.Unmarshal([]byte(primaryRaw), &primary)
		}
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM runs WHERE `+s.followUpSourceSQL()+` IN (?,?))`, in.SourceRunID, primaryID).Scan(&conflict)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		if conflict || source.FollowUp != nil || primary.FollowUp != nil {
			fail(w, 409, "RUN_HAS_FEEDBACK_LINKS")
			return
		}
		sourceTime, e1 := time.Parse(time.RFC3339Nano, source.VerifiedAt)
		primaryTime, e2 := time.Parse(time.RFC3339Nano, primary.VerifiedAt)
		if e1 != nil || e2 != nil || primaryTime.Before(sourceTime) || !consolidationCoverageMatches(source, primary) {
			fail(w, 409, "CONSOLIDATION_COVERAGE_MISMATCH")
			return
		}
		if sourceCampaign != primaryCampaign {
			_, _, err = s.applyRunMove(r.Context(), tx, in.SourceRunID, MoveRunInput{RequestID: id(), FromCampaignID: sourceCampaign, ToCampaignID: primaryCampaign, Reason: in.Reason})
			if err != nil {
				fail(w, 500, "SAVE_FAILED")
				return
			}
		}
		c = RunConsolidation{ID: id(), RequestID: in.RequestID, SourceRunID: in.SourceRunID, PrimaryRunID: primaryID, FromCampaignID: sourceCampaign, Reason: in.Reason, CreatedAt: now()}
		_, err = tx.ExecContext(r.Context(), `INSERT INTO run_consolidations(id,request_id,source_run_id,primary_run_id,from_campaign_id,reason,created_at) VALUES(?,?,?,?,?,?,?)`, c.ID, c.RequestID, c.SourceRunID, c.PrimaryRunID, c.FromCampaignID, c.Reason, c.CreatedAt)
		if err == nil {
			err = s.refreshCampaignAfterMove(r.Context(), tx, sourceCampaign)
		}
		if err == nil && sourceCampaign != primaryCampaign {
			err = s.refreshCampaignAfterMove(r.Context(), tx, primaryCampaign)
		}
		created = true
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "run consolidation failed", "error", err)
		fail(w, 500, "SAVE_FAILED")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	run, err := s.run(primaryID)
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	status := 200
	if created {
		status = 201
	}
	respond(w, status, struct {
		Consolidation RunConsolidation `json:"consolidation"`
		Run           Run              `json:"run"`
	}{c, run})
}

func consolidationCoverageMatches(source, primary Report) bool {
	if primary.ScopeType != "full" || source.ScopeType != "full" || !sameSources(source.Versions, primary.Versions) || len(source.Checks) != len(primary.Checks) {
		return false
	}
	checks := make(map[string]Check, len(primary.Checks))
	for _, c := range primary.Checks {
		checks[c.ID] = c
	}
	for _, s := range source.Checks {
		p, ok := checks[s.ID]
		if !ok || p.Expected != s.Expected || p.Status != s.Status {
			return false
		}
	}
	return source.Environment == primary.Environment && source.Scope == primary.Scope
}

func (s *Server) loadRunConsolidations(v *Run) error {
	rows, err := s.db.Query(`SELECT c.id,c.request_id,c.source_run_id,c.primary_run_id,c.from_campaign_id,c.reason,c.created_at,r.report FROM run_consolidations c JOIN runs r ON r.id=c.source_run_id WHERE c.source_run_id=? OR c.primary_run_id=? ORDER BY c.`+s.orderColumn(), v.ID, v.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var c ConsolidatedRun
		var raw string
		if err = rows.Scan(&c.ID, &c.RequestID, &c.SourceRunID, &c.PrimaryRunID, &c.FromCampaignID, &c.Reason, &c.CreatedAt, &raw); err != nil {
			return err
		}
		if c.SourceRunID == v.ID {
			v.ConsolidatedInto = &c.RunConsolidation
			continue
		}
		var doc Report
		if err = json.Unmarshal([]byte(raw), &doc); err != nil {
			return err
		}
		c.Title, c.VerifiedAt, c.EvidenceCount = doc.Title, doc.VerifiedAt, len(doc.Evidence)
		v.ConsolidatedRuns = append(v.ConsolidatedRuns, c)
	}
	return rows.Err()
}
