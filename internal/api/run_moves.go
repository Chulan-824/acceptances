package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// RunMove records a correction of ownership, separately from verification facts.
type RunMove struct {
	ID             string `json:"id"`
	RunID          string `json:"runId"`
	RequestID      string `json:"requestId"`
	FromCampaignID string `json:"fromCampaignId"`
	ToCampaignID   string `json:"toCampaignId"`
	Reason         string `json:"reason"`
	CreatedAt      string `json:"createdAt"`
}

type MoveRunInput struct {
	RequestID      string `json:"requestId"`
	FromCampaignID string `json:"fromCampaignId"`
	ToCampaignID   string `json:"toCampaignId"`
	Reason         string `json:"reason"`
}

type moveFailure struct {
	status int
	code   string
}

func (e *moveFailure) Error() string { return e.code }
func moveConflict(code string) error { return &moveFailure{http.StatusConflict, code} }

func (s *Server) moveRun(w http.ResponseWriter, r *http.Request) {
	var in MoveRunInput
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.RequestID) == "" || len(in.RequestID) > 200 || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 4000 || in.FromCampaignID == "" || in.ToCampaignID == "" || in.FromCampaignID == in.ToCampaignID {
		fail(w, 400, "INVALID_MOVE_INPUT")
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
	move, created, err := s.applyRunMove(r.Context(), tx, r.PathValue("id"), in)
	if err != nil {
		var failure *moveFailure
		if errors.As(err, &failure) {
			fail(w, failure.status, failure.code)
		} else {
			slog.ErrorContext(r.Context(), "run move failed", "runId", r.PathValue("id"), "error", err)
			fail(w, 500, "SAVE_FAILED")
		}
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	run, err := s.run(move.RunID)
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	respond(w, status, struct {
		Move RunMove `json:"move"`
		Run  Run     `json:"run"`
	}{move, run})
}

func (s *Server) applyRunMove(ctx context.Context, tx *sql.Tx, runID string, in MoveRunInput) (RunMove, bool, error) {
	var move RunMove
	err := tx.QueryRowContext(ctx, `SELECT id,run_id,request_id,from_campaign_id,to_campaign_id,reason,created_at FROM run_moves WHERE request_id=?`, in.RequestID).Scan(&move.ID, &move.RunID, &move.RequestID, &move.FromCampaignID, &move.ToCampaignID, &move.Reason, &move.CreatedAt)
	if err == nil {
		if move.RunID != runID || move.FromCampaignID != in.FromCampaignID || move.ToCampaignID != in.ToCampaignID || move.Reason != in.Reason {
			return move, false, moveConflict("MOVE_REQUEST_CONFLICT")
		}
		return move, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return move, false, err
	}
	var current, raw, projectID string
	err = tx.QueryRowContext(ctx, `SELECT r.campaign_id,r.report,c.project_id FROM runs r JOIN campaigns c ON c.id=r.campaign_id WHERE r.id=?`, runID).Scan(&current, &raw, &projectID)
	if errors.Is(err, sql.ErrNoRows) {
		return move, false, &moveFailure{404, "RUN_NOT_FOUND"}
	}
	if err != nil {
		return move, false, err
	}
	if current != in.FromCampaignID {
		return move, false, moveConflict("RUN_CAMPAIGN_CHANGED")
	}
	var targetProject string
	err = tx.QueryRowContext(ctx, `SELECT project_id FROM campaigns WHERE id=?`, in.ToCampaignID).Scan(&targetProject)
	if errors.Is(err, sql.ErrNoRows) {
		return move, false, &moveFailure{404, "CAMPAIGN_NOT_FOUND"}
	}
	if err != nil {
		return move, false, err
	}
	if targetProject != projectID {
		return move, false, moveConflict("CROSS_PROJECT_MOVE_FORBIDDEN")
	}
	var grouped bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM run_consolidations WHERE source_run_id=? OR primary_run_id=?)`, runID, runID).Scan(&grouped); err != nil {
		return move, false, err
	}
	if grouped {
		return move, false, moveConflict("RUN_HAS_CONSOLIDATION")
	}
	var frozen bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM delivery_snapshots WHERE source_run_id=?)`, runID).Scan(&frozen); err != nil {
		return move, false, err
	}
	if frozen {
		return move, false, moveConflict("RUN_HAS_FROZEN_DELIVERY")
	}
	// A single-Run move cannot split the same-Campaign feedback relationship.
	var doc Report
	if err = json.Unmarshal([]byte(raw), &doc); err != nil {
		return move, false, err
	}
	var referenced bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM runs WHERE `+s.followUpSourceSQL()+`=?)`, runID).Scan(&referenced); err != nil {
		return move, false, err
	}
	if doc.FollowUp != nil || referenced {
		return move, false, moveConflict("RUN_HAS_FEEDBACK_LINKS")
	}
	move = RunMove{ID: id(), RunID: runID, RequestID: in.RequestID, FromCampaignID: current, ToCampaignID: in.ToCampaignID, Reason: in.Reason, CreatedAt: now()}
	if _, err = tx.ExecContext(ctx, `UPDATE runs SET campaign_id=? WHERE id=?`, in.ToCampaignID, runID); err != nil {
		return move, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO run_moves(id,run_id,request_id,from_campaign_id,to_campaign_id,reason,created_at) VALUES(?,?,?,?,?,?,?)`, move.ID, move.RunID, move.RequestID, move.FromCampaignID, move.ToCampaignID, move.Reason, move.CreatedAt); err != nil {
		return move, false, err
	}
	for _, campaignID := range []string{current, in.ToCampaignID} {
		if err = s.refreshCampaignAfterMove(ctx, tx, campaignID); err != nil {
			return move, false, err
		}
	}
	return move, true, nil
}

