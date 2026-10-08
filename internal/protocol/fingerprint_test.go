package protocol

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestFingerprintIncludesDirtyAndMarksIncomplete(t *testing.T) {
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		raw, err := cmd.Output()
		if err != nil {
			t.Fatalf("isolated fixture git command failed: %v", err)
		}
		return string(raw)
	}
	git("init", "-q")
	git("config", "user.name", "fixture")
	git("config", "user.email", "fixture@example.invalid")
	for _, name := range []string{"kept.txt", "modified.txt", "deleted.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("baseline"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("add", "--", "kept.txt", "modified.txt", "deleted.txt")
	git("commit", "-q", "-m", "fixture")
	base := git("rev-parse", "HEAD")
	base = base[:len(base)-1]
	if err := os.WriteFile(filepath.Join(dir, "modified.txt"), []byte("changed"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "deleted.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "untracked.txt"), []byte("untracked build input"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "added.txt"), []byte("staged addition"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", "--", "added.txt")
	manifest, digest, err := CollectFingerprint(dir, "00000000-0000-4000-8000-000000000002", base, Scope{Include: []string{"**"}, Exclude: []string{}, MissingInputs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if !manifest.Complete || len(digest) != 64 {
		t.Fatal("complete isolated input lost fingerprint")
	}
	status := map[string]string{}
	for _, file := range manifest.Files {
		status[file.Path] = file.Status
		if file.Status == "deleted" && (file.Mode != nil || file.SHA256 != nil) {
			t.Fatal("deleted entry must have null mode/hash")
		}
	}
	for name, want := range map[string]string{"kept.txt": "unchanged", "modified.txt": "modified", "deleted.txt": "deleted", "untracked.txt": "untracked", "added.txt": "added"} {
		if status[name] != want {
			t.Errorf("%s status=%s want=%s", name, status[name], want)
		}
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "outside"), filepath.Join(dir, "source-link")); err != nil {
		t.Fatal(err)
	}
	incomplete, _, err := CollectFingerprint(dir, "00000000-0000-4000-8000-000000000002", base, Scope{Include: []string{"**"}, Exclude: []string{}, MissingInputs: []string{}})
	if err != nil || incomplete.Complete || len(incomplete.Scope.MissingInputs) == 0 {
		t.Fatal("source symlink must make scope incomplete")
	}
}

func TestFingerprintRecursiveScope(t *testing.T) {
	for _, name := range []string{"main.go", "src/main.go", "src/nested/main.go"} {
		if !selected(name, []string{"**/*.go"}) {
			t.Errorf("recursive scope missed %s", name)
		}
	}
	if selected("src/main.ts", []string{"**/*.go"}) {
		t.Fatal("scope selected an unrelated extension")
	}
}
