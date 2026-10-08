package api

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
)

func (s *Server) registerIdentity(mux *http.ServeMux) {
	s.route(mux, "POST /api/v1/session", "PUBLIC", s.login)
	s.route(mux, "GET /api/v1/session", "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		var username string
		var expires time.Time
		if err := s.Store.Pool.QueryRow(r.Context(), "SELECT o.username,s.expires_at FROM sessions s JOIN owners o ON o.id=s.owner_id WHERE s.id=$1", p.ID).Scan(&username, &expires); err != nil {
			return err
		}
		reply(w, 200, map[string]any{"username": username, "csrfToken": p.CSRF, "expiresAt": expires})
		return nil
	})
	s.route(mux, "POST /api/v1/session/activity", "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		tx, err := s.Auth.BeginWrite(r.Context(), p)
		if err != nil {
			return err
		}
		defer tx.Rollback(r.Context())
		_, err = tx.Exec(r.Context(), "UPDATE sessions SET last_interaction_at=now() WHERE id=$1 AND last_interaction_at<now()-interval '5 minutes'", p.ID)
		if err != nil {
			return err
		}
		if err = tx.Commit(r.Context()); err != nil {
			return err
		}
		reply(w, 200, map[string]any{"active": true})
		return nil
	})
	for _, path := range []string{"/api/v1/session", "/api/v1/sessions"} {
		all := path == "/api/v1/sessions"
		s.route(mux, "DELETE "+path, "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
			tx, err := s.Auth.BeginWrite(r.Context(), p)
			if err != nil {
				return err
			}
			defer tx.Rollback(r.Context())
			query := "UPDATE sessions SET revoked_at=now() WHERE id=$1"
			args := []any{p.ID}
			if all {
				query = "UPDATE sessions SET revoked_at=now() WHERE owner_id=1 AND revoked_at IS NULL"
				args = nil
			}
			if _, err = tx.Exec(r.Context(), query, args...); err != nil {
				return err
			}
			if err = tx.Commit(r.Context()); err != nil {
				return err
			}
			http.SetCookie(w, &http.Cookie{Name: "acceptances_session", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.WriteHeader(204)
			return nil
		})
	}
	s.route(mux, "POST /api/v1/projects", "OWNER", s.createProject)
	s.route(mux, "GET /api/v1/projects", "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		return s.listIdentity(w, r, "projects", "")
	})
	s.route(mux, "POST /api/v1/projects/{projectId}/repositories", "OWNER", s.createRepository)
	s.route(mux, "GET /api/v1/projects/{projectId}/repositories", "results:read", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		return s.listIdentity(w, r, "repositories", r.PathValue("projectId"))
	})
	s.route(mux, "POST /api/v1/projects/{projectId}/tokens", "OWNER", s.createToken)
	s.route(mux, "GET /api/v1/projects/{projectId}/tokens", "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		return s.listIdentity(w, r, "api_tokens", r.PathValue("projectId"))
	})
	s.route(mux, "DELETE /api/v1/projects/{projectId}/tokens/{tokenId}", "OWNER", func(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
		if err := validID(r.PathValue("tokenId")); err != nil {
			return err
		}
		tx, err := s.Auth.BeginWrite(r.Context(), p)
		if err != nil {
			return err
		}
		defer tx.Rollback(r.Context())
		tag, err := tx.Exec(r.Context(), "UPDATE api_tokens SET revoked_at=now(),version=version+1 WHERE project_id=$1 AND id=$2", r.PathValue("projectId"), r.PathValue("tokenId"))
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return protocol.Failure("RESOURCE_NOT_FOUND", "", "token not found")
		}
		if err = tx.Commit(r.Context()); err != nil {
			return err
		}
		w.WriteHeader(204)
		return nil
	})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	key := protocol.Digest([]byte(host + "\x00" + input.Username))
	now := time.Now()
	s.loginMu.Lock()
	for k, times := range s.attempts {
		if len(times) == 0 || now.Sub(times[len(times)-1]) > time.Minute {
			delete(s.attempts, k)
		}
	}
	recent := []time.Time{}
	for _, t := range s.attempts[key] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 5 || len(s.attempts) > 10000 {
		s.loginMu.Unlock()
		return protocol.Failure("RATE_LIMITED", "", "login rate limit reached")
	}
	s.attempts[key] = append(recent, now)
	s.loginMu.Unlock()
	cookie, csrf, err := s.Auth.Login(r.Context(), input.Username, input.Password)
	if err != nil {
		return err
	}
	identity.SetCookie(w, cookie)
	reply(w, 200, map[string]any{"csrfToken": csrf})
	return nil
}
func (s *Server) createProject(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if err := validID(v.ID); err != nil {
		return err
	}
	if strings.TrimSpace(v.Name) == "" || len(v.Name) > 256 {
		return protocol.Failure("INVALID_ARGUMENT", "/name", "project name required")
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, v.ID); err != nil || hit {
		return err
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO projects(id,name) VALUES($1,$2)", v.ID, v.Name); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, v.ID, 201, map[string]any{"id": v.ID, "name": v.Name}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, map[string]any{"id": v.ID, "name": v.Name})
	return nil
}
func (s *Server) createRepository(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		ID          string `json:"id"`
		DisplayName string `json:"displayName"`
		Locator     string `json:"locator"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if err := validID(v.ID); err != nil {
		return err
	}
	if err := validID(r.PathValue("projectId")); err != nil {
		return err
	}
	if strings.TrimSpace(v.DisplayName) == "" || len(v.Locator) > 4096 {
		return protocol.Failure("INVALID_ARGUMENT", "", "repository metadata invalid")
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, r.PathValue("projectId")); err != nil || hit {
		return err
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO repositories(project_id,id,display_name,locator) VALUES($1,$2,$3,$4)", r.PathValue("projectId"), v.ID, v.DisplayName, v.Locator); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 201, v); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, v)
	return nil
}
func (s *Server) createToken(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		ID        string          `json:"id"`
		Name      string          `json:"name"`
		Scopes    []string        `json:"scopes"`
		ExpiresAt json.RawMessage `json:"expiresAt"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if err := validID(v.ID); err != nil {
		return err
	}
	if err := validID(r.PathValue("projectId")); err != nil {
		return err
	}
	allowed := map[string]bool{"definitions:write": true, "campaigns:write": true, "runs:write": true, "evidence:write": true, "results:read": true, "feedback:read": true, "evidence:read": true}
	seen := map[string]bool{}
	for _, scope := range v.Scopes {
		if !allowed[scope] || seen[scope] {
			return protocol.Failure("INVALID_ARGUMENT", "/scopes", "invalid or duplicate project scope")
		}
		seen[scope] = true
	}
	if strings.TrimSpace(v.Name) == "" || len(v.Scopes) == 0 {
		return protocol.Failure("INVALID_ARGUMENT", "", "token name and scopes required")
	}
	expires := time.Now().Add(90 * 24 * time.Hour)
	var expiry *time.Time = &expires
	if string(v.ExpiresAt) == "null" {
		expiry = nil
	} else if len(v.ExpiresAt) > 0 {
		var value string
		if err := json.Unmarshal(v.ExpiresAt, &value); err != nil {
			return protocol.Failure("INVALID_ARGUMENT", "/expiresAt", "invalid expiry")
		}
		t, err := time.Parse(time.RFC3339, value)
		if err != nil || !t.After(time.Now()) {
			return protocol.Failure("INVALID_ARGUMENT", "/expiresAt", "expiry must be in the future")
		}
		expiry = &t
	}
	token := identity.NewToken(v.ID)
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "INSERT INTO api_tokens(id,owner_id,project_id,name,secret_hash,scopes,expires_at,auth_epoch) VALUES($1,1,$2,$3,$4,$5,$6,$7)", v.ID, r.PathValue("projectId"), v.Name, identity.TokenHash(token), v.Scopes, expiry, p.Epoch); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, map[string]any{"id": v.ID, "name": v.Name, "scopes": v.Scopes, "expiresAt": expiry, "secret": token})
	return nil
}
func (s *Server) listIdentity(w http.ResponseWriter, r *http.Request, table, project string) error {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 || v > 200 {
			return protocol.Failure("INVALID_ARGUMENT", "/limit", "limit must be 1..200")
		}
		limit = v
	}
	cursor, err := decodeCursor(r.URL.Query().Get("cursor"), table+"/"+project)
	if err != nil {
		return err
	}
	fields := "jsonb_build_object('id',id,'name',name,'createdAt',created_at)"
	condition := "true"
	args := []any{cursor.Time, cursor.ID, limit + 1}
	if project != "" {
		if err := validID(project); err != nil {
			return err
		}
		condition = "project_id=$4"
		args = append(args, project)
	}
	if table == "repositories" {
		fields = "jsonb_build_object('id',id,'displayName',display_name,'locator',locator,'createdAt',created_at)"
	}
	if table == "api_tokens" {
		fields = "jsonb_build_object('id',id,'name',name,'scopes',scopes,'expiresAt',expires_at,'revokedAt',revoked_at,'createdAt',created_at)"
	}
	rows, err := s.Store.Pool.Query(r.Context(), "SELECT "+fields+",created_at,id::text FROM "+table+" WHERE "+condition+" AND (created_at,id) > ($1::timestamptz,$2::uuid) ORDER BY created_at,id LIMIT $3", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []json.RawMessage{}
	var last Cursor
	var next any
	for rows.Next() {
		var raw json.RawMessage
		var t time.Time
		var id string
		if err = rows.Scan(&raw, &t, &id); err != nil {
			return err
		}
		if len(items) == limit {
			next = encodeCursor(last, table+"/"+project)
			break
		}
		items = append(items, raw)
		last = Cursor{Time: t, ID: id}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	reply(w, 200, map[string]any{"items": items, "nextCursor": next})
	return nil
}
