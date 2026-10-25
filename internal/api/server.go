package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Chulan-824/acceptances/internal/dao"
	"github.com/Chulan-824/acceptances/internal/handler"
	"github.com/Chulan-824/acceptances/internal/service"
)

type Server struct {
	db        *sql.DB
	dir       string
	mu        sync.Mutex
	artifacts *deliveryArtifacts
	files     *fileArchive
	lease     *sql.Conn
	leaseName string
	leaseID   uint64
	directory *archiveDirectory
	closeOnce sync.Once
	closeErr  error
}
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

func (s *Server) Close() error {
	s.closeOnce.Do(func() {
		if s.directory != nil {
			s.directory.stop()
		}
		if s.lease != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = s.lease.ExecContext(ctx, "SELECT RELEASE_LOCK(?)", s.leaseName)
			_ = s.lease.Close()
		}
		s.closeErr = s.db.Close()
		if s.directory != nil {
			s.closeErr = errors.Join(s.closeErr, s.directory.release())
		}
	})
	return s.closeErr
}
func (s *Server) Ready(ctx context.Context) error {
	return s.checkMySQLLease(ctx)
}
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
	handler.WriteJSON(w, status, v)
}
func fail(w http.ResponseWriter, status int, code string) {
	handler.WriteError(w, status, code)
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
	if err := handler.DecodeJSON(w, r, v); err != nil {
		fail(w, http.StatusBadRequest, "INVALID_INPUT")
		return false
	}
	return true
}
func (s *Server) Handler() http.Handler { m := http.NewServeMux(); s.Register(m); return s.Guard(m) }
func (s *Server) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.directory.retain() {
			fail(w, http.StatusServiceUnavailable, "ARCHIVE_UNAVAILABLE")
			return
		}
		defer func() {
			if err := s.directory.release(); err != nil {
				slog.ErrorContext(r.Context(), "release archive directory", "error", err)
			}
		}()
		if err := s.checkMySQLLease(r.Context()); err != nil {
			fail(w, http.StatusServiceUnavailable, "ARCHIVE_UNAVAILABLE")
			return
		}
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
	m.HandleFunc("GET /api/v1/dashboard", s.dashboard)
	m.HandleFunc("GET /api/v1/projects/{id}", s.getProject)
	m.HandleFunc("GET /api/v1/projects/{id}/repositories", s.repositories)
	m.HandleFunc("POST /api/v1/projects/{id}/repositories", s.repositories)
	handler.NewCampaign(service.NewCampaign(dao.NewCampaign(s.db), &s.mu)).Register(m)
	m.HandleFunc("POST /api/v1/campaigns/{id}/runs", s.submitRun)
	m.HandleFunc("GET /api/v1/campaigns/{id}/runs", s.listRuns)
	m.HandleFunc("GET /api/v1/runs/{id}", s.getRun)
	m.HandleFunc("POST /api/v1/runs/{id}/move", s.moveRun)
	m.HandleFunc("POST /api/v1/runs/{id}/consolidate", s.consolidateRun)
	m.HandleFunc("GET /api/v1/runs/{id}/evidence/{filename}", s.evidence)
	m.HandleFunc("POST /api/v1/runs/{id}/reviews", s.review)
	m.HandleFunc("POST /api/v1/runs/{id}/accept-all", s.acceptAll)
	m.HandleFunc("POST /api/v1/runs/{id}/void", s.voidRun)
	s.registerDeliveries(m)
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
	if _, e := s.db.ExecContext(r.Context(), "INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)", p.ID, p.Name, p.Description, p.CreatedAt); e != nil {
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
