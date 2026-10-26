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

	"github.com/Chulan-824/acceptances/internal/api"
)

type binding struct {
	URL          string `json:"url"`
	WebURL       string `json:"webUrl,omitempty"`
	ProjectID    string `json:"projectId"`
	RepositoryID string `json:"repositoryId"`
	Source       string `json:"source"`
}
type client struct{ base, web, token string }

func Run(args []string, out, log io.Writer) int {
	if len(args) > 0 && args[0] == "lark" {
		return larkCommand(args[1:], out, log)
	}
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
			"login --username <name> --password-stdin [--url <server>]", "whoami [--url <server>]", "logout [--url <server>]",
			"lark connect --url <server> [--name <computer>]",
			"projects [--url http://127.0.0.1:8765]", "link --project <name-or-id> [--repo .] [--url ...] [--web-url ...]",
			"context [--repo .]", "campaigns [--title <new-title>] [--description ...] [--repo .]",
			"validate --bundle <directory> [--formal] [--project <id>] [--campaign <id>]", "publish --bundle <directory> --campaign <title-or-id> [--formal] [--repo .]", "status --run <id> [--repo .]", "move-run --run <id> --from-campaign <id> --campaign <target-title-or-id> --reason <text> --request-id <id> [--repo .]", "feedback --campaign <title-or-id> [--repo .]",
		}, "bundle": "report.json and declared evidence files; .submission-id retained for retries; use a new directory for each actual verification"}, nil
	}
	if args[0] == "version" {
		return map[string]string{"version": "local-archive-v1"}, nil
	}
	f := flag.NewFlagSet(args[0], flag.ContinueOnError)
	f.SetOutput(log)
	endpoint := f.String("url", "", "API URL (default saved association or http://127.0.0.1:8765)")
	webEndpoint := f.String("web-url", "", "Web URL for human review (default saved association or API URL)")
	username := f.String("username", "", "account username")
	passwordStdin := f.Bool("password-stdin", false, "read login password from stdin")
	repo := f.String("repo", ".", "business directory")
	project := f.String("project", "", "project name or ID")
	campaign := f.String("campaign", "", "campaign title or ID")
	title := f.String("title", "", "create campaign with this title")
	description := f.String("description", "", "campaign description")
	bundle := f.String("bundle", "", "directory containing report.json and evidence")
	formal := f.Bool("formal", false, "require complete formal-delivery materials before publishing")
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
	if args[0] == "login" || args[0] == "logout" || args[0] == "whoami" {
		return authCommand(args[0], *endpoint, *username, *passwordStdin, os.Stdin)
	}
	if args[0] == "validate" {
		if *bundle == "" {
			return nil, fmt.Errorf("--bundle is required")
		}
		report, err := api.ValidateBundle(*bundle, *project, *campaign, *formal)
		if err != nil {
			return nil, fmt.Errorf("bundle preflight: %w", err)
		}
		return map[string]any{"valid": true, "scopeType": report.ScopeType, "checks": len(report.Checks), "evidence": len(report.Evidence), "screenshotFormat": "JPEG"}, nil
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
	base = strings.TrimRight(base, "/")
	web := *webEndpoint
	if web == "" && base == strings.TrimRight(saved.URL, "/") {
		web = saved.WebURL
	}
	if web == "" {
		web = base
	}
	for _, endpoint := range []struct{ name, value string }{{"service", base}, {"Web", web}} {
		parsed, err := url.Parse(endpoint.value)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return nil, fmt.Errorf("invalid %s URL", endpoint.name)
		}
	}
	c := client{base: base, web: strings.TrimRight(web, "/")}
	if err := c.loadSession(); err != nil {
		return nil, err
	}
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
		saved = binding{URL: c.base, WebURL: c.web, ProjectID: id, RepositoryID: linked.ID, Source: source}
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
		return c.status(*runID)
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
		if _, err := api.ValidateBundle(*bundle, saved.ProjectID, id, *formal); err != nil {
			return nil, fmt.Errorf("bundle preflight: %w", err)
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
			run["webUrl"] = c.runURL(saved.ProjectID, id, runID)
		}
		return run, nil
	default:
		return nil, fmt.Errorf("unknown command %q; run help", args[0])
	}
}

func (c client) runURL(projectID, campaignID, runID string) string {
	return c.web + "/projects/" + url.PathEscape(projectID) + "/campaigns/" + url.PathEscape(campaignID) + "/runs/" + url.PathEscape(runID)
}

func (c client) status(runID string) (any, error) {
	raw, err := c.request("GET", "/runs/"+url.PathEscape(runID), nil, "")
	if err != nil {
		return nil, err
	}
	var run map[string]any
	if err := json.Unmarshal(raw, &run); err != nil {
		return nil, err
	}
	campaignID, _ := run["campaignId"].(string)
	raw, err = c.request("GET", "/campaigns/"+url.PathEscape(campaignID), nil, "")
	if err != nil {
		return nil, err
	}
	var campaign struct {
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(raw, &campaign); err != nil {
		return nil, err
	}
	if campaignID == "" || campaign.ProjectID == "" {
		return nil, fmt.Errorf("Run or Campaign response is missing ownership")
	}
	run["webUrl"] = c.runURL(campaign.ProjectID, campaignID, runID)
	return run, nil
}

func (c client) request(method, path string, body io.Reader, contentType string) (json.RawMessage, error) {
	req, err := http.NewRequest(method, c.base+"/api/v1"+path, body)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
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
	if res.StatusCode == http.StatusUnauthorized {
		if path == "/auth/login" {
			return nil, fmt.Errorf("用户名或密码不正确")
		}
		return nil, fmt.Errorf("登录已失效或尚未登录；请运行 acceptances login --url %s --username <账号> --password-stdin", c.base)
	}
	if res.StatusCode == http.StatusNoContent {
		return nil, nil
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
func bindingPath(source string) (string, error) { return configPath("links", source) }
func configPath(kind, key string) (string, error) {
	root := os.Getenv("ACCEPTANCES_CONFIG_DIR")
	if root == "" {
		var err error
		root, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
		root = filepath.Join(root, "acceptances")
	}
	return filepath.Join(root, kind, fmt.Sprintf("%x.json", sha256.Sum256([]byte(key)))), nil
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
