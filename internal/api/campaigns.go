package api

import (
	"net/http"
	"strings"
)

type Repository struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Source    string `json:"source"`
}
type Campaign struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	LatestRunID string `json:"latestRunId"`
	CreatedAt   string `json:"createdAt"`
}

func (s *Server) repositories(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("id")
	if _, e := s.project(key); e != nil {
		lookupFailure(w, r, e, "PROJECT_NOT_FOUND")
		return
	}
	if r.Method == "POST" {
		var in struct {
			Name   string `json:"name"`
			Source string `json:"source"`
		}
		if !decode(w, r, &in) {
			return
		}
		if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Source) == "" {
			fail(w, 400, "NAME_AND_SOURCE_REQUIRED")
			return
		}
		v := Repository{id(), key, in.Name, in.Source}
		s.mu.Lock()
		defer s.mu.Unlock()
		query := "INSERT INTO repositories(id,project_id,name,source) VALUES(?,?,?,?) ON CONFLICT(project_id,source) DO NOTHING"
		if s.mysql {
			query = "INSERT INTO repositories(id,project_id,name,source) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=id"
		}
		_, e := s.db.ExecContext(r.Context(), query, v.ID, key, v.Name, v.Source)
		if e != nil {
			fail(w, 500, "SAVE_FAILED")
			return
		}
		e = s.db.QueryRowContext(r.Context(), "SELECT id,project_id,name,source FROM repositories WHERE project_id=? AND source=?", key, in.Source).Scan(&v.ID, &v.ProjectID, &v.Name, &v.Source)
		if e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		respond(w, 201, v)
		return
	}
	rows, e := s.db.QueryContext(r.Context(), "SELECT id,project_id,name,source FROM repositories WHERE project_id=? ORDER BY name,id", key)
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	defer rows.Close()
	out := []Repository{}
	for rows.Next() {
		var v Repository
		if e = rows.Scan(&v.ID, &v.ProjectID, &v.Name, &v.Source); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		out = append(out, v)
	}
	if rows.Err() != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 200, map[string]any{"items": out})
}
func (s *Server) campaigns(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("id")
	if _, e := s.project(key); e != nil {
		lookupFailure(w, r, e, "PROJECT_NOT_FOUND")
		return
	}
	if r.Method == "POST" {
		var in struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if !decode(w, r, &in) {
			return
		}
		if strings.TrimSpace(in.Title) == "" {
			fail(w, 400, "TITLE_REQUIRED")
			return
		}
		v := Campaign{id(), key, in.Title, in.Description, "pending", "", now()}
		if _, e := s.db.ExecContext(r.Context(), "INSERT INTO campaigns(id,project_id,title,description,status,latest_run_id,created_at) VALUES(?,?,?,?,?,?,?)", v.ID, v.ProjectID, v.Title, v.Description, v.Status, v.LatestRunID, v.CreatedAt); e != nil {
			fail(w, 500, "SAVE_FAILED")
			return
		}
		respond(w, 201, v)
		return
	}
	rows, e := s.db.QueryContext(r.Context(), "SELECT id,project_id,title,description,status,latest_run_id,created_at FROM campaigns WHERE project_id=? ORDER BY created_at DESC,id", key)
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	defer rows.Close()
	out := []Campaign{}
	for rows.Next() {
		var v Campaign
		if e = rows.Scan(&v.ID, &v.ProjectID, &v.Title, &v.Description, &v.Status, &v.LatestRunID, &v.CreatedAt); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		out = append(out, v)
	}
	if rows.Err() != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 200, map[string]any{"items": out})
}
func (s *Server) campaign(key string) (Campaign, error) {
	var v Campaign
	e := s.db.QueryRow("SELECT id,project_id,title,description,status,latest_run_id,created_at FROM campaigns WHERE id=?", key).Scan(&v.ID, &v.ProjectID, &v.Title, &v.Description, &v.Status, &v.LatestRunID, &v.CreatedAt)
	return v, e
}
func (s *Server) getCampaign(w http.ResponseWriter, r *http.Request) {
	v, e := s.campaign(r.PathValue("id"))
	if e != nil {
		lookupFailure(w, r, e, "CAMPAIGN_NOT_FOUND")
		return
	}
	respond(w, 200, v)
}
