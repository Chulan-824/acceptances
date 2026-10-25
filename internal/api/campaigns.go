package api

import (
	"net/http"
	"strings"

	"github.com/Chulan-824/acceptances/internal/model"
)

type Repository struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Source    string `json:"source"`
}

// Campaign remains an alias while legacy snapshots and Run handlers migrate.
type Campaign = model.Campaign

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
		query := "INSERT INTO repositories(id,project_id,name,source) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=id"
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
func (s *Server) campaign(key string) (Campaign, error) {
	var v Campaign
	var user model.User
	e := s.db.QueryRow("SELECT c.id,c.project_id,c.title,c.description,c.status,c.latest_run_id,c.created_at,COALESCE(u.id,''),COALESCE(u.username,'') FROM campaigns c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=?", key).Scan(&v.ID, &v.ProjectID, &v.Title, &v.Description, &v.Status, &v.LatestRunID, &v.CreatedAt, &user.ID, &user.Username)
	if user.ID != "" {
		v.CreatedBy = &user
	}
	return v, e
}
