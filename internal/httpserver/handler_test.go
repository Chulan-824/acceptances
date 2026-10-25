package httpserver_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/httpserver"
	"github.com/Chulan-824/acceptances/internal/testmysql"
)

func TestCampaignRoutingAndArchiveGuard(t *testing.T) {
	t.Parallel()
	dsn, _ := testmysql.New(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	web := fstest.MapFS{"index.html": {Data: []byte("<html>application</html>")}}
	server := httptest.NewServer(httpserver.New(web, app))
	t.Cleanup(server.Close)
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	token := ""
	call := func(method, path, body, host, origin, accept string) (int, http.Header, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if host != "" {
			req.Host = host
		}
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Accept", accept)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, res.Header, string(data)
	}
	create := func(path, body string) string {
		t.Helper()
		status, _, data := call("POST", path, body, "", "", "")
		if status != 201 {
			t.Fatalf("create = %d %s", status, data)
		}
		var v struct{ ID string }
		if err := json.Unmarshal([]byte(data), &v); err != nil || v.ID == "" {
			t.Fatalf("create response: %s, %v", data, err)
		}
		return v.ID
	}
	status, _, data := call("POST", "/api/v1/auth/register", `{"username":"routing","password":"routing test password","client":"cli"}`, "", "", "")
	var session struct{ Token string }
	if err := json.Unmarshal([]byte(data), &session); status != 201 || err != nil || session.Token == "" {
		t.Fatalf("register: %d %s", status, data)
	}
	token = session.Token
	pid := create("/api/v1/projects", `{"name":"routing"}`)
	listPath := "/api/v1/projects/" + pid + "/campaigns"
	cid := create(listPath, `{"title":"Campaign"}`)
	path := "/api/v1/campaigns/" + cid
	for _, tc := range []struct {
		name, method, path, body, host, origin, accept, content string
		status                                                  int
	}{
		{name: "detail", method: "GET", path: path, content: `"title":"Campaign"`, status: 200},
		{name: "head detail", method: "HEAD", path: path, status: 200},
		{name: "head list", method: "HEAD", path: listPath, status: 200},
		{name: "trailing slash", method: "GET", path: path + "/", content: `"code":"NOT_FOUND"`, status: 404},
		{name: "method fallback", method: "PUT", path: path, content: `"code":"NOT_FOUND"`, status: 404},
		{name: "unknown API", method: "GET", path: "/api/v1/unknown", content: `"code":"NOT_FOUND"`, status: 404},
		{name: "escaped slash", method: "GET", path: "/api/v1/campaigns/missing%2Fid", content: `"code":"CAMPAIGN_NOT_FOUND"`, status: 404},
		{name: "escaped project", method: "GET", path: "/api/v1/projects/missing%2Fid/campaigns", content: `"code":"PROJECT_NOT_FOUND"`, status: 404},
		{name: "escaped literal segment", method: "GET", path: "/api/v1/%63ampaigns/" + cid, content: `"title":"Campaign"`, status: 200},
		{name: "escaped literal head", method: "HEAD", path: "/api/v1/%63ampaigns/" + cid, status: 200},
		{name: "escaped literal create", method: "POST", path: "/api/v1/%70rojects/" + pid + "/campaigns", body: `{"title":"Encoded route"}`, content: `"title":"Encoded route"`, status: 201},
		{name: "escaped literal update", method: "PATCH", path: "/api/v1/%63ampaigns/" + cid, body: `{"description":"Encoded update"}`, content: `"description":"Encoded update"`, status: 200},
		{name: "path cleaning", method: "GET", path: "/api/v1//campaigns/" + cid, status: 307},
		{name: "legacy runs", method: "GET", path: path + "/runs", content: `"items":[]`, status: 200},
		{name: "legacy deletion preview", method: "GET", path: path + "/delete-preview", status: 200},
		{name: "capabilities", method: "GET", path: "/api/v1/capabilities", content: `"apiVersions"`, status: 200},
		{name: "readiness", method: "GET", path: "/health/ready", content: `"status":"ready"`, status: 200},
		{name: "SPA fallback", method: "GET", path: "/projects/" + pid, accept: "text/html", content: "<html>application</html>", status: 200},
		{name: "host guard", method: "GET", path: path, host: "example.com", content: `"code":"LOCAL_HOST_REQUIRED"`, status: 403},
		{name: "origin guard", method: "GET", path: listPath, origin: "https://example.com", content: `"code":"ORIGIN_NOT_ALLOWED"`, status: 403},
		{name: "same origin", method: "GET", path: path, origin: server.URL, content: `"title":"Campaign"`, status: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, headers, body := call(tc.method, tc.path, tc.body, tc.host, tc.origin, tc.accept)
			if status != tc.status || !strings.Contains(body, tc.content) {
				t.Fatalf("response = %d %s", status, body)
			}
			if tc.method == "HEAD" && body != "" {
				t.Fatal("HEAD returned a body")
			}
			if headers.Get("Cache-Control") != "no-store" || headers.Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("archive response headers lost")
			}
		})
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	status, _, body := call("GET", path, "", "", "", "")
	if status != 503 || !strings.Contains(body, "ARCHIVE_UNAVAILABLE") {
		t.Fatalf("closed archive reached handler: %d %s", status, body)
	}
}
