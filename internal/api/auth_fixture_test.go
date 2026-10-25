package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

var fixtureSessions = struct {
	sync.Mutex
	tokens map[*api.Server]string
}{tokens: make(map[*api.Server]string)}

// Existing business tests use a real account; auth tests exercise the raw guard.
func authenticatedHandler(t *testing.T, app *api.Server) http.Handler {
	t.Helper()
	fixtureSessions.Lock()
	token := fixtureSessions.tokens[app]
	if token == "" {
		body := `{"username":"fixture","password":"fixture test password","client":"cli"}`
		req := localRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		app.Handler().ServeHTTP(response, req)
		if response.Code == http.StatusConflict {
			req = localRequest("POST", "/api/v1/auth/login", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			response = httptest.NewRecorder()
			app.Handler().ServeHTTP(response, req)
		}
		var session struct{ Token string }
		if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil || session.Token == "" {
			fixtureSessions.Unlock()
			t.Fatalf("authenticate business fixture: %d %s", response.Code, response.Body.String())
		}
		token = session.Token
		fixtureSessions.tokens[app] = token
		t.Cleanup(func() { fixtureSessions.Lock(); delete(fixtureSessions.tokens, app); fixtureSessions.Unlock() })
	}
	fixtureSessions.Unlock()
	handler := app.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		handler.ServeHTTP(w, r)
	})
}
