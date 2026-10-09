package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFingerprintCLI(t *testing.T) {
	root, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	repo := filepath.Join(temp, "repo")
	if raw, err := exec.Command("git", "clone", "--quiet", "--shared", "--no-checkout", strings.TrimSpace(string(root)), repo).CombinedOutput(); err != nil {
		t.Fatalf("isolated Git copy: %s %v", raw, err)
	}
	base, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(repo, "actual.txt"), []byte("isolated source input"), 0600); err != nil {
		t.Fatal(err)
	}
	// Synthetic secret path must be reported as missing, never fingerprinted.
	if err = os.WriteFile(filepath.Join(repo, ".env.synthetic-test"), []byte("synthetic-only"), 0600); err != nil {
		t.Fatal(err)
	}
	scope := filepath.Join(temp, "scope.json")
	if err = os.WriteFile(scope, []byte(`{"include":["actual.txt",".env.synthetic-test"],"exclude":[],"missingInputs":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	var out, log bytes.Buffer
	if exit := Run([]string{"fingerprint", "--repo", repo, "--repository", "00000000-0000-4000-8000-000000000002", "--base", strings.TrimSpace(string(base)), "--scope", scope, "--json"}, &out, &log); exit != 0 {
		t.Fatalf("fingerprint exit=%d: %s", exit, out.String())
	}
	var result struct {
		Fingerprint string `json:"fingerprint"`
		ScopeDigest string `json:"scopeDigest"`
		Manifest    struct {
			Complete bool `json:"complete"`
			Files    []struct {
				Path string `json:"path"`
			} `json:"files"`
		} `json:"manifest"`
	}
	if err = json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Fingerprint) != 64 || len(result.ScopeDigest) != 64 || result.Manifest.Complete || len(result.Manifest.Files) != 1 || result.Manifest.Files[0].Path != "actual.txt" {
		t.Fatalf("incorrect source identity or secret handling: %s", out.String())
	}
}
