package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Submission retries are handled before this validation: an immutable follow-up
// remains retryable even after its source has been explicitly deleted.
func (s *Server) validateFollowUpSource(w http.ResponseWriter, r *http.Request, followUp *FollowUp) bool {
	if followUp == nil {
		return true
	}
	var campaignID string
	err := s.db.QueryRowContext(r.Context(), "SELECT campaign_id FROM runs WHERE id=?", followUp.SourceRunID).Scan(&campaignID)
	if err == sql.ErrNoRows || (err == nil && campaignID != r.PathValue("id")) {
		fail(w, 400, "INVALID_FOLLOW_UP_SOURCE")
		return false
	}
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return false
	}
	for _, response := range followUp.Responses {
		var reviewID string
		err = s.db.QueryRowContext(r.Context(), "SELECT id FROM reviews WHERE id=? AND run_id=?", response.ReviewID, followUp.SourceRunID).Scan(&reviewID)
		if err == sql.ErrNoRows {
			fail(w, 400, "INVALID_FOLLOW_UP_REVIEW")
			return false
		}
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return false
		}
	}
	return true
}

func (s *Server) deriveFeedbackResponses(v *Run) error {
	v.FeedbackResponses = []RunFeedbackResponse{}
	if v.Report.FollowUp != nil {
		var available bool
		if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM runs WHERE id=?)", v.Report.FollowUp.SourceRunID).Scan(&available); err != nil {
			return err
		}
		v.SourceRunAvailable = &available
	}
	rows, err := s.db.Query("SELECT id,report FROM runs WHERE campaign_id=? AND id<>? ORDER BY rowid", v.CampaignID, v.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var runID, raw string
		if err = rows.Scan(&runID, &raw); err != nil {
			return err
		}
		var report Report
		if err = json.Unmarshal([]byte(raw), &report); err != nil {
			return err
		}
		if report.FollowUp == nil || report.FollowUp.SourceRunID != v.ID {
			continue
		}
		for _, response := range report.FollowUp.Responses {
			v.FeedbackResponses = append(v.FeedbackResponses, RunFeedbackResponse{RunID: runID, ReviewID: response.ReviewID, Explanation: response.Explanation, CheckIDs: response.CheckIDs})
		}
	}
	return rows.Err()
}
