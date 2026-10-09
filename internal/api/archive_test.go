package api_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"github.com/Chulan-824/acceptances/internal/api"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	app, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("POST", "/api/v1/projects", strings.NewReader(`{"name":"Product"}`)))
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var project map[string]any
	json.Unmarshal(w.Body.Bytes(), &project)
	app.Close()
	app, err = api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	w = httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/projects/"+project["id"].(string), nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Product") {
		t.Fatalf("restart: %d %s", w.Code, w.Body.String())
	}
}
func request(t *testing.T, app *api.Server, method, path, body string, want int) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest(method, path, strings.NewReader(body)))
	if w.Code != want {
		t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
	}
	var v map[string]any
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
	}
	return v
}
func setup(t *testing.T) (*api.Server, string, string) {
	t.Helper()
	app, e := api.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { app.Close() })
	p := request(t, app, "POST", "/api/v1/projects", `{"name":"Product"}`, 201)
	pid := p["id"].(string)
	c := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Delivery","description":"A feature"}`, 201)
	return app, pid, c["id"].(string)
}
func TestCampaignAndRepositoryAssociation(t *testing.T) {
	app, pid, cid := setup(t)
	c := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if c["status"] != "pending" {
		t.Fatal(c)
	}
	a := request(t, app, "POST", "/api/v1/projects/"+pid+"/repositories", `{"name":"web","source":"git:product"}`, 201)
	b := request(t, app, "POST", "/api/v1/projects/"+pid+"/repositories", `{"name":"worktree","source":"git:product"}`, 201)
	if a["id"] != b["id"] {
		t.Fatal("same source duplicated")
	}
}

const report = `{"title":"Feature","description":"Real check","verifiedAt":"2026-10-09T10:00:00Z","scope":"partial: failure only","environment":"","versions":[],"checks":[{"id":"c1","title":"Broken","expected":"works","actual":"failed","status":"failed","evidence":["log.txt"]}],"evidence":[{"path":"log.txt","description":"execution log"}]}`

