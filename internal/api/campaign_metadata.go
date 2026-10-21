package api

import "net/http"

// Requirement metadata is editable; archived reports and snapshots are not.
func (s *Server) updateCampaignDescription(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Description *string `json:"description"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Description == nil || len(*in.Description) > 65536 {
		fail(w, 400, "DESCRIPTION_REQUIRED")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.db.ExecContext(r.Context(), "UPDATE campaigns SET description=? WHERE id=?", *in.Description, r.PathValue("id"))
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	if affected == 0 {
		fail(w, 404, "CAMPAIGN_NOT_FOUND")
		return
	}
	campaign, err := s.campaign(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "CAMPAIGN_NOT_FOUND")
		return
	}
	respond(w, 200, campaign)
}
