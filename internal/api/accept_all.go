package api

import "net/http"

const bulkAcceptanceBody = "一键交付：人工确认本轮全部检查项通过。"

// acceptAll records the user's explicit bulk judgment, preserving item history.
// Unlike individual acceptance, this action does not require a written reason.
func (s *Server) acceptAll(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, err := s.run(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	if v.Status == "void" {
		fail(w, http.StatusConflict, "RUN_VOID")
		return
	}
	added := []Review{}
	createdAt := now()
	for _, judgment := range v.CheckReviews {
		if judgment.Status == "accepted" {
			continue
		}
		added = append(added, Review{
			ID: id(), RunID: v.ID, CheckID: judgment.CheckID,
			Kind: "accepted", Body: bulkAcceptanceBody, CreatedAt: createdAt,
		})
	}
	if len(added) == 0 {
		respond(w, http.StatusOK, v)
		return
	}
	v.Reviews = append(v.Reviews, added...)
	v.deriveCheckReviews()
	v.Status = v.humanStatus()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, http.StatusInternalServerError, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	for _, review := range added {
		if _, err = tx.ExecContext(r.Context(), "INSERT INTO reviews(id,run_id,kind,body,created_at,check_id,legacy) VALUES(?,?,?,?,?,?,0)", review.ID, review.RunID, review.Kind, review.Body, review.CreatedAt, review.CheckID); err != nil {
			break
		}
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE runs SET status=? WHERE id=?", v.Status, v.ID)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "UPDATE campaigns SET status=? WHERE id=? AND latest_run_id=?", v.campaignStatus(), v.CampaignID, v.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "SAVE_FAILED")
		return
	}
	respond(w, http.StatusOK, v)
}
