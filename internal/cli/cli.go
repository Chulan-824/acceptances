// Package cli provides the host-side client for the local report archive.
package cli

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type binding struct {
	URL          string `json:"url"`
	ProjectID    string `json:"projectId"`
	RepositoryID string `json:"repositoryId"`
	Source       string `json:"source"`
}
type client struct{ base string }

func Run(args []string, out, log io.Writer) int {
	result, err := run(args, log)
	if err != nil {
		json.NewEncoder(log).Encode(map[string]string{"error": err.Error()})
		return 1
	}
	if result != nil {
		encoder := json.NewEncoder(out)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(result); err != nil {
			fmt.Fprintln(log, err)
			return 1
		}
	}
	return 0
}

func run(args []string, log io.Writer) (any, error) {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		return map[string]any{"commands": []string{
			"projects [--url http://127.0.0.1:8765]", "link --project <name-or-id> [--repo .] [--url ...]",
			"context [--repo .]", "campaigns [--title <new-title>] [--description ...] [--repo .]",
			"publish --bundle <directory> --campaign <title-or-id> [--repo .]", "status --run <id> [--repo .]", "move-run --run <id> --from-campaign <id> --campaign <target-title-or-id> --reason <text> --request-id <id> [--repo .]", "feedback --campaign <title-or-id> [--repo .]",
		}, "bundle": "report.json and declared evidence files; .submission-id retained for retries; use a new directory for each actual verification"}, nil
	}
	if args[0] == "version" {
		return map[string]string{"version": "local-archive-v1"}, nil
	}
	f := flag.NewFlagSet(args[0], flag.ContinueOnError)
	f.SetOutput(log)
	endpoint := f.String("url", "", "service URL (default saved association or http://127.0.0.1:8765)")
	repo := f.String("repo", ".", "business directory")
	project := f.String("project", "", "project name or ID")
	campaign := f.String("campaign", "", "campaign title or ID")
	title := f.String("title", "", "create campaign with this title")
	description := f.String("description", "", "campaign description")
	bundle := f.String("bundle", "", "directory containing report.json and evidence")
	runID := f.String("run", "", "Run ID")
	fromCampaign := f.String("from-campaign", "", "expected current Campaign ID")
	reason := f.String("reason", "", "reason for correcting Run ownership")
	requestID := f.String("request-id", "", "stable move request ID for retries")
	f.Bool("json", true, "JSON output")
	if err := f.Parse(args[1:]); err != nil {
		return nil, err
	}
	if f.NArg() != 0 {
		return nil, fmt.Errorf("unexpected positional arguments")
	}
	source, err := repositorySource(*repo)
	if err != nil {
		return nil, err
	}
	path, err := bindingPath(source)
	if err != nil {
		return nil, err
	}
	var saved binding
	if raw, readErr := os.ReadFile(path); readErr == nil {
		if err := json.Unmarshal(raw, &saved); err != nil {
			return nil, fmt.Errorf("read association: %w", err)
		}
	} else if !os.IsNotExist(readErr) {
		return nil, readErr
	}
	base := *endpoint
	if base == "" {
		base = saved.URL
	}
	if base == "" {
		base = "http://127.0.0.1:8765"
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("invalid service URL")
	}
	c := client{strings.TrimRight(base, "/")}
	if args[0] == "projects" {
		return c.request("GET", "/projects", nil, "")
	}
	if args[0] == "context" {
		return map[string]any{"association": saved, "version": repositoryVersion(*repo, source)}, nil
	}
	if args[0] == "link" {
		id, err := c.selectID("/projects", *project, "name")
		if err != nil {
			return nil, err
		}
		name := filepath.Base(source)
		if name == ".git" {
			name = filepath.Base(filepath.Dir(source))
		}
		payload, _ := json.Marshal(map[string]string{"name": name, "source": source})
		result, err := c.request("POST", "/projects/"+id+"/repositories", bytes.NewReader(payload), "application/json")
		if err != nil {
			return nil, err
		}
		var linked struct {
			ID string `json:"id"`
		}
		if err = json.Unmarshal(result, &linked); err != nil {
			return nil, err
		}
		saved = binding{URL: c.base, ProjectID: id, RepositoryID: linked.ID, Source: source}
		if err := saveJSON(path, saved); err != nil {
			return nil, err
		}
		return saved, nil
	}
	if saved.ProjectID == "" {
		return nil, fmt.Errorf("directory is not linked; run projects, then link --project <name>")
	}
	if c.base != strings.TrimRight(saved.URL, "/") {
		return nil, fmt.Errorf("service URL differs from association; link this directory to the new service first")
	}
	campaigns := "/projects/" + url.PathEscape(saved.ProjectID) + "/campaigns"
	switch args[0] {
	case "campaigns":
		if *title == "" {
			return c.request("GET", campaigns, nil, "")
		}
		payload, _ := json.Marshal(map[string]string{"title": *title, "description": *description})
		return c.request("POST", campaigns, bytes.NewReader(payload), "application/json")
	case "move-run":
		return c.moveRun(campaigns, saved.ProjectID, *runID, *fromCampaign, *campaign, *reason, *requestID)
	case "status":
		if *runID == "" {
			return nil, fmt.Errorf("--run is required")
		}
		return c.request("GET", "/runs/"+url.PathEscape(*runID), nil, "")
	case "feedback", "publish":
		id, err := c.selectID(campaigns, *campaign, "title")
		if err != nil {
			return nil, err
		}
		if args[0] == "feedback" {
			return c.request("GET", "/campaigns/"+id+"/runs", nil, "")
		}
		if *bundle == "" {
			return nil, fmt.Errorf("--bundle is required")
		}
		result, err := c.publish(id, *bundle)
		if err != nil {
			return nil, err
		}
		var run map[string]any
		if err := json.Unmarshal(result, &run); err != nil {
			return nil, err
		}
		if actualCampaign, ok := run["campaignId"].(string); ok && actualCampaign != "" {
			id = actualCampaign
		}
		if runID, ok := run["id"].(string); ok {
			run["webUrl"] = c.base + "/projects/" + url.PathEscape(saved.ProjectID) + "/campaigns/" + id + "/runs/" + url.PathEscape(runID)
		}
		return run, nil
	default:
		return nil, fmt.Errorf("unknown command %q; run help", args[0])
	}
}

