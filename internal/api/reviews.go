package api

import (
	"net/http"
	"strings"
)

func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind string `json:"kind"`
		Body string `json:"body"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Kind != "comment" && in.Kind != "accepted" && in.Kind != "rejected" {
		fail(w, 400, "INVALID_REVIEW_KIND")
		return
	}
	if in.Kind == "comment" && strings.TrimSpace(in.Body) == "" {
		fail(w, 400, "BODY_REQUIRED")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, e := s.run(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "RUN_NOT_FOUND")
		return
	}
	if v.Status == "void" && in.Kind != "comment" {
		fail(w, 409, "RUN_VOID")
		return
	}
	review := Review{id(), v.ID, in.Kind, in.Body, now()}
	tx, e := s.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(r.Context(), "INSERT INTO reviews VALUES(?,?,?,?,?)", review.ID, review.RunID, review.Kind, review.Body, review.CreatedAt)
	if e == nil && in.Kind != "comment" {
		_, e = tx.ExecContext(r.Context(), "UPDATE runs SET status=? WHERE id=?", in.Kind, v.ID)
		if e == nil {
			_, e = tx.ExecContext(r.Context(), "UPDATE campaigns SET status=? WHERE id=? AND latest_run_id=?", in.Kind, v.CampaignID, v.ID)
		}
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	respond(w, 201, review)
}
func (s *Server) voidRun(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Reason) == "" {
		fail(w, 400, "REASON_REQUIRED")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, e := s.run(r.PathValue("id"))
	if e != nil {
		fail(w, 404, "RUN_NOT_FOUND")
		return
	}
	if v.Status == "void" {
		fail(w, 409, "RUN_ALREADY_VOID")
		return
	}
	tx, e := s.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(r.Context(), "UPDATE runs SET status='void',void_reason=? WHERE id=?", in.Reason, v.ID)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "UPDATE campaigns SET status='pending' WHERE id=? AND latest_run_id=?", v.CampaignID, v.ID)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	v.Status = "void"
	v.VoidReason = in.Reason
	respond(w, 200, v)
}
