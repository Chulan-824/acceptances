package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Server struct {
	db  *sql.DB
	dir string
	mu  sync.Mutex
}
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

func Open(dir string) (*Server, error) {
	if err := os.MkdirAll(filepath.Join(dir, "evidence"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Server{db: db, dir: dir}
	if _, err = db.Exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;"); err != nil {
		db.Close()
		return nil, err
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 2 {
		db.Close()
		return nil, fmt.Errorf("database schema version %d is newer than supported version 2", version)
	}
	if version == 0 {
		if _, err = db.Exec(`BEGIN;

 CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,source TEXT NOT NULL,UNIQUE(project_id,source));
 CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',latest_run_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,submission_id TEXT NOT NULL UNIQUE,hash TEXT NOT NULL,report TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',void_reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
 PRAGMA user_version=1; COMMIT;`); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err = s.migrateCheckReviews(version == 1); err != nil {
		db.Close()
		return nil, err
	}
	if err = s.cleanupOrphans(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Server) Close() error                    { return s.db.Close() }
func (s *Server) Ready(ctx context.Context) error { return s.db.PingContext(ctx) }
func id() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"code": code, "message": strings.ReplaceAll(strings.ToLower(code), "_", " ")})
}

// lookupFailure distinguishes a missing record from an unreadable archive.
func lookupFailure(w http.ResponseWriter, r *http.Request, err error, missing string) {
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusNotFound, missing)
		return
	}
	slog.ErrorContext(r.Context(), "archive lookup failed", "method", r.Method, "path", r.URL.Path, "error", err)
	fail(w, http.StatusInternalServerError, "READ_FAILED")
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "INVALID_INPUT")
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		fail(w, 400, "INVALID_INPUT")
		return false
	}
	return true
}
func (s *Server) Handler() http.Handler { m := http.NewServeMux(); s.Register(m); return s.Guard(m) }
func (s *Server) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		host := r.Host
		if parsed, _, err := net.SplitHostPort(host); err == nil {
			host = parsed
		}
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			fail(w, 403, "LOCAL_HOST_REQUIRED")
			return
		}
		if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host && r.Header.Get("Origin") != "https://"+r.Host {
			fail(w, 403, "ORIGIN_NOT_ALLOWED")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) Register(m *http.ServeMux) {
	m.HandleFunc("POST /api/v1/projects", s.createProject)
	m.HandleFunc("GET /api/v1/projects", s.listProjects)
	m.HandleFunc("GET /api/v1/projects/{id}", s.getProject)
	m.HandleFunc("GET /api/v1/projects/{id}/repositories", s.repositories)
	m.HandleFunc("POST /api/v1/projects/{id}/repositories", s.repositories)
	m.HandleFunc("GET /api/v1/projects/{id}/campaigns", s.campaigns)
	m.HandleFunc("POST /api/v1/projects/{id}/campaigns", s.campaigns)
	m.HandleFunc("GET /api/v1/campaigns/{id}", s.getCampaign)
	m.HandleFunc("POST /api/v1/campaigns/{id}/runs", s.submitRun)
	m.HandleFunc("GET /api/v1/campaigns/{id}/runs", s.listRuns)
	m.HandleFunc("GET /api/v1/runs/{id}", s.getRun)
	m.HandleFunc("GET /api/v1/runs/{id}/evidence/{filename}", s.evidence)
	m.HandleFunc("POST /api/v1/runs/{id}/reviews", s.review)
	m.HandleFunc("POST /api/v1/runs/{id}/void", s.voidRun)
	for _, kind := range []string{"projects", "campaigns", "runs"} {
		m.HandleFunc("GET /api/v1/"+kind+"/{id}/delete-preview", func(w http.ResponseWriter, r *http.Request) { s.deleteScope(w, r, kind, false) })
		m.HandleFunc("DELETE /api/v1/"+kind+"/{id}", func(w http.ResponseWriter, r *http.Request) { s.deleteScope(w, r, kind, true) })
	}
}
func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var p Project
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		fail(w, 400, "NAME_REQUIRED")
		return
	}
	p = Project{id(), input.Name, input.Description, now()}
	if _, e := s.db.ExecContext(r.Context(), "INSERT INTO projects VALUES(?,?,?,?)", p.ID, p.Name, p.Description, p.CreatedAt); e != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	respond(w, 201, p)
}
func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	p, e := s.project(r.PathValue("id"))
	if e != nil {
		lookupFailure(w, r, e, "PROJECT_NOT_FOUND")
		return
	}
	respond(w, 200, p)
}
func (s *Server) project(key string) (Project, error) {
	var p Project
	e := s.db.QueryRow("SELECT id,name,description,created_at FROM projects WHERE id=?", key).Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt)
	return p, e
}
func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.QueryContext(r.Context(), "SELECT id,name,description,created_at FROM projects ORDER BY created_at,id")
	if e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if e = rows.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt); e != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		out = append(out, p)
	}
	if e = rows.Err(); e != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 200, map[string]any{"items": out})
}