func (c client) request(method, path string, body io.Reader, contentType string) (json.RawMessage, error) {
	req, err := http.NewRequest(method, c.base+"/api/v1"+path, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	h := http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := h.Do(req)
	if err != nil {
		return nil, fmt.Errorf("service request: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("service returned invalid JSON")
	}
	return raw, nil
}

func (c client) selectID(path, selector, key string) (string, error) {
	if selector == "" {
		return "", fmt.Errorf("%s or ID is required", key)
	}
	raw, err := c.request("GET", path, nil, "")
	if err != nil {
		return "", err
	}
	var list struct {
		Items []map[string]any `json:"items"`
	}
	if err = json.Unmarshal(raw, &list); err != nil {
		return "", err
	}
	var matches []string
	for _, item := range list.Items {
		if id, ok := item["id"].(string); ok {
			if id == selector {
				return url.PathEscape(id), nil
			}
			if item[key] == selector {
				matches = append(matches, id)
			}
		}
	}
	if len(matches) != 1 {
		return "", fmt.Errorf("%s %q matched %d records; list and select a unique ID", key, selector, len(matches))
	}
	return url.PathEscape(matches[0]), nil
}

func repositorySource(repo string) (string, error) {
	absolute, err := filepath.Abs(repo)
	if err != nil {
		return "", err
	}
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	if info, err := os.Stat(absolute); err != nil || !info.IsDir() {
		return "", fmt.Errorf("repository path must be a directory")
	}
	result, err := exec.Command("git", "-C", absolute, "rev-parse", "--path-format=absolute", "--git-common-dir").Output()
	if err == nil {
		return filepath.EvalSymlinks(strings.TrimSpace(string(result)))
	}
	return absolute, nil
}
func repositoryVersion(repo, source string) map[string]any {
	v := map[string]any{"repository": source, "commit": "unknown", "dirty": nil}
	if raw, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output(); err == nil {
		v["commit"] = strings.TrimSpace(string(raw))
	}
	if raw, err := exec.Command("git", "-C", repo, "status", "--porcelain").Output(); err == nil {
		v["dirty"] = len(raw) > 0
	}
	return v
}
func bindingPath(source string) (string, error) {
	root := os.Getenv("ACCEPTANCES_CONFIG_DIR")
	if root == "" {
		var err error
		root, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
		root = filepath.Join(root, "acceptances")
	}
	return filepath.Join(root, "links", fmt.Sprintf("%x.json", sha256.Sum256([]byte(source)))), nil
}
func saveJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".association-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err = temp.Write(append(raw, '\n')); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), path)
}

func (c client) publish(campaign, directory string) (json.RawMessage, error) {
	raw, err := os.ReadFile(filepath.Join(directory, "report.json"))
	if err != nil {
		return nil, err
	}
	var report struct {
		Evidence []struct {
			Path string `json:"path"`
		} `json:"evidence"`
	}
	if err = json.Unmarshal(raw, &report); err != nil {
		return nil, fmt.Errorf("report.json: %w", err)
	}
	idPath := filepath.Join(directory, ".submission-id")
	id, err := os.ReadFile(idPath)
	if os.IsNotExist(err) {
		generated := make([]byte, 16)
		if _, err = rand.Read(generated); err != nil {
			return nil, err
		}
		generated[6] = (generated[6] & 0x0f) | 0x40
		generated[8] = (generated[8] & 0x3f) | 0x80
		id = []byte(fmt.Sprintf("%x-%x-%x-%x-%x", generated[:4], generated[4:6], generated[6:8], generated[8:10], generated[10:]))
		f, createErr := os.OpenFile(idPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if os.IsExist(createErr) {
			id, err = os.ReadFile(idPath)
		} else if createErr != nil {
			return nil, createErr
		} else {
			_, err = f.Write(id)
			closeErr := f.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(id)) == "" {
		return nil, fmt.Errorf("empty .submission-id; preserve a valid submission ID for retries")
	}
	// Spool the complete request to disk so large videos don't occupy memory.
	temp, err := os.CreateTemp("", "acceptances-upload-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	w := multipart.NewWriter(temp)
	if err = w.WriteField("report", string(raw)); err != nil {
		return nil, err
	}
	if err = w.WriteField("submissionId", strings.TrimSpace(string(id))); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, e := range report.Evidence {
		if e.Path == "" || e.Path == "." || e.Path == ".." || strings.ContainsAny(e.Path, "/\\") || seen[e.Path] {
			return nil, fmt.Errorf("invalid or duplicate evidence filename %q", e.Path)
		}
		seen[e.Path] = true
		evidencePath := filepath.Join(directory, e.Path)
		info, err := os.Lstat(evidencePath)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("evidence %q must be a regular file", e.Path)
		}
		file, err := os.Open(evidencePath)
		if err != nil {
			return nil, err
		}
		part, err := w.CreateFormFile("evidence", e.Path)
		if err != nil {
			file.Close()
			return nil, err
		}
		_, err = io.Copy(part, file)
		file.Close()
		if err != nil {
			return nil, err
		}
	}
	if err = w.Close(); err != nil {
		return nil, err
	}
	size, err := temp.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil, err
	}
	if size > 256<<20 {
		return nil, fmt.Errorf("complete upload exceeds 256 MiB")
	}
	if _, err = temp.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return c.request("POST", "/campaigns/"+campaign+"/runs", temp, w.FormDataContentType())
}
