package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/config"
	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/storage"
)

// Requires a fresh dedicated database. It never drops, truncates or cleans a database.
func TestLocalPublicationPostgres(t *testing.T) {
	dsn := os.Getenv("ACCEPTANCES_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("external dedicated PostgreSQL required")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(strings.TrimPrefix(u.Path, "/"), "acceptances_test_") || os.Getenv("ACCEPTANCES_TEST_ISOLATED") != "1" {
		t.Fatal("dedicated acceptances_test_* database and isolation acknowledgement required")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var pgVersion int
	if err = store.Pool.QueryRow(ctx, "SELECT current_setting('server_version_num')::integer").Scan(&pgVersion); err != nil || pgVersion != 180006 {
		t.Fatal("PostgreSQL 18.6 test runtime required")
	}
	var installed *string
	if err = store.Pool.QueryRow(ctx, "SELECT to_regclass('public.projects')::text").Scan(&installed); err != nil {
		t.Fatal("database unavailable")
	}
	if installed != nil {
		t.Fatal("test requires a fresh database; existing installation is preserved")
	}
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	local, err := storage.Open(t.TempDir(), store)
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	service := New(store, config.Config{PublicOrigin: "http://127.0.0.1:8765"})
	service.Storage = local
	if err = service.Auth.InitOwner(ctx, "fixture-owner", "test-only-password-1234"); err != nil {
		t.Fatal(err)
	}
	if err = service.Auth.InitOwner(ctx, "overwrite", "test-only-password-5678"); err == nil {
		t.Fatal("second initialization overwrote owner")
	}
	mux := http.NewServeMux()
	service.Register(mux)
	handler := service.Guard(mux)
	var cookie *http.Cookie
	csrf := ""
	call := func(method, path string, raw []byte, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://127.0.0.1:8765"+path, bytes.NewReader(raw))
		r.Header.Set("Origin", service.Config.PublicOrigin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", protocol.NewID())
		r.Header.Set("X-CSRF-Token", csrf)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	must := func(w *httptest.ResponseRecorder, status int) map[string]any {
		t.Helper()
		if w.Code != status {
			t.Fatalf("HTTP status=%d want=%d body=%s", w.Code, status, w.Body.String())
		}
		var envelope map[string]any
		if w.Body.Len() > 0 {
			if err = json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
		}
		return object(envelope["data"])
	}
	encoded := func(value any) []byte {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	login := call("POST", "/api/v1/session", encoded(map[string]any{"username": "fixture-owner", "password": "test-only-password-1234"}), nil)
	session := must(login, 200)
	csrf = text(session, "csrfToken")
	cookie = login.Result().Cookies()[0]
	bundle, err := protocol.LoadBundle("../../contracts/fixtures/failed-bundle")
	if err != nil {
		t.Fatal(err)
	}
	project := bundle.Report.ProjectID
	campaign := text(bundle.Report.Value, "campaignId")
	base := "/api/v1/projects/" + project
	camp := base + "/campaigns/" + campaign
	must(call("POST", "/api/v1/projects", encoded(map[string]any{"id": project, "name": "fixture"}), nil), 201)
	limited := must(call("POST", base+"/tokens", encoded(map[string]any{"id": protocol.NewID(), "name": "read-only", "scopes": []string{"results:read"}}), nil), 201)
	tokenID := protocol.NewID()
	writer := must(call("POST", base+"/tokens", encoded(map[string]any{"id": tokenID, "name": "repository-writer", "scopes": []string{"repositories:write", "results:read", "campaigns:write"}}), nil), 201)
	repositoryBody := encoded(map[string]any{"id": "00000000-0000-4000-8000-000000000002", "displayName": "fixture", "locator": "local://fixture"})
	machine := map[string]string{"Authorization": "Bearer " + text(writer, "secret"), "Idempotency-Key": "repository-fixture"}
	must(call("POST", base+"/repositories", repositoryBody, map[string]string{"Authorization": "Bearer " + text(limited, "secret")}), 403)
	must(call("POST", "/api/v1/projects/"+protocol.NewID()+"/repositories", repositoryBody, machine), 403)
	must(call("POST", base+"/tokens", encoded(map[string]any{"id": protocol.NewID(), "name": "escalation", "scopes": []string{"repositories:write"}}), machine), 403)
	must(call("POST", "/api/v1/projects", encoded(map[string]any{"id": protocol.NewID(), "name": "escalation"}), machine), 403)
	must(call("POST", base+"/repositories", repositoryBody, machine), 201)
	must(call("POST", base+"/repositories", repositoryBody, machine), 201)
	must(call("POST", base+"/campaigns", encoded(map[string]any{"id": campaign, "title": "fixture", "externalRefs": map[string]any{"acceptances/requirement": "fixture-issue"}}), nil), 201)
	if text(object(must(call("GET", camp, nil, machine), 200)["externalRefs"]), "acceptances/requirement") != "fixture-issue" {
		t.Fatal("campaign requirement identity missing from detail")
	}
	page := must(call("GET", base+"/campaigns", nil, machine), 200)
	if text(object(object(list(page["items"])[0])["externalRefs"]), "acceptances/requirement") != "fixture-issue" {
		t.Fatal("campaign requirement identity missing from list")
	}
	must(call("DELETE", base+"/tokens/"+tokenID, nil, nil), 204)
	must(call("POST", base+"/repositories", repositoryBody, machine), 401)
	for _, kind := range []string{"definitions", "target", "plan"} {
		for _, ref := range bundle.Manifest.Documents {
			if ref.Kind != kind {
				continue
			}
			doc := bundle.Documents[ref.ID]
			path := base + "/definitions/" + doc.ID
			if kind != "definitions" {
				path = camp + "/" + kind + "s/" + doc.ID
			}
			must(call("PUT", path, doc.Raw, nil), 201)
			must(call("PUT", path, doc.Raw, nil), 200)
		}
	}
	plan := object(bundle.Report.Value["planRef"])
	target := object(bundle.Report.Value["targetRef"])
	current := call("GET", camp, nil, nil)
	must(current, 200)
	must(call("PATCH", camp+"/basis", encoded(map[string]any{"planId": plan["id"], "targetId": target["id"], "reason": "fixture baseline"}), map[string]string{"If-Match": current.Header().Get("ETag")}), 200)
	run := bundle.Manifest.RunID
	runBody := encoded(map[string]any{"id": run, "campaignId": campaign, "planId": plan["id"], "targetId": target["id"], "producer": bundle.Report.Value["producer"]})
	must(call("POST", base+"/runs", runBody, map[string]string{"Idempotency-Key": run}), 201)
	must(call("POST", base+"/runs", runBody, map[string]string{"Idempotency-Key": run}), 201)
	input := protocol.RevisionInput{ID: bundle.Report.ID, ReportBase64: base64.StdEncoding.EncodeToString(bundle.Report.Raw), ManifestBase64: base64.StdEncoding.EncodeToString(bundle.ManifestRaw)}
	runPath := base + "/runs/" + run
	revPath := runPath + "/revisions/" + bundle.Report.ID
	draft := must(call("POST", runPath+"/revisions", encoded(input), map[string]string{"Idempotency-Key": input.ID}), 201)
	must(call("POST", revPath+"/finalize", encoded(map[string]any{"generation": draft["generation"]}), nil), 409)
	for _, asset := range bundle.Manifest.Assets {
		raw, err := os.ReadFile("../../contracts/fixtures/failed-bundle/" + asset.Path)
		if err != nil {
			t.Fatal(err)
		}
		must(call("PUT", revPath+"/assets/"+asset.ID+"/content", raw, map[string]string{"Content-Type": "application/octet-stream", "X-Upload-Generation": text(draft, "generation")}), 200)
	}
	must(call("POST", revPath+"/finalize", encoded(map[string]any{"generation": draft["generation"]}), map[string]string{"Idempotency-Key": input.ID + "-finalize"}), 202)
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); service.Work(ctx) }()
	defer func() { cancel(); <-workerDone }()
	deadline := time.Now().Add(20 * time.Second)
	var sealed map[string]any
	for time.Now().Before(deadline) {
		sealed = must(call("GET", revPath, nil, nil), 200)
		if text(sealed, "phase") == "sealed" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if text(sealed, "phase") != "sealed" {
		t.Fatalf("failed business report was not sealed: %v", sealed)
	}
	if text(sealed, "sealDigest") == "" {
		t.Fatal("seal digest missing")
	}
	for time.Now().Before(deadline) {
		var id *string
		err = store.Pool.QueryRow(ctx, "SELECT current_snapshot_id::text FROM campaigns WHERE project_id=$1 AND id=$2", project, campaign).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		if id != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	gate := must(call("GET", camp+"/gate?mode=ready", nil, nil), 200)
	if gate["satisfied"] != false {
		t.Fatal("failed and unverified report incorrectly satisfies readiness")
	}
	asset := bundle.Manifest.Assets[0]
	contentPath := base + "/revisions/" + input.ID + "/assets/" + asset.ID + "/content"
	rangeResponse := call("GET", contentPath, nil, map[string]string{"Range": "bytes=0-3"})
	if rangeResponse.Code != 206 || rangeResponse.Body.Len() != 4 {
		t.Fatal("single range evidence response incorrect")
	}
}
