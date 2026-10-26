package api_test

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	schema "github.com/Chulan-824/acceptances/db"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
	"golang.org/x/crypto/bcrypt"
)

const accountPassword = "team account test password"

func authCall(app *api.Server, method, path, body, token string, cookie *http.Cookie, origin string) *httptest.ResponseRecorder {
	req := localRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	req.Header.Set("Origin", origin)
	response := httptest.NewRecorder()
	app.Handler().ServeHTTP(response, req)
	return response
}

func registerAccount(t *testing.T, app *api.Server, name string, cli bool) (string, *http.Cookie, map[string]any) {
	t.Helper()
	client := ""
	if cli {
		client = "cli"
	}
	body, _ := json.Marshal(map[string]string{"username": name, "password": accountPassword, "client": client})
	response := authCall(app, "POST", "/api/v1/auth/register", string(body), "", nil, "")
	if response.Code != 201 {
		t.Fatalf("register %s: %d %s", name, response.Code, response.Body.String())
	}
	var data map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if cli {
		return data["token"].(string), nil, data["user"].(map[string]any)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing session cookie")
	}
	return "", cookies[0], data["user"].(map[string]any)
}

func TestRegistrationPasswordLength(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	for _, tc := range []struct {
		name     string
		password string
		status   int
	}{
		{"six-digits", "123456", http.StatusBadRequest},
		{"seven-digits", "1234567", http.StatusCreated},
		{"seven-letters", "abcdefg", http.StatusCreated},
		{"six-unicode", "一二三四五六", http.StatusBadRequest},
		{"seven-unicode", "一二三四五六七", http.StatusCreated},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]string{"username": tc.name, "password": tc.password})
			if err != nil {
				t.Fatal(err)
			}
			response := authCall(app, "POST", "/api/v1/auth/register", string(body), "", nil, "")
			if response.Code != tc.status {
				t.Fatalf("register: got %d, want %d", response.Code, tc.status)
			}
			if tc.status == http.StatusCreated {
				response = authCall(app, "POST", "/api/v1/auth/login", string(body), "", nil, "")
				if response.Code != http.StatusOK {
					t.Fatalf("login: got %d, want %d", response.Code, http.StatusOK)
				}
			}
		})
	}
}

func TestAccountsShareProjectsAndRecordIdentity(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	for _, path := range []string{"/api/v1/projects", "/api/v1/dashboard", "/api/v1/runs/missing/evidence/file.txt", "/api/v1/deliveries/missing", "/api/v1/documents/missing/html?download=1", "/api/v1/%70rojects"} {
		if r := authCall(app, "GET", path, "", "", nil, ""); r.Code != 401 {
			t.Fatalf("unprotected %s: %d", path, r.Code)
		}
	}
	alice, _, aliceUser := registerAccount(t, app, " Alice ", true)
	bob, _, bobUser := registerAccount(t, app, "bob", true)
	if aliceUser["username"] != "alice" || aliceUser["id"] == bobUser["id"] {
		t.Fatal("users not distinct or normalized")
	}
	call := func(method, path, body, token string, want int) map[string]any {
		t.Helper()
		r := authCall(app, method, path, body, token, nil, "")
		if r.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
		}
		var v map[string]any
		if r.Body.Len() > 0 {
			if err := json.Unmarshal(r.Body.Bytes(), &v); err != nil {
				t.Fatal(err)
			}
		}
		return v
	}
	project := call("POST", "/api/v1/projects", `{"name":"Shared project"}`, alice, 201)
	campaign := call("POST", "/api/v1/projects/"+project["id"].(string)+"/campaigns", `{"title":"Bob requirement"}`, bob, 201)
	if project["createdBy"].(map[string]any)["id"] != aliceUser["id"] || campaign["createdBy"].(map[string]any)["id"] != bobUser["id"] {
		t.Fatal("creator identity missing")
	}
	listed := call("GET", "/api/v1/projects", "", bob, 200)
	if len(listed["items"].([]any)) != 1 {
		t.Fatal("projects unexpectedly isolated")
	}
	detail := call("GET", "/api/v1/campaigns/"+campaign["id"].(string), "", alice, 200)
	if detail["createdBy"].(map[string]any)["username"] != "bob" {
		t.Fatal("campaign creator not persisted")
	}
	call("PATCH", "/api/v1/campaigns/"+campaign["id"].(string), `{"description":"shared edit"}`, alice, 200)
	call("POST", "/api/v1/auth/register", `{"username":"ALICE","password":"team account test password"}`, "", 409)
	call("POST", "/api/v1/auth/register", `{"username":"bad name","password":"short"}`, "", 400)
	for _, body := range []string{`{"username":"alice","password":"incorrect"}`, `{"username":"missing","password":"incorrect"}`} {
		call("POST", "/api/v1/auth/login", body, "", 401)
	}
	var hash []byte
	if err := db.QueryRow("SELECT password_hash FROM local_credentials WHERE user_id=?", aliceUser["id"]).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if string(hash) == accountPassword || bcrypt.CompareHashAndPassword(hash, []byte(accountPassword)) != nil {
		t.Fatal("password not hashed")
	}
	digest := sha256.Sum256([]byte(alice))
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM user_sessions WHERE token_hash=?", digest[:]).Scan(&count); err != nil || count != 1 {
		t.Fatal("session digest not stored")
	}
	if _, err := db.Exec("UPDATE user_sessions SET expires_at=? WHERE token_hash=?", time.Now().Add(-time.Hour), digest[:]); err != nil {
		t.Fatal(err)
	}
	call("GET", "/api/v1/auth/me", "", alice, 401)
	call("GET", "/api/v1/auth/me", "", bob, 200)
}

