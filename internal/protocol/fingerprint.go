package protocol

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

type Scope struct {
	Include       []string `json:"include"`
	Exclude       []string `json:"exclude"`
	MissingInputs []string `json:"missingInputs"`
}
type FingerprintFile struct {
	Path   string  `json:"path"`
	Status string  `json:"status"`
	Mode   *string `json:"mode"`
	SHA256 *string `json:"sha256"`
}
type FingerprintManifest struct {
	EncodingVersion string            `json:"encodingVersion"`
	RepositoryID    string            `json:"repositoryId"`
	BaseCommit      string            `json:"baseCommit"`
	Scope           Scope             `json:"scope"`
	Complete        bool              `json:"complete"`
	Files           []FingerprintFile `json:"files"`
}

// CollectFingerprint captures every in-scope working file and baseline deletion, including untracked files.
// It never follows source symlinks or reads recognized secret files.
func CollectFingerprint(dir, repositoryID, baseCommit string, scope Scope) (FingerprintManifest, string, error) {
	if !ValidID(repositoryID) || (len(baseCommit) != 40 && len(baseCommit) != 64) || strings.ToLower(baseCommit) != baseCommit {
		return FingerprintManifest{}, "", Failure("INVALID_ARGUMENT", "", "repository ID and full lowercase baseline commit required")
	}
	if _, err := hex.DecodeString(baseCommit); err != nil {
		return FingerprintManifest{}, "", Failure("INVALID_ARGUMENT", "/baseCommit", "invalid commit")
	}
	scope.Include = append([]string{}, scope.Include...)
	scope.Exclude = append([]string{}, scope.Exclude...)
	scope.MissingInputs = append([]string{}, scope.MissingInputs...)
	out := FingerprintManifest{EncodingVersion: EncodingVersion, RepositoryID: repositoryID, BaseCommit: baseCommit, Scope: scope, Complete: len(scope.MissingInputs) == 0, Files: []FingerprintFile{}}
	if len(scope.Include) == 0 {
		return out, "", Failure("INVALID_ARGUMENT", "/scope/include", "explicit fingerprint scope required")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return out, "", err
	}
	defer root.Close()
	cmd := exec.Command("git", "ls-tree", "-rz", "--full-tree", baseCommit)
	cmd.Dir = dir
	raw, err := cmd.Output()
	if err != nil {
		return out, "", Failure("INVALID_ARGUMENT", "/baseCommit", "cannot read baseline tree")
	}
	baseline := map[string]string{}
	modes := map[string]string{}
	for _, line := range bytes.Split(raw, []byte{0}) {
		if len(line) == 0 {
			continue
		}
		parts := bytes.SplitN(line, []byte{'\t'}, 2)
		if len(parts) != 2 {
			return out, "", fmt.Errorf("invalid git tree output")
		}
		metadata := strings.Fields(string(parts[0]))
		if len(metadata) != 3 {
			return out, "", fmt.Errorf("invalid git tree metadata")
		}
		name := string(parts[1])
		baseline[name] = metadata[2]
		modes[name] = metadata[0]
	}
	indexed := map[string]bool{}
	indexCmd := exec.Command("git", "ls-files", "-z")
	indexCmd.Dir = dir
	indexRaw, err := indexCmd.Output()
	if err != nil {
		return out, "", err
	}
	for _, name := range bytes.Split(indexRaw, []byte{0}) {
		if len(name) > 0 {
			indexed[string(name)] = true
		}
	}
	names := map[string]bool{}
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == ".git" || strings.HasPrefix(name, ".git/") {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if excluded(name, scope.Exclude) {
				return fs.SkipDir
			}
			return nil
		}
		if selected(name, scope.Include) && !excluded(name, scope.Exclude) {
			names[name] = true
		}
		return nil
	})
	if err != nil {
		return out, "", err
	}
	for name := range baseline {
		if selected(name, scope.Include) && !excluded(name, scope.Exclude) {
			names[name] = true
		}
	}
	folded := map[string]string{}
	for name := range names {
		fold := FoldPath(name)
		if previous, exists := folded[fold]; exists && previous != name {
			return out, "", Failure("PATH_INVALID", "/files", "case-folded source path collision")
		}
		folded[fold] = name
	}
	ordered := make([]string, 0, len(names))
	for name := range names {
		ordered = append(ordered, name)
	}
	sort.Strings(ordered)
	for _, name := range ordered {
		if err := ValidatePath(name, false); err != nil {
			return out, "", err
		}
		if secretPath(name) {
			out.Complete = false
			out.Scope.MissingInputs = append(out.Scope.MissingInputs, name)
			continue
		}
		stat, err := root.Lstat(name)
		if os.IsNotExist(err) {
			out.Files = append(out.Files, FingerprintFile{Path: name, Status: "deleted"})
			continue
		}
		if err != nil {
			return out, "", err
		}
		if !stat.Mode().IsRegular() {
			out.Complete = false
			out.Scope.MissingInputs = append(out.Scope.MissingInputs, name)
			continue
		}
		f, err := root.Open(name)
		if err != nil {
			return out, "", err
		}
		_, sha, err := HashFile(f, stat.Size())
		f.Close()
		if err != nil {
			return out, "", err
		}
		mode := "100644"
		if stat.Mode()&0111 != 0 {
			mode = "100755"
		}
		status := "untracked"
		if indexed[name] {
			status = "added"
		}
		if _, ok := baseline[name]; ok {
			// Git hash-object computes the repository's object-format digest; it does not write an object.
			cmd := exec.Command("git", "hash-object", "--no-filters", "--", name)
			cmd.Dir = dir
			objectID, err := cmd.Output()
			if err != nil {
				return out, "", err
			}
			status = "modified"
			if strings.TrimSpace(string(objectID)) == baseline[name] && mode == modes[name] {
				status = "unchanged"
			}
		}
		out.Files = append(out.Files, FingerprintFile{Path: name, Status: status, Mode: &mode, SHA256: &sha})
	}
	for _, entry := range out.Files {
		if entry.Status == "deleted" {
			if _, err := root.Lstat(entry.Path); !os.IsNotExist(err) {
				return out, "", Failure("REFERENCE_INVALID", "/files", "source changed during fingerprint collection")
			}
			continue
		}
		stat, err := root.Lstat(entry.Path)
		if err != nil || !stat.Mode().IsRegular() {
			return out, "", Failure("REFERENCE_INVALID", "/files", "source changed during fingerprint collection")
		}
		f, err := root.Open(entry.Path)
		if err != nil {
			return out, "", Failure("REFERENCE_INVALID", "/files", "source changed during fingerprint collection")
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			return out, "", err
		}
		_, sha, err := HashFile(f, info.Size())
		f.Close()
		mode := "100644"
		if info.Mode()&0111 != 0 {
			mode = "100755"
		}
		if err != nil || entry.SHA256 == nil || sha != *entry.SHA256 || entry.Mode == nil || mode != *entry.Mode {
			return out, "", Failure("REFERENCE_INVALID", "/files", "source changed during fingerprint collection")
		}
	}
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == ".git" || strings.HasPrefix(name, ".git/") {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if excluded(name, scope.Exclude) {
				return fs.SkipDir
			}
			return nil
		}
		if selected(name, scope.Include) && !excluded(name, scope.Exclude) && !names[name] {
			return Failure("REFERENCE_INVALID", "/files", "new source input appeared during fingerprint collection")
		}
		return nil
	})
	if err != nil {
		return out, "", err
	}
	// Excluded paths are caller-declared omissions; their effect on the build cannot be inferred.
	if len(scope.Exclude) > 0 {
		out.Complete = false
		out.Scope.MissingInputs = append(out.Scope.MissingInputs, scope.Exclude...)
	}
	sort.Strings(out.Scope.MissingInputs)
	raw, err = Canonical(out)
	if err != nil {
		return out, "", err
	}
	return out, Digest(raw), nil
}
func selected(name string, patterns []string) bool {
	for _, pattern := range patterns {
		if pattern == "**" || pattern == "." {
			return true
		}
		prefix := strings.TrimSuffix(pattern, "/**")
		if !strings.ContainsAny(prefix, "*?[") && (name == prefix || strings.HasPrefix(name, prefix+"/")) {
			return true
		}
		if matchScope(pattern, name) {
			return true
		}
	}
	return false
}
func excluded(name string, patterns []string) bool { return selected(name, patterns) }
func secretPath(name string) bool {
	base := strings.ToLower(filepath.Base(name))
	return strings.HasPrefix(base, ".env") || strings.HasSuffix(base, ".pem") || strings.HasSuffix(base, ".key") || base == "id_rsa" || base == "id_ed25519" || base == "credentials" || base == "postgres-password" || strings.HasPrefix(name, "secrets/")
}

func matchScope(pattern, name string) bool {
	patterns, parts := strings.Split(pattern, "/"), strings.Split(name, "/")
	visited := map[[2]int]bool{}
	matches := map[[2]int]bool{}
	var match func(int, int) bool
	match = func(p, n int) bool {
		key := [2]int{p, n}
		if visited[key] {
			return matches[key]
		}
		visited[key] = true
		result := false
		if p == len(patterns) {
			result = n == len(parts)
		} else if patterns[p] == "**" {
			result = match(p+1, n) || (n < len(parts) && match(p, n+1))
		} else if n < len(parts) {
			ok, _ := path.Match(patterns[p], parts[n])
			result = ok && match(p+1, n+1)
		}
		matches[key] = result
		return result
	}
	return match(0, 0)
}