func (s *Server) refreshCampaignAfterMove(ctx context.Context, tx *sql.Tx, campaignID string) error {
	var latest, raw, status string
	// Publication order is unchanged by moving an existing row.
	err := tx.QueryRowContext(ctx, `SELECT id,report,status FROM runs WHERE campaign_id=? AND NOT EXISTS(SELECT 1 FROM run_consolidations c WHERE c.source_run_id=runs.id) ORDER BY `+s.orderColumn()+` DESC LIMIT 1`, campaignID).Scan(&latest, &raw, &status)
	if errors.Is(err, sql.ErrNoRows) {
		latest = ""
		status = "pending"
	} else if err != nil {
		return err
	} else {
		var doc Report
		if err = json.Unmarshal([]byte(raw), &doc); err != nil {
			return err
		}
		if status != "accepted" || doc.ScopeType != "full" {
			status = "pending"
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE campaigns SET latest_run_id=?,status=? WHERE id=?`, latest, status, campaignID)
	return err
}

func (s *Server) runMoves(runID string) ([]RunMove, error) {
	rows, err := s.db.Query(`SELECT id,run_id,request_id,from_campaign_id,to_campaign_id,reason,created_at FROM run_moves WHERE run_id=? ORDER BY `+s.orderColumn(), runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	moves := []RunMove{}
	for rows.Next() {
		var move RunMove
		if err = rows.Scan(&move.ID, &move.RunID, &move.RequestID, &move.FromCampaignID, &move.ToCampaignID, &move.Reason, &move.CreatedAt); err != nil {
			return nil, err
		}
		moves = append(moves, move)
	}
	return moves, rows.Err()
}

func (r Run) materialsCampaignID() (string, error) {
	if len(r.Moves) == 0 {
		return r.CampaignID, nil
	}
	current := r.Moves[0].FromCampaignID
	original := current
	for _, move := range r.Moves {
		if move.RunID != r.ID || move.FromCampaignID != current {
			return "", fmt.Errorf("Run 迁移记录不连续。")
		}
		current = move.ToCampaignID
	}
	if current != r.CampaignID {
		return "", fmt.Errorf("Run 迁移记录与当前归属不一致。")
	}
	return original, nil
}