func TestBrowserSessionCSRFLogoutAndRestart(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	dir := t.TempDir()
	app, err := api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { app.Close() }()
	_, cookie, user := registerAccount(t, app, "browser-user", false)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge != 7*24*60*60 || cookie.Secure {
		t.Fatal("incorrect local cookie attributes")
	}
	if r := authCall(app, "POST", "/api/v1/projects", `{"name":"csrf"}`, "", cookie, ""); r.Code != 403 {
		t.Fatal("cookie mutation accepted without Origin")
	}
	if r := authCall(app, "POST", "/api/v1/projects", `{"name":"csrf"}`, "", cookie, "https://evil.example"); r.Code != 403 {
		t.Fatal("cross origin mutation accepted")
	}
	if r := authCall(app, "POST", "/api/v1/projects", `{"name":"browser"}`, "", cookie, "http://localhost:8765"); r.Code != 201 {
		t.Fatalf("same origin write: %d %s", r.Code, r.Body.String())
	}
	invalid := localRequest("POST", "/api/v1/projects", strings.NewReader(`{"name":"invalid auth"}`))
	invalid.AddCookie(cookie)
	invalid.Header.Set("Authorization", "Basic "+cookie.Value)
	invalidResponse := httptest.NewRecorder()
	app.Handler().ServeHTTP(invalidResponse, invalid)
	if invalidResponse.Code != 401 {
		t.Fatal("invalid Authorization fell back to cookie")
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	app, err = api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	r := authCall(app, "GET", "/api/v1/auth/me", "", "", cookie, "")
	if r.Code != 200 || !strings.Contains(r.Body.String(), user["id"].(string)) {
		t.Fatal("session did not survive restart")
	}
	r = authCall(app, "POST", "/api/v1/auth/logout", "", "", cookie, "http://localhost:8765")
	if r.Code != 204 || len(r.Result().Cookies()) != 1 || r.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("logout failed")
	}
	if r := authCall(app, "GET", "/api/v1/projects", "", "", cookie, ""); r.Code != 401 {
		t.Fatal("logged out cookie still usable")
	}
	req := localRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"browser-user","password":"team account test password"}`))
	req.Header.Set("Content-Type", "text/plain")
	response := httptest.NewRecorder()
	app.Handler().ServeHTTP(response, req)
	if response.Code != 415 {
		t.Fatal("login allowed form/text content type")
	}
	for range 30 {
		authCall(app, "POST", "/api/v1/auth/login", "{}", "", nil, "")
	}
	if r := authCall(app, "POST", "/api/v1/auth/login", "{}", "", nil, ""); r.Code != 429 {
		t.Fatal("login not rate limited")
	}
}

func TestConfiguredPublicOrigin(t *testing.T) {
	t.Setenv("ACCEPTANCES_PUBLIC_ORIGIN", "https://acceptances.example.com")
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	body := `{"username":"remote-user","password":"team account test password"}`
	req := localRequest("POST", "/api/v1/auth/register", strings.NewReader(body))
	req.Host = "acceptances.example.com"
	req.Header.Set("Origin", "https://acceptances.example.com")
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.Handler().ServeHTTP(response, req)
	if response.Code != 201 || !response.Result().Cookies()[0].Secure {
		t.Fatalf("public origin: %d %s", response.Code, response.Body.String())
	}
}

func TestLoginMigrationPreservesExistingProjects(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	if _, err := db.Exec(`CREATE TABLE schema_migrations(version INT UNSIGNED PRIMARY KEY, checksum CHAR(64) NOT NULL, archive_id CHAR(36) NOT NULL, dirty BOOLEAN NOT NULL, applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6))`); err != nil {
		t.Fatal(err)
	}
	const archiveID = "00000000-0000-4000-8000-000000000001"
	for index, name := range []string{"001_archive.sql", "002_files.sql"} {
		data, err := schema.MySQL.ReadFile("migrations/mysql/" + name)
		if err != nil {
			t.Fatal(err)
		}
		for statement := range strings.SplitSeq(string(data), "-- statement\n") {
			if strings.TrimSpace(statement) != "" {
				if _, err = db.Exec(statement); err != nil {
					t.Fatal(err)
				}
			}
		}
		digest := sha256.Sum256(data)
		if _, err = db.Exec("INSERT INTO schema_migrations(version,checksum,archive_id,dirty) VALUES(?,?,?,0)", index+1, fmt.Sprintf("%x", digest), archiveID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("INSERT INTO projects(id,name,description,created_at) VALUES('legacy-project','Existing project','Preserved description','2026-10-24T00:00:00Z')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE archive_file_storage SET backend='mysql'"); err != nil {
		t.Fatal(err)
	}
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	token, _, _ := registerAccount(t, app, "new-user", true)
	response := authCall(app, "GET", "/api/v1/projects/legacy-project", "", token, nil, "")
	var project map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &project); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || project["name"] != "Existing project" || project["description"] != "Preserved description" || project["createdAt"] != "2026-10-24T00:00:00Z" || project["createdBy"] != nil {
		t.Fatalf("legacy data changed: %d %s", response.Code, response.Body.String())
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE dirty=0 AND archive_id=?", archiveID).Scan(&count); err != nil || count != 4 {
		t.Fatal("migration history not retained")
	}
}
