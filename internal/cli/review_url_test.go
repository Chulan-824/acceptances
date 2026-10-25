package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStatusUsesSavedWebURLAndActualOwnership(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo := t.TempDir()
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writes++
		}
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"linked-project","name":"Demo"}]}`)
		case "/api/v1/projects/linked-project/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/runs/r1":
			fmt.Fprint(w, `{"id":"r1","campaignId":"actual-campaign","status":"pending","report":{"title":"Original"}}`)
		case "/api/v1/campaigns/actual-campaign":
			fmt.Fprint(w, `{"id":"actual-campaign","projectId":"actual-project"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	invoke := func(args ...string) map[string]any {
		t.Helper()
		var out, log bytes.Buffer
		if Run(args, &out, &log) != 0 {
			t.Fatal(&log)
		}
		var v map[string]any
		if err := json.Unmarshal(out.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	web := "http://127.0.0.1:5173/acceptances"
	invoke("link", "--repo", repo, "--url", server.URL, "--web-url", web+"/", "--project", "Demo")
	check := func(base string, extra ...string) {
		t.Helper()
		args := append([]string{"status", "--repo", repo, "--run", "r1"}, extra...)
		v := invoke(args...)
		if v["webUrl"] != base+"/projects/actual-project/campaigns/actual-campaign/runs/r1" || v["status"] != "pending" || v["report"].(map[string]any)["title"] != "Original" {
			t.Fatal(v)
		}
	}
	check(web)
	check("http://localhost:9999", "--web-url", "http://localhost:9999/")
	check(web) // A one-command override must not replace the saved Web address.
	if writes != 1 {
		t.Fatalf("status wrote data: %d requests", writes)
	}
	// Older bindings have no Web address and retain the same-origin contract.
	source, err := repositorySource(repo)
	if err != nil {
		t.Fatal(err)
	}
	path, err := bindingPath(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(fmt.Sprintf(`{"url":%q,"projectId":"linked-project","repositoryId":"repo1","source":%q}`, server.URL, source)), 0600); err != nil {
		t.Fatal(err)
	}
	check(server.URL)
	// Linking to another service must not reuse the previous service's Web address.
	invoke("link", "--repo", repo, "--url", server.URL, "--web-url", web, "--project", "Demo")
	proxy := httptest.NewServer(server.Config.Handler)
	defer proxy.Close()
	v := invoke("link", "--repo", repo, "--url", proxy.URL, "--project", "Demo")
	if v["webUrl"] != proxy.URL {
		t.Fatal(v)
	}
	check(proxy.URL)
}

func TestInvalidWebURLHasNoWriteSideEffects(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo, bundle := t.TempDir(), t.TempDir()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; http.Error(w, "unexpected request", 500) }))
	defer server.Close()
	for _, web := range []string{"/relative", "ftp://localhost", "http://user:secret@localhost", "http://localhost?query=x", "http://localhost?", "http://localhost#fragment", "http://localhost:bad"} {
		for _, command := range []string{"link", "publish"} {
			t.Run(command+"/"+web, func(t *testing.T) {
				var out, log bytes.Buffer
				args := []string{command, "--repo", repo, "--url", server.URL, "--web-url", web, "--project", "Demo", "--campaign", "c1", "--bundle", bundle}
				if Run(args, &out, &log) == 0 || !bytes.Contains(log.Bytes(), []byte("invalid Web URL")) {
					t.Fatalf("%s %s", &out, &log)
				}
			})
		}
	}
	if requests != 0 {
		t.Fatalf("invalid address contacted service %d times", requests)
	}
	if _, err := os.Stat(filepath.Join(bundle, ".submission-id")); !os.IsNotExist(err) {
		t.Fatalf("submission created: %v", err)
	}
}
