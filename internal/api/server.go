package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Chulan-824/acceptances/internal/config"
	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Server struct {
	Storage  *storage.Local
	Store    *database.Store
	Auth     *identity.Auth
	Config   config.Config
	loginMu  sync.Mutex
	attempts map[string][]time.Time
}

func New(store *database.Store, c config.Config) *Server {
	return &Server{Store: store, Auth: &identity.Auth{Store: store}, Config: c, attempts: map[string][]time.Time{}}
}

type endpoint func(http.ResponseWriter, *http.Request, identity.Principal) error

func (s *Server) route(mux *http.ServeMux, pattern, scope string, handler endpoint) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/content") {
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()
			r = r.WithContext(ctx)
			controller := http.NewResponseController(w)
			controller.SetReadDeadline(time.Now().Add(30 * time.Second))
			defer controller.SetReadDeadline(time.Time{})
		}
		var p identity.Principal
		var err error
		if scope != "PUBLIC" {
			p, err = s.Auth.Authenticate(r)
			if err == nil {
				if scope == "OWNER" && !p.Owner {
					err = protocol.Failure("FORBIDDEN", "", "owner session required")
				} else if scope != "OWNER" {
					err = p.Require(r.PathValue("projectId"), scope)
				}
			}
			if err == nil && r.Method != "GET" && r.Method != "HEAD" {
				err = p.CheckCSRF(r)
			}
		}
		if err == nil {
			err = handler(w, r, p)
		}
		if err != nil {
			writeError(w, err)
		}
	})
}
func (s *Server) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			origin, _ := url.Parse(s.Config.PublicOrigin)
			if r.Host != origin.Host {
				writeError(w, protocol.Failure("FORBIDDEN", "", "host does not match configured loopback origin"))
				return
			}
			if supplied := r.Header.Get("Origin"); supplied != "" && supplied != s.Config.PublicOrigin {
				writeError(w, protocol.Failure("CSRF_REJECTED", "", "origin mismatch"))
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" {
				if _, err := r.Cookie("acceptances_session"); err == nil || r.URL.Path == "/api/v1/session" {
					if r.Header.Get("Origin") != s.Config.PublicOrigin {
						writeError(w, protocol.Failure("CSRF_REJECTED", "", "same-origin browser request required"))
						return
					}
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) Register(mux *http.ServeMux) {
	s.registerIdentity(mux)
	s.registerDefinitions(mux)
	s.registerPublication(mux)
	s.registerReviews(mux)
}
func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return protocol.Failure("INVALID_ARGUMENT", "", "application/json required")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, protocol.DocumentLimit))
	if err != nil {
		return protocol.Failure("LIMIT_EXCEEDED", "", "request too large")
	}
	if _, err = protocol.Decode(raw); err != nil {
		return err
	}
	rememberBody(r, raw)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(dst); err != nil {
		return protocol.Failure("SCHEMA_INVALID", "", "request fields invalid")
	}
	return nil
}
func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"data": data, "requestId": protocol.NewID()})
}
func writeError(w http.ResponseWriter, err error) {
	var p *protocol.Error
	if !errors.As(err, &p) {
		if errors.Is(err, pgx.ErrNoRows) {
			p = protocol.Failure("RESOURCE_NOT_FOUND", "", "resource not found")
		} else {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" {
				p = protocol.Failure("ID_CONTENT_CONFLICT", "", "identity already exists")
			} else if errors.As(err, &pg) && pg.Code == "23503" {
				p = protocol.Failure("REFERENCE_INVALID", "", "referenced resource unavailable")
			} else {
				p = protocol.Failure("INTERNAL_ERROR", "", "operation failed")
			}
		}
	}
	copy := *p
	copy.RequestID = protocol.NewID()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(copy.HTTPStatus())
	json.NewEncoder(w).Encode(map[string]any{"error": copy})
}
func validID(id string) error {
	if !protocol.ValidID(id) {
		return protocol.Failure("INVALID_ARGUMENT", "/id", "expected lowercase UUID v4")
	}
	return nil
}
func (s *Server) Ready(ctx context.Context) error {
	deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.Store.Ready(deadline); err != nil {
		return err
	}
	if s.Storage == nil {
		return protocol.Failure("STORAGE_UNAVAILABLE", "", "local storage unavailable")
	}
	if err := s.Storage.CheckWritable(); err != nil {
		return protocol.Failure("STORAGE_UNAVAILABLE", "", "local storage unavailable")
	}
	return nil
}
