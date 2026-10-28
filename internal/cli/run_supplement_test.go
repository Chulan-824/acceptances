package cli

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSupplementCLIUsesExistingRunAndStableInput(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo, bundle := t.TempDir(), t.TempDir()
	input := `{"requestId":"stable","token":"prepared","reason":"Confirmed same deployment","verificationUnchanged":true,"evidence":[{"path":"note.txt","description":"Late provenance"}]}`
	for name, data := range map[string]string{"supplement.json": input, "note.txt": "Existing verification"} {
		if err := os.WriteFile(filepath.Join(bundle, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		case "/api/v1/projects/p1/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/runs/r1/delivery-preparation":
			fmt.Fprint(w, `{"token":"prepared","eligible":false}`)
		case "/api/v1/runs/r1/delivery-supplements":
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if !strings.Contains(r.FormValue("supplement"), `"requestId":"stable"`) || len(r.MultipartForm.File["evidence"]) != 1 {
				t.Error("lost input or attachment")
			}
			posts++
			fmt.Fprint(w, `{"id":"r1","campaignId":"c1"}`)
		case "/api/v1/runs/r1":
			fmt.Fprint(w, `{"id":"r1","campaignId":"c1"}`)
		case "/api/v1/campaigns/c1":
			fmt.Fprint(w, `{"id":"c1","projectId":"p1"}`)
		default:
			t.Error("unexpected route", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	var out, log bytes.Buffer
	invoke := func(args ...string) string {
		t.Helper()
		out.Reset()
		log.Reset()
		if Run(args, &out, &log) != 0 {
			t.Fatal(log.String())
		}
		return out.String()
	}
	invoke("link", "--repo", repo, "--url", server.URL, "--project", "Demo", "--web-url", "http://localhost:5173")
	if !strings.Contains(invoke("preparation", "--repo", repo, "--run", "r1"), `"token": "prepared"`) {
		t.Fatal("missing preparation")
	}
	for range 2 {
		if !strings.Contains(invoke("supplement", "--repo", repo, "--run", "r1", "--bundle", bundle), "/campaigns/c1/runs/r1") {
			t.Fatal("missing existing Run link")
		}
	}
	if posts != 2 {
		t.Fatal("retry was not sent")
	}
	if _, err := os.Stat(filepath.Join(bundle, ".submission-id")); !os.IsNotExist(err) {
		t.Fatal("created a new Run submission ID", err)
	}
}
