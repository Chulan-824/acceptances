package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

func (s *Server) delivery(key string) (DeliverySnapshot, error) {
	var snapshot DeliverySnapshot
	var raw string
	err := s.db.QueryRow(`SELECT id,version,request_id,status,created_at,content_hash,payload,successor_id,
 EXISTS(SELECT 1 FROM runs WHERE id=source_run_id) FROM delivery_snapshots WHERE id=?`, key).Scan(
		&snapshot.ID, &snapshot.Version, &snapshot.RequestID, &snapshot.Status, &snapshot.CreatedAt, &snapshot.SHA256, &raw, &snapshot.SuccessorID, &snapshot.SourceRunAvailable)
	if err != nil {
		return snapshot, err
	}
	if digestBytes([]byte(raw)) != snapshot.SHA256 {
		return snapshot, fmt.Errorf("delivery payload integrity failure")
	}
	if err = json.Unmarshal([]byte(raw), &snapshot.Payload); err != nil {
		return snapshot, err
	}
	snapshot.Events = []DeliveryEvent{}
	rows, err := s.db.Query("SELECT id,kind,reason,reference,created_at FROM delivery_events WHERE delivery_id=? ORDER BY rowid", key)
	if err != nil {
		return snapshot, err
	}
	defer rows.Close()
	for rows.Next() {
		var event DeliveryEvent
		if err = rows.Scan(&event.ID, &event.Kind, &event.Reason, &event.Reference, &event.CreatedAt); err != nil {
			return snapshot, err
		}
		snapshot.Events = append(snapshot.Events, event)
	}
	return snapshot, rows.Err()
}

func (s *Server) respondDelivery(w http.ResponseWriter, r *http.Request, key string, status int) {
	snapshot, err := s.delivery(key)
	if err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	respond(w, status, snapshot)
}

func (s *Server) getDelivery(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.respondDelivery(w, r, r.PathValue("id"), 200)
}

func (s *Server) listDeliveries(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	where := "1=1"
	args := []any{}
	for _, filter := range []struct{ query, column string }{{"projectId", "project_id"}, {"campaignId", "campaign_id"}, {"runId", "source_run_id"}} {
		if value := r.URL.Query().Get(filter.query); value != "" {
			where += " AND " + filter.column + "=?"
			args = append(args, value)
		}
	}
	items, err := s.deliverySummaries(r.Context(), where, args...)
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (s *Server) deliverySummaries(ctx context.Context, where string, args ...any) ([]DeliverySummary, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,version,status,created_at,project_id,campaign_id,source_run_id,successor_id,payload FROM delivery_snapshots WHERE "+where+" ORDER BY created_at DESC,rowid DESC", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []DeliverySummary{}
	for rows.Next() {
		var item DeliverySummary
		var raw string
		if err = rows.Scan(&item.ID, &item.Version, &item.Status, &item.CreatedAt, &item.ProjectID, &item.CampaignID, &item.RunID, &item.SuccessorID, &raw); err != nil {
			return nil, err
		}
		var names struct {
			Project  Project  `json:"project"`
			Campaign Campaign `json:"campaign"`
		}
		if err = json.Unmarshal([]byte(raw), &names); err != nil {
			return nil, err
		}
		item.ProjectName, item.CampaignTitle = names.Project.Name, names.Campaign.Title
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) deliveryEvidence(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	snapshot, err := s.delivery(r.PathValue("id"))
	s.mu.Unlock()
	if err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	name := r.PathValue("filename")
	for _, file := range snapshot.Payload.Files {
		if file.Path == name {
			serveVerifiedEvidence(w, r, s.dir+"/deliveries/"+snapshot.ID+"/evidence", name, &file)
			return
		}
	}
	fail(w, 404, "EVIDENCE_NOT_FOUND")
}

func (s *Server) downloadDelivery(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, err := s.delivery(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="delivery-snapshot.json"`)
	respond(w, 200, snapshot)
}
