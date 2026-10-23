package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestCampaignContract(t *testing.T) {
	t.Parallel()
	app, err := api.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	checkCampaignContract(t, app)
}

func checkCampaignContract(t *testing.T, app *api.Server) {
	t.Helper()
	project := request(t, app, "POST", "/api/v1/projects", `{"name":"Campaign contract"}`, 201)
	path := "/api/v1/projects/" + project["id"].(string) + "/campaigns"
	if got := request(t, app, "GET", path, "", 200); !reflect.DeepEqual(got["items"], []any{}) {
		t.Fatalf("empty campaigns: %v", got)
	}
	first := request(t, app, "POST", path, `{"title":"  原始标题  ","description":"原始描述"}`, 201)
	if first["title"] != "  原始标题  " || first["description"] != "原始描述" || first["status"] != "pending" || first["latestRunId"] != "" || first["projectId"] != project["id"] {
		t.Fatalf("created campaign: %v", first)
	}
	if len(first) != 7 || first["id"] == "" || first["createdAt"] == "" {
		t.Fatalf("campaign response fields: %v", first)
	}
	idPath := "/api/v1/campaigns/" + first["id"].(string)
	if got := request(t, app, "GET", idPath, "", 200); !reflect.DeepEqual(got, first) {
		t.Fatalf("get changed campaign: %v", got)
	}
	second := request(t, app, "POST", path, `{"title":"Second"}`, 201)
	items := request(t, app, "GET", path, "", 200)["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != second["id"] || items[1].(map[string]any)["id"] != first["id"] {
		t.Fatalf("campaign order: %v", items)
	}
	for _, tc := range []struct {
		name, description string
	}{
		{"save original description", "原始描述"},
		{"save changed description", "修正后的描述"},
		{"save empty description", ""},
		{"save maximum length description", strings.Repeat("a", 65536)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]string{"description": tc.description})
			if err != nil {
				t.Fatal(err)
			}
			want := maps.Clone(first)
			want["description"] = tc.description
			// Retrying a successful save must return the same resource on both databases.
			for attempt := range 2 {
				if got := request(t, app, "PATCH", idPath, string(body), 200); !reflect.DeepEqual(got, want) {
					t.Fatalf("save attempt %d changed other campaign fields", attempt+1)
				}
			}
			if got := request(t, app, "GET", idPath, "", 200); !reflect.DeepEqual(got, want) {
				t.Fatal("description update was not persisted")
			}
			if got := request(t, app, "GET", "/api/v1/campaigns/"+second["id"].(string), "", 200); !reflect.DeepEqual(got, second) {
				t.Fatal("description update changed an unrelated campaign")
			}
		})
	}
	oversizedDescription, err := json.Marshal(map[string]string{"description": strings.Repeat("界", 21846)})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, method, path, body, code string
		status                         int
	}{
		{"blank title", "POST", path, `{"title":" \t "}`, "TITLE_REQUIRED", 400},
		{"missing title", "POST", path, `{}`, "TITLE_REQUIRED", 400},
		{"unknown create field", "POST", path, `{"title":"x","status":"accepted"}`, "INVALID_INPUT", 400},
		{"missing project list", "GET", "/api/v1/projects/missing/campaigns", "", "PROJECT_NOT_FOUND", 404},
		{"missing project create", "POST", "/api/v1/projects/missing/campaigns", `{"title":"x"}`, "PROJECT_NOT_FOUND", 404},
		{"project lookup precedes decoding", "POST", "/api/v1/projects/missing/campaigns", `{`, "PROJECT_NOT_FOUND", 404},
		{"missing campaign", "GET", "/api/v1/campaigns/missing", "", "CAMPAIGN_NOT_FOUND", 404},
		{"missing update target", "PATCH", "/api/v1/campaigns/missing", `{"description":"x"}`, "CAMPAIGN_NOT_FOUND", 404},
		{"missing description", "PATCH", idPath, `{}`, "DESCRIPTION_REQUIRED", 400},
		{"null description", "PATCH", idPath, `{"description":null}`, "DESCRIPTION_REQUIRED", 400},
		{"description byte limit", "PATCH", idPath, string(oversizedDescription), "DESCRIPTION_REQUIRED", 400},
		{"unknown update field", "PATCH", idPath, `{"description":"x","status":"accepted"}`, "INVALID_INPUT", 400},
		{"wrong description type", "PATCH", idPath, `{"description":1}`, "INVALID_INPUT", 400},
		{"multiple JSON values", "PATCH", idPath, `{"description":"x"} {}`, "INVALID_INPUT", 400},
		{"trailing garbage", "PATCH", idPath, `{"description":"x"}x`, "INVALID_INPUT", 400},
		{"empty body", "PATCH", idPath, "", "INVALID_INPUT", 400},
		{"oversized body", "POST", path, `{"title":"` + strings.Repeat("a", 1<<20) + `"}`, "INVALID_INPUT", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := request(t, app, tc.method, tc.path, tc.body, tc.status)
			if got["code"] != tc.code || got["message"] != strings.ReplaceAll(strings.ToLower(tc.code), "_", " ") || len(got) != 2 {
				t.Fatalf("error contract: %v", got)
			}
		})
	}
}

func TestMySQLCampaignContract(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	checkCampaignContract(t, app)
}

func TestCampaignSharedMutationLock(t *testing.T) {
	t.Parallel()
	app, err := api.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	checkCampaignSharedMutationLock(t, app)
}