func upload(t *testing.T, app *api.Server, cid, sid, doc string, files map[string]string, want int) map[string]any {
	t.Helper()
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	m.WriteField("report", doc)
	m.WriteField("submissionId", sid)
	for name, data := range files {
		p, e := m.CreateFormFile("evidence", name)
		if e != nil {
			t.Fatal(e)
		}
		p.Write([]byte(data))
	}
	m.Close()
	req := localRequest("POST", "/api/v1/campaigns/"+cid+"/runs", &b)
	req.Header.Set("Content-Type", m.FormDataContentType())
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, req)
	if w.Code != want {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return out
}
func TestCompleteReportAndIdempotentRetry(t *testing.T) {
	app, _, cid := setup(t)
	a := upload(t, app, cid, "attempt1", report, map[string]string{"log.txt": "failed as observed"}, 201)
	b := upload(t, app, cid, "attempt1", report, map[string]string{"log.txt": "failed as observed"}, 200)
	if a["id"] != b["id"] {
		t.Fatal("retry duplicated")
	}
	upload(t, app, cid, "attempt1", report, map[string]string{"log.txt": "changed"}, 409)
	got := request(t, app, "GET", "/api/v1/runs/"+a["id"].(string), "", 200)
	if got["status"] != "pending" || got["report"].(map[string]any)["environment"] != "unknown" {
		t.Fatal(got)
	}
	list := request(t, app, "GET", "/api/v1/campaigns/"+cid+"/runs", "", 200)
	if len(list["items"].([]any)) != 1 {
		t.Fatal(list)
	}
}
func TestReviewHistoryAndVoid(t *testing.T) {
	app, _, cid := setup(t)
	a := upload(t, app, cid, "first", report, map[string]string{"log.txt": "log"}, 201)
	aid := a["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+aid+"/reviews", `{"kind":"accepted","body":""}`, 201)
	c := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if c["status"] != "accepted" {
		t.Fatal(c)
	}
	b := upload(t, app, cid, "second", report, map[string]string{"log.txt": "new"}, 201)
	bid := b["id"].(string)
	c = request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if c["status"] != "pending" {
		t.Fatal(c)
	}
	old := request(t, app, "GET", "/api/v1/runs/"+aid, "", 200)
	if old["status"] != "accepted" {
		t.Fatal(old)
	}
	request(t, app, "POST", "/api/v1/runs/"+bid+"/reviews", `{"kind":"comment","body":"Correction"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+bid+"/reviews", `{"kind":"accepted","body":""}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+bid+"/void", `{"reason":"Wrong environment"}`, 200)
	request(t, app, "POST", "/api/v1/runs/"+bid+"/reviews", `{"kind":"accepted","body":""}`, 409)
	c = request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if c["status"] != "pending" {
		t.Fatal(c)
	}
	v := request(t, app, "GET", "/api/v1/runs/"+bid, "", 200)
	if v["voidReason"] != "Wrong environment" || len(v["reviews"].([]any)) != 2 {
		t.Fatal(v)
	}
}
func TestDeleteScopeAndNoResurrectedAcceptance(t *testing.T) {
	app, pid, cid := setup(t)
	a := upload(t, app, cid, "first", report, map[string]string{"log.txt": "old"}, 201)
	aid := a["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+aid+"/reviews", `{"kind":"accepted"}`, 201)
	b := upload(t, app, cid, "second", report, map[string]string{"log.txt": "new"}, 201)
	bid := b["id"].(string)
	preview := request(t, app, "GET", "/api/v1/projects/"+pid+"/delete-preview", "", 200)
	if preview["runs"] != float64(2) || preview["evidence"] != float64(2) || preview["reviews"] != float64(1) {
		t.Fatal(preview)
	}
	request(t, app, "DELETE", "/api/v1/runs/"+bid, "", 204)
	c := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if c["status"] != "pending" || c["latestRunId"] != "" {
		t.Fatal(c)
	}
	other := request(t, app, "POST", "/api/v1/projects", `{"name":"other"}`, 201)
	request(t, app, "DELETE", "/api/v1/projects/"+pid, "", 204)
	request(t, app, "GET", "/api/v1/runs/"+aid, "", 404)
	request(t, app, "GET", "/api/v1/projects/"+other["id"].(string), "", 200)
}
func TestEvidenceSafetyAndMissingAttachments(t *testing.T) {
	app, _, cid := setup(t)
	upload(t, app, cid, "missing", report, nil, 400)
	upload(t, app, cid, "invalid", `{}`, nil, 400)
	upload(t, app, cid, "traversal", strings.ReplaceAll(report, "log.txt", "../log.txt"), map[string]string{"../log.txt": "bad"}, 400)
	v := upload(t, app, cid, "html", strings.ReplaceAll(report, "log.txt", "page.html"), map[string]string{"page.html": "<script>alert(1)</script>"}, 201)
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+v["id"].(string)+"/evidence/page.html", nil))
	if w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("unsafe evidence: %d %v", w.Code, w.Header())
	}
	request(t, app, "DELETE", "/api/v1/runs/"+v["id"].(string), "", 204)
	w = httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+v["id"].(string)+"/evidence/page.html", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func localRequest(method, path string, body io.Reader) *http.Request {
	r := httptest.NewRequest(method, path, body)
	r.Host = "localhost:8765"
	return r
}
func TestLocalHostAndOriginBoundary(t *testing.T) {
	app, _, _ := setup(t)
	for _, host := range []string{"evil.example", "localhost.evil:8765", "192.168.1.2:8765"} {
		r := localRequest("GET", "/api/v1/projects", nil)
		r.Host = host
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("accepted host %s: %d", host, w.Code)
		}
	}
	r := localRequest("POST", "/api/v1/projects", strings.NewReader(`{"name":"evil"}`))
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
func TestInterruptedUploadNeverVisible(t *testing.T) {
	app, _, cid := setup(t)
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	m.WriteField("submissionId", "broken")
	m.WriteField("report", report)
	f, _ := m.CreateFormFile("evidence", "log.txt")
	f.Write([]byte("partial"))
	r := localRequest("POST", "/api/v1/campaigns/"+cid+"/runs", &b)
	r.Header.Set("Content-Type", m.FormDataContentType())
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	v := request(t, app, "GET", "/api/v1/campaigns/"+cid+"/runs", "", 200)
	if len(v["items"].([]any)) != 0 {
		t.Fatal(v)
	}
	upload(t, app, cid, "broken", report, map[string]string{"log.txt": "complete"}, 201)
}
func TestArchiveAndEvidenceSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	app, e := api.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"persistent"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"delivery"}`, 201)["id"].(string)
	v := upload(t, app, cid, "persist", report, map[string]string{"log.txt": "persistent evidence"}, 201)
	rid := v["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"kind":"rejected","body":"fix it"}`, 201)
	app.Close()
	app, e = api.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer app.Close()
	v = request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if v["status"] != "rejected" || len(v["reviews"].([]any)) != 1 {
		t.Fatal(v)
	}
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+rid+"/evidence/log.txt", nil))
	if w.Code != 200 || w.Body.String() != "persistent evidence" {
		t.Fatal(w.Code, w.Body.String())
	}
	request(t, app, "DELETE", "/api/v1/campaigns/"+cid, "", 204)
	request(t, app, "GET", "/api/v1/runs/"+rid, "", 404)
	request(t, app, "GET", "/api/v1/projects/"+pid, "", 200)
}
func TestReportImmutableAndInvalidInputRejected(t *testing.T) {
	app, _, cid := setup(t)
	v := upload(t, app, cid, "immutable", report, map[string]string{"log.txt": "original"}, 201)
	rid := v["id"].(string)
	for _, method := range []string{"PUT", "PATCH"} {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest(method, "/api/v1/runs/"+rid, strings.NewReader(`{}`)))
		if w.Code != 405 {
			t.Fatal(w.Code)
		}
	}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"kind":"comment","body":"new note"}`, 201)
	got := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if got["report"].(map[string]any)["description"] != "Real check" {
		t.Fatal(got)
	}
	request(t, app, "POST", "/api/v1/projects", `{"name":"x"} {"name":"hidden"}`, 400)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"kind":"comment","body":" "}`, 400)
}

func TestFutureDatabaseVersionRejected(t *testing.T) {
	dir := t.TempDir()
	db, e := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("PRAGMA user_version=99"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	app, e := api.Open(dir)
	if e == nil {
		app.Close()
		t.Fatal("future database opened")
	}
	if !strings.Contains(e.Error(), "newer than supported") {
		t.Fatal(e)
	}
}
func TestStorageFailureDoesNotPublishPartialRun(t *testing.T) {
	dir := t.TempDir()
	app, e := api.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer app.Close()
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"disk"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"disk failure"}`, 201)["id"].(string)
	if e = os.Remove(filepath.Join(dir, "evidence")); e != nil {
		t.Fatal(e)
	}
	upload(t, app, cid, "retry", report, map[string]string{"log.txt": "log"}, 500)
	v := request(t, app, "GET", "/api/v1/campaigns/"+cid+"/runs", "", 200)
	if len(v["items"].([]any)) != 0 {
		t.Fatal(v)
	}
	if e = os.Mkdir(filepath.Join(dir, "evidence"), 0700); e != nil {
		t.Fatal(e)
	}
	upload(t, app, cid, "retry", report, map[string]string{"log.txt": "log"}, 201)
}
