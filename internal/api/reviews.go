package api

import (
	"github.com/Chulan-824/acceptances/internal/model"
	"net/http"
	"strings"
)

func (v *Run) deriveCheckReviews() {
	current := make(map[string]CheckReview, len(v.Report.Checks))
	for _, check := range v.Report.Checks {
		current[check.ID] = CheckReview{CheckID: check.ID, Status: "pending"}
	}
	for _, review := range v.Reviews {
		if review.Legacy || review.CheckID == "" || review.Kind == "comment" {
			continue
		}
		if _, exists := current[review.CheckID]; exists {
			current[review.CheckID] = CheckReview{CheckID: review.CheckID, Status: review.Kind, LastReviewID: review.ID}
		}
	}
	v.CheckReviews = make([]CheckReview, 0, len(v.Report.Checks))
	v.ReviewCounts = ReviewCounts{}
	for _, check := range v.Report.Checks {
		judgment := current[check.ID]
		v.CheckReviews = append(v.CheckReviews, judgment)
		switch judgment.Status {
		case "accepted":
			v.ReviewCounts.Accepted++
		case "rejected":
			v.ReviewCounts.Rejected++
		default:
			v.ReviewCounts.Pending++
		}
	}
}

func (v Run) humanStatus() string {
	if v.Status == "void" {
		return "void"
	}
	if v.ReviewCounts.Rejected > 0 {
		return "rejected"
	}
	if v.ReviewCounts.Pending > 0 || len(v.Report.Checks) == 0 {
		return "pending"
	}
	return "accepted"
}

func (v Run) campaignStatus() string {
	status := v.humanStatus()
	if status == "void" || (status == "accepted" && v.Report.ScopeType != "full") {
		return "pending"
	}
	return status
}

func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind    string `json:"kind"`
		Body    string `json:"body"`
		CheckID string `json:"checkId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Kind != "comment" && in.Kind != "accepted" && in.Kind != "rejected" && in.Kind != "pending" {
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
		lookupFailure(w, r, e, "RUN_NOT_FOUND")
		return
	}
	if v.ConsolidatedInto != nil {
		fail(w, 409, "RUN_CONSOLIDATED")
		return
	}
	if v.Status == "void" && in.Kind != "comment" {
		fail(w, 409, "RUN_VOID")
		return
	}
	if in.CheckID == "" && in.Kind != "comment" {
		fail(w, 400, "CHECK_REQUIRED")
		return
	}
	if in.CheckID != "" {
		var check *Check
		for i := range v.Report.Checks {
			if v.Report.Checks[i].ID == in.CheckID {
				check = &v.Report.Checks[i]
				break
			}
		}
		if check == nil {
			fail(w, 400, "CHECK_NOT_FOUND")
			return
		}
		if (in.Kind == "rejected" || (in.Kind == "accepted" && check.Status != "passed")) && strings.TrimSpace(in.Body) == "" {
			fail(w, 400, "BODY_REQUIRED")
			return
		}
	}
	review := Review{ID: id(), RunID: v.ID, Kind: in.Kind, Body: in.Body, CreatedAt: now(), CheckID: in.CheckID, CreatedBy: model.CurrentUser(r.Context())}
	v.Reviews = append(v.Reviews, review)
	v.deriveCheckReviews()
	tx, e := s.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	if e = s.lockArchiveRow(r.Context(), tx, "runs", v.ID); e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	_, e = tx.ExecContext(r.Context(), "INSERT INTO reviews(id,run_id,kind,body,created_at,check_id,legacy,created_by) VALUES(?,?,?,?,?,?,0,?)", review.ID, review.RunID, review.Kind, review.Body, review.CreatedAt, review.CheckID, model.CurrentUserID(r.Context()))
	if e == nil && in.Kind != "comment" {
		_, e = tx.ExecContext(r.Context(), "UPDATE runs SET status=? WHERE id=?", v.humanStatus(), v.ID)
		if e == nil {
			_, e = tx.ExecContext(r.Context(), "UPDATE campaigns SET status=? WHERE id=? AND latest_run_id=?", v.campaignStatus(), v.CampaignID, v.ID)
		}
	}
	if e == nil && (in.Kind == "rejected" || in.Kind == "pending") {
		e = invalidateRunDeliveries(r.Context(), tx, v.ID, "检查项 "+in.CheckID+" 的人工接受已改判或撤回。"+in.Body, review.ID)
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
		lookupFailure(w, r, e, "RUN_NOT_FOUND")
		return
	}
	if v.ConsolidatedInto != nil {
		fail(w, 409, "RUN_CONSOLIDATED")
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
	if e = s.lockArchiveRow(r.Context(), tx, "runs", v.ID); e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	_, e = tx.ExecContext(r.Context(), "UPDATE runs SET status='void',void_reason=? WHERE id=?", in.Reason, v.ID)
	if e == nil {
		e = invalidateRunDeliveries(r.Context(), tx, v.ID, "来源验证记录已作废："+in.Reason, v.ID)
	}
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