func TestMySQLCampaignSharedMutationLock(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	checkCampaignSharedMutationLock(t, app)
}

func checkCampaignSharedMutationLock(t *testing.T, app *api.Server) {
	t.Helper()
	for _, tc := range []struct {
		name, method string
		status       int
	}{
		{"delete campaign", "DELETE", 204},
		{"accept latest run", "POST", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			project := request(t, app, "POST", "/api/v1/projects", `{"name":"Shared mutation lock"}`, 201)
			campaign := request(t, app, "POST", "/api/v1/projects/"+project["id"].(string)+"/campaigns", `{"title":"Concurrent mutation","description":"before"}`, 201)
			cid := campaign["id"].(string)
			path := "/api/v1/campaigns/" + cid
			run := upload(t, app, cid, cid+"-run", reviewReport(t, "full", "passed"), map[string]string{"log.txt": "Synthetic concurrency fixture"}, 201)
			runPath := "/api/v1/runs/" + run["id"].(string)
			before := request(t, app, "GET", path, "", 200)
			legacyPath := path
			if tc.method == "POST" {
				legacyPath = runPath + "/accept-all"
			}

			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			resume := make(chan struct{})
			unblock := sync.OnceFunc(func() { close(resume) })
			var requests sync.WaitGroup
			defer func() {
				unblock()
				requests.Wait()
			}()
			legacy := &campaignResponseGate{ResponseRecorder: httptest.NewRecorder(), reached: make(chan int, 1), resume: resume}
			legacyDone := make(chan struct{})
			// Use separate real registrations: neither test supplies the Service's lock.
			legacyHandler, patchHandler := app.Handler(), app.Handler()
			requests.Go(func() {
				defer close(legacyDone)
				legacyHandler.ServeHTTP(legacy, localRequest(tc.method, legacyPath, strings.NewReader(`{}`)).WithContext(ctx))
			})
			select {
			case status := <-legacy.reached:
				if status != tc.status {
					t.Fatalf("legacy mutation status = %d, want %d", status, tc.status)
				}
			case <-ctx.Done():
				t.Fatal("legacy mutation did not reach its response:", ctx.Err())
			}
			// Both legacy handlers still own s.mu at WriteHeader, but their SQL
			// transactions have committed. Database row/pool locks cannot mask a
			// separately wired Campaign lock. Confirm this with a real GET.
			if tc.method == "DELETE" {
				request(t, app, "GET", path, "", 404)
			} else if current := request(t, app, "GET", path, "", 200); current["status"] != "accepted" || current["description"] != "before" {
				t.Fatal("legacy status mutation was not committed before PATCH", current)
			}

			bodyRead := make(chan struct{})
			body := &campaignBodyReader{Reader: strings.NewReader(`{"description":"after"}`), onEOF: sync.OnceFunc(func() { close(bodyRead) })}
			patch := httptest.NewRecorder()
			patchDone := make(chan struct{})
			requests.Go(func() {
				defer close(patchDone)
				patchHandler.ServeHTTP(patch, localRequest("PATCH", path, body).WithContext(ctx))
			})
			select {
			case <-bodyRead:
			case <-ctx.Done():
				t.Fatal("PATCH did not consume its body:", ctx.Err())
			}
			// The channels arrange the overlap; this bounded observation checks
			// that PATCH cannot finish until the legacy handler releases its lock.
			select {
			case <-patchDone:
				t.Fatalf("PATCH completed while the legacy mutation held the shared lock: %d %s", patch.Code, patch.Body.String())
			case <-time.After(100 * time.Millisecond):
			case <-ctx.Done():
				t.Fatal("concurrent requests timed out:", ctx.Err())
			}
			unblock()
			for _, done := range []<-chan struct{}{legacyDone, patchDone} {
				select {
				case <-done:
				case <-ctx.Done():
					t.Fatal("request did not finish after releasing the legacy response:", ctx.Err())
				}
			}
			var got map[string]any
			if err := json.Unmarshal(patch.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if tc.method == "DELETE" {
				if patch.Code != 404 || got["code"] != "CAMPAIGN_NOT_FOUND" {
					t.Fatalf("PATCH after deletion = %d %v", patch.Code, got)
				}
				request(t, app, "GET", path, "", 404)
				request(t, app, "GET", runPath, "", 404)
				return
			}
			want := maps.Clone(before)
			want["description"], want["status"] = "after", "accepted"
			if patch.Code != 200 || !reflect.DeepEqual(got, want) {
				t.Fatalf("PATCH after acceptance = %d %v, want %v", patch.Code, got, want)
			}
			if current := request(t, app, "GET", path, "", 200); !reflect.DeepEqual(current, want) {
				t.Fatal("concurrent mutations were not persisted", current)
			}
			currentRun := request(t, app, "GET", runPath, "", 200)
			if currentRun["status"] != "accepted" || len(currentRun["reviews"].([]any)) != 1 || !reflect.DeepEqual(currentRun["report"], run["report"]) {
				t.Fatal("description PATCH changed the accepted Run or its report", currentRun)
			}
		})
	}
}

type campaignResponseGate struct {
	*httptest.ResponseRecorder
	reached chan int
	resume  <-chan struct{}
}

func (w *campaignResponseGate) WriteHeader(status int) {
	w.reached <- status
	<-w.resume
	w.ResponseRecorder.WriteHeader(status)
}

type campaignBodyReader struct {
	io.Reader
	onEOF func()
}

func (r *campaignBodyReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if errors.Is(err, io.EOF) {
		r.onEOF()
	}
	return n, err
}
