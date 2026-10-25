package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMoveRunCLIAndPublishRetryUseActualCampaign(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	repo, bundle := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(bundle, "report.json"), []byte(`{"title":"Original","scope":"Synthetic CLI validation","verifiedAt":"2026-10-24T00:00:00Z","checks":[{"id":"fixture","title":"Fixture","expected":"Observed","actual":"Observed","status":"passed"}],"evidence":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	moves := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/projects":
			fmt.Fprint(w, `{"items":[{"id":"p1","name":"Demo"}]}`)
		case "/api/v1/projects/p1/repositories":
			fmt.Fprint(w, `{"id":"repo1"}`)
		case "/api/v1/projects/p1/campaigns":
			fmt.Fprint(w, `{"items":[{"id":"source","title":"Original"},{"id":"target","title":"Independent"}]}`)
		case "/api/v1/runs/r1/move":
			if r.Method != "POST" {
				t.Error(r.Method)
			}
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["requestId"] != "stable" || body["fromCampaignId"] != "source" || body["toCampaignId"] != "target" || body["reason"] != "Correct ownership" {
				t.Error(body)
			}
			moves++
			fmt.Fprint(w, `{"move":{"id":"move1"},"run":{"id":"r1","campaignId":"target"}}`)
		case "/api/v1/campaigns/source/runs":
			fmt.Fprint(w, `{"id":"r1","campaignId":"target"}`)
		default:
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
			t.Fatal(&log)
		}
		return out.String()
	}
	invoke("link", "--repo", repo, "--url", server.URL, "--project", "Demo", "--web-url", "http://127.0.0.1:5173/review/")
	for range 2 {
		receipt := invoke("move-run", "--repo", repo, "--run", "r1", "--from-campaign", "source", "--campaign", "Independent", "--reason", "Correct ownership", "--request-id", "stable")
		if !strings.Contains(receipt, "http://127.0.0.1:5173/review/projects/p1/campaigns/target/runs/r1") {
			t.Fatal(receipt)
		}
	}
	receipt := invoke("publish", "--repo", repo, "--bundle", bundle, "--campaign", "Original")
	if !strings.Contains(receipt, "http://127.0.0.1:5173/review/projects/p1/campaigns/target/runs/r1") {
		t.Fatal("publish retry points to old Campaign", receipt)
	}
	if moves != 2 {
		t.Fatal("CLI skipped replay request")
	}
	if Run([]string{"move-run", "--repo", repo, "--run", "r1", "--campaign", "target"}, &out, &log) == 0 {
		t.Fatal("move missing guards accepted")
	}
}
