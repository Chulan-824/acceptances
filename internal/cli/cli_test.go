package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinkAndPublishRetry(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo := t.TempDir()
	bundle := t.TempDir()
	os.WriteFile(filepath.Join(bundle, "report.json"), []byte(`{"title":"Login","evidence":[{"path":"log.txt"}]}`), 0600)
	os.WriteFile(filepath.Join(bundle, "log.txt"), []byte("actual evidence"), 0600)
	var ids []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		case "/api/v1/projects/p1/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/projects/p1/campaigns":
			fmt.Fprint(w, `{"items":[{"id":"c1","title":"Login"}]}`)
		case "/api/v1/campaigns/c1/runs":
			if err := r.ParseMultipartForm(1024 * 1024); err != nil {
				t.Error(err)
			}
			ids = append(ids, r.FormValue("submissionId"))
			f, _, err := r.FormFile("evidence")
			if err != nil {
				t.Error(err)
			} else {
				defer f.Close()
				var b bytes.Buffer
				b.ReadFrom(f)
				if b.String() != "actual evidence" {
					t.Error(b.String())
				}
			}
			fmt.Fprint(w, `{"id":"r1","status":"pending"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	invoke := func(args ...string) {
		t.Helper()
		var out, log bytes.Buffer
		if code := Run(args, &out, &log); code != 0 {
			t.Fatalf("%v: exit %d %s %s", args, code, &out, &log)
		}
		if args[0] == "publish" && !bytes.Contains(out.Bytes(), []byte(server.URL+"/projects/p1/campaigns/c1/runs/r1")) {
			t.Fatalf("missing browser URL: %s", &out)
		}
	}
	invoke("link", "--url", server.URL, "--repo", repo, "--project", "Demo")
	invoke("publish", "--repo", repo, "--bundle", bundle, "--campaign", "Login")
	invoke("publish", "--repo", repo, "--bundle", bundle, "--campaign", "Login")
	if len(ids) != 2 || ids[0] == "" || ids[0] != ids[1] {
		t.Fatalf("retry IDs: %v", ids)
	}
}

// Association is observed through the CLI in two real Git worktrees, not by
// inspecting host configuration internals.
func TestWorktreesShareAssociation(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", repo}, args...)...)
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
	}
	git("init", "-q")
	git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial")
	worktree := filepath.Join(t.TempDir(), "worktree")
	git("worktree", "add", "--detach", worktree)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects" {
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		} else {
			fmt.Fprint(w, `{"id":"repo1"}`)
		}
	}))
	defer server.Close()
	var out, log bytes.Buffer
	if code := Run([]string{"link", "--repo", repo, "--url", server.URL, "--project", "Demo"}, &out, &log); code != 0 {
		t.Fatal(&log)
	}
	out.Reset()
	if code := Run([]string{"context", "--repo", worktree}, &out, &log); code != 0 {
		t.Fatal(&log)
	}
	var context struct {
		Association struct {
			ProjectID string `json:"projectId"`
		} `json:"association"`
		Version struct {
			Commit string `json:"commit"`
			Dirty  *bool  `json:"dirty"`
		} `json:"version"`
	}
	if err := json.Unmarshal(out.Bytes(), &context); err != nil {
		t.Fatal(err)
	}
	if context.Association.ProjectID != "p1" || context.Version.Commit == "unknown" || context.Version.Dirty == nil || *context.Version.Dirty {
		t.Fatalf("wrong context: %s", &out)
	}
}

func TestPublishReportsConflictAndRetainsSubmission(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo, bundle := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(bundle, "report.json"), []byte(`{"title":"report","evidence":[]}`), 0600)
	var ids []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		case "/api/v1/projects/p1/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/projects/p1/campaigns":
			fmt.Fprint(w, `{"items":[{"id":"c1","title":"Case"}]}`)
		default:
			r.ParseMultipartForm(1024)
			ids = append(ids, r.FormValue("submissionId"))
			w.WriteHeader(http.StatusConflict)
			fmt.Fprint(w, `{"code":"submission_conflict","message":"different content"}`)
		}
	}))
	defer server.Close()
	var out, log bytes.Buffer
	if Run([]string{"link", "--repo", repo, "--url", server.URL, "--project", "Demo"}, &out, &log) != 0 {
		t.Fatal(&log)
	}
	for range 2 {
		out.Reset()
		log.Reset()
		if Run([]string{"publish", "--repo", repo, "--bundle", bundle, "--campaign", "Case"}, &out, &log) == 0 {
			t.Fatal("conflict reported success")
		}
		if !bytes.Contains(log.Bytes(), []byte("HTTP 409")) {
			t.Fatal(&log)
		}
		if out.Len() != 0 {
			t.Fatal("error produced a success result")
		}
	}
	if len(ids) != 2 || ids[0] == "" || ids[0] != ids[1] {
		t.Fatalf("retry regenerated ID: %v", ids)
	}
}

func TestFeedbackIncludesLargeCampaignHistory(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo := t.TempDir()
	history := `{"items":[{"id":"r1","report":{"description":"` + strings.Repeat("x", 17<<20) + `"}},{"id":"last-run","status":"accepted"}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		case "/api/v1/projects/p1/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/projects/p1/campaigns":
			fmt.Fprint(w, `{"items":[{"id":"c1","title":"Delivery"}]}`)
		case "/api/v1/campaigns/c1/runs":
			fmt.Fprint(w, history)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	var out, log bytes.Buffer
	if Run([]string{"link", "--repo", repo, "--url", server.URL, "--project", "Demo"}, &out, &log) != 0 {
		t.Fatal(&log)
	}
	out.Reset()
	if Run([]string{"feedback", "--repo", repo, "--campaign", "Delivery"}, &out, &log) != 0 {
		t.Fatal(&log)
	}
	if !json.Valid(out.Bytes()) || !bytes.Contains(out.Bytes(), []byte("last-run")) {
		t.Fatal("campaign history is incomplete")
	}
}

func TestLinkUsesBusinessDirectoryName(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	parent := t.TempDir()
	var names []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/projects" {
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
			return
		}
		var repository struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&repository); err != nil {
			t.Error(err)
		}
		names = append(names, repository.Name)
		fmt.Fprint(w, `{"id":"repo1"}`)
	}))
	defer server.Close()
	for _, name := range []string{"frontend", "backend"} {
		repo := filepath.Join(parent, name)
		if err := os.Mkdir(repo, 0700); err != nil {
			t.Fatal(err)
		}
		var out, log bytes.Buffer
		if Run([]string{"link", "--repo", repo, "--url", server.URL, "--project", "Demo"}, &out, &log) != 0 {
			t.Fatal(&log)
		}
	}
	if len(names) != 2 || names[0] != "frontend" || names[1] != "backend" {
		t.Fatalf("wrong repository names: %v", names)
	}
}
