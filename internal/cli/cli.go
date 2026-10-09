package cli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/buildinfo"
	"github.com/Chulan-824/acceptances/internal/config"
	"github.com/Chulan-824/acceptances/internal/protocol"
)

type Client struct {
	URL, Token string
	HTTP       *http.Client
}
type response struct {
	Data  json.RawMessage `json:"data"`
	Error *protocol.Error `json:"error"`
}

func Run(args []string, out, log io.Writer) int {
	machine := false
	for _, arg := range args {
		if arg == "--json" || arg == "--json=true" {
			machine = true
		}
	}
	result, err := run(args, log)
	if err != nil {
		var p *protocol.Error
		if !errors.As(err, &p) {
			p = protocol.Failure("INTERNAL_ERROR", "", "operation failed")
		}
		if machine {
			if result != nil {
				json.NewEncoder(out).Encode(map[string]any{"data": result, "error": p})
			} else {
				json.NewEncoder(out).Encode(map[string]any{"error": p})
			}
		} else {
			fmt.Fprintf(log, "%s: %s\n", p.Code, p.Message)
			if result != nil {
				human(out, result)
			}
		}
		return p.ExitCode()
	}
	if result != nil {
		if machine {
			json.NewEncoder(out).Encode(result)
		} else {
			human(out, result)
		}
	}
	return 0
}
func human(out io.Writer, value any) {
	if m, ok := value.(map[string]any); ok {
		if commands, ok := m["commands"].([]string); ok {
			fmt.Fprintln(out, "Acceptances V1")
			for _, command := range commands {
				fmt.Fprintln(out, "  acceptances "+command)
			}
			return
		}
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err == nil {
		fmt.Fprintln(out, "Acceptances result:")
		fmt.Fprintln(out, string(raw))
	}
}
func run(args []string, log io.Writer) (any, error) {
	if len(args) > 0 && args[0] == "fingerprint" {
		return fingerprint(args[1:], log)
	}
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		return map[string]any{"commands": []string{"version [--json]", "fingerprint --repo <path> --repository <id> --base <commit> --scope <json-file> [--json]", "validate <bundle> [--json]", "publish <bundle> [--wait 120s] [--json]", "status --project <id> --run <id> --revision <id> [--json]", "feedback --project <id> --campaign <id> [--cursor <value>] [--json]", "check --project <id> --campaign <id> --mode ready|accepted [--allow-risk] [--json]"}}, nil
	}
	if args[0] == "version" {
		if len(args) > 2 || len(args) == 2 && args[1] != "--json" {
			return nil, protocol.Failure("INVALID_ARGUMENT", "", "invalid version arguments")
		}
		return buildinfo.Current(), nil
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(log)
	project := flags.String("project", "", "project UUID")
	runID := flags.String("run", "", "Run UUID")
	revision := flags.String("revision", "", "revision UUID")
	campaign := flags.String("campaign", "", "Campaign UUID")
	cursor := flags.String("cursor", "", "feedback cursor")
	mode := flags.String("mode", "ready", "ready or accepted")
	allowRisk := flags.Bool("allow-risk", false, "allow explicit human risk acceptance")
	wait := flags.Duration("wait", 120*time.Second, "publication wait deadline")
	flags.Bool("json", false, "JSON output")
	positional := ""
	remaining := args[1:]
	if (args[0] == "validate" || args[0] == "publish") && len(remaining) > 0 && !strings.HasPrefix(remaining[0], "-") {
		positional = remaining[0]
		remaining = remaining[1:]
	}
	if err := flags.Parse(remaining); err != nil {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "invalid command arguments")
	}
	if flags.NArg() > 0 {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "unexpected positional arguments")
	}
	if args[0] == "validate" || args[0] == "publish" {
		if positional == "" {
			return nil, protocol.Failure("INVALID_ARGUMENT", "", "bundle path required")
		}
		bundle, err := protocol.LoadBundle(positional)
		if err != nil {
			return nil, err
		}
		if args[0] == "validate" {
			return map[string]any{"valid": true, "projectId": bundle.Report.ProjectID, "runId": bundle.Manifest.RunID, "revisionId": bundle.Report.ID, "requiresServerChecks": bundle.RequiresServerChecks}, nil
		}
		if *wait < 0 {
			return nil, protocol.Failure("INVALID_ARGUMENT", "", "wait must be nonnegative")
		}
		client, err := connect()
		if err != nil {
			return nil, err
		}
		return client.publish(context.Background(), positional, bundle, *wait, log)
	}
	if args[0] != "status" && args[0] != "feedback" && args[0] != "check" {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "unknown command")
	}
	if !protocol.ValidID(*project) {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "project UUID required")
	}
	client, err := connect()
	if err != nil {
		return nil, err
	}
	path := "/api/v1/projects/" + *project
	switch args[0] {
	case "status":
		if !protocol.ValidID(*runID) || !protocol.ValidID(*revision) {
			return nil, protocol.Failure("INVALID_ARGUMENT", "", "Run and revision UUIDs required")
		}
		path += "/runs/" + *runID + "/revisions/" + *revision
	case "feedback", "check":
		if !protocol.ValidID(*campaign) {
			return nil, protocol.Failure("INVALID_ARGUMENT", "", "Campaign UUID required")
		}
		path += "/campaigns/" + *campaign
		if args[0] == "feedback" {
			path += "/reviews"
			if *cursor != "" {
				path += "?cursor=" + url.QueryEscape(*cursor)
			}
		} else {
			if *mode != "ready" && *mode != "accepted" || *mode == "ready" && *allowRisk {
				return nil, protocol.Failure("INVALID_ARGUMENT", "", "invalid gate mode")
			}
			path += "/gate?mode=" + *mode + "&allowRisk=" + fmt.Sprint(*allowRisk)
		}
	default:
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "unknown command")
	}
	data, _, err := client.request(context.Background(), "GET", path, nil, nil)
	if err != nil {
		return nil, err
	}
	if args[0] == "check" {
		var gate struct {
			Satisfied bool `json:"satisfied"`
		}
		if json.Unmarshal(data, &gate) != nil {
			return nil, protocol.Failure("INTERNAL_ERROR", "", "invalid gate response")
		}
		if !gate.Satisfied {
			return map[string]any{"gate": json.RawMessage(data)}, protocol.Failure("GATE_UNSATISFIED", "", "selected gate not satisfied")
		}
	}
	return json.RawMessage(data), nil
}
func connect() (*Client, error) {
	base := os.Getenv("ACCEPTANCES_URL")
	if base == "" {
		base = "http://127.0.0.1:8765"
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || u.Path != "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "ACCEPTANCES_URL must be a loopback HTTP origin")
	}
	token, err := config.Secret("ACCEPTANCES_TOKEN")
	if err != nil {
		return nil, protocol.Failure("INVALID_ARGUMENT", "", "token input configuration invalid")
	}
	if token == "" {
		return nil, protocol.Failure("AUTH_REQUIRED", "", "ACCEPTANCES_TOKEN_FILE or ACCEPTANCES_TOKEN required")
	}
	return &Client{URL: strings.TrimRight(base, "/"), Token: token, HTTP: &http.Client{Timeout: 30 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) request(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (json.RawMessage, http.Header, error) {
	timeout := 30 * time.Second
	if method == "PUT" && headers["Content-Type"] == "application/octet-stream" {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, c.URL+path, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, protocol.Failure("STORAGE_UNAVAILABLE", "", "request failed; query persistent status before retry")
	}
	defer resp.Body.Close()
	var envelope response
	// A raw document embedded in JSON can expand sixfold through escaping.
	if err = json.NewDecoder(io.LimitReader(resp.Body, protocol.DocumentLimit*6+(1<<20))).Decode(&envelope); err != nil {
		return nil, resp.Header, protocol.Failure("INTERNAL_ERROR", "", "invalid API response")
	}
	if resp.StatusCode >= 400 {
		if envelope.Error != nil {
			return nil, resp.Header, envelope.Error
		}
		return nil, resp.Header, protocol.Failure("INTERNAL_ERROR", "", "API rejected request")
	}
	return envelope.Data, resp.Header, nil
}
func body(value any) io.Reader { raw, _ := json.Marshal(value); return bytes.NewReader(raw) }
func (c *Client) publish(ctx context.Context, dir string, b *protocol.Bundle, wait time.Duration, log io.Writer) (any, error) {
	capReq, err := http.NewRequestWithContext(ctx, "GET", c.URL+"/api/v1/capabilities", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(capReq)
	if err != nil {
		return nil, protocol.Failure("STORAGE_UNAVAILABLE", "", "capability query unavailable")
	}
	var cap struct {
		SchemaVersions []string `json:"schemaVersions"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&cap)
	resp.Body.Close()
	if err != nil {
		return nil, protocol.Failure("INTERNAL_ERROR", "", "capabilities invalid")
	}
	supported := false
	for _, v := range cap.SchemaVersions {
		if v == protocol.SchemaVersion {
			supported = true
		}
	}
	if !supported {
		return nil, protocol.Failure("UNSUPPORTED_VERSION", "", "service does not support V1 publication")
	}
	project := b.Report.ProjectID
	campaign, _ := b.Report.Value["campaignId"].(string)
	base := "/api/v1/projects/" + project
	campaignPath := base + "/campaigns/" + campaign
	if _, _, err = c.request(ctx, "GET", campaignPath, nil, nil); err != nil {
		return nil, err
	}
	for _, kind := range []string{"definitions", "target", "plan"} {
		for _, ref := range b.Manifest.Documents {
			if ref.Kind != kind {
				continue
			}
			doc, ok := b.Documents[ref.ID]
			if !ok {
				continue
			}
			path := base + "/definitions/" + doc.ID
			if kind != "definitions" {
				path = campaignPath + "/" + kind + "s/" + doc.ID
			}
			if _, _, err = c.request(ctx, "PUT", path, bytes.NewReader(doc.Raw), nil); err != nil {
				return nil, err
			}
		}
	}
	plan := b.Report.Value["planRef"].(map[string]any)
	target := b.Report.Value["targetRef"].(map[string]any)
	runPath := base + "/runs/" + b.Manifest.RunID
	if _, _, err = c.request(ctx, "POST", base+"/runs", body(map[string]any{"id": b.Manifest.RunID, "campaignId": campaign, "planId": plan["id"], "targetId": target["id"], "producer": b.Report.Value["producer"]}), map[string]string{"Idempotency-Key": b.Manifest.RunID}); err != nil {
		return nil, err
	}
	input := protocol.RevisionInput{ID: b.Report.ID, ReportBase64: base64.StdEncoding.EncodeToString(b.Report.Raw), ManifestBase64: base64.StdEncoding.EncodeToString(b.ManifestRaw)}
	data, _, err := c.request(ctx, "POST", runPath+"/revisions", body(input), map[string]string{"Idempotency-Key": b.Report.ID})
	if err != nil {
		return nil, err
	}
	revisionPath := runPath + "/revisions/" + b.Report.ID
	var status struct {
		Phase         string   `json:"phase"`
		Generation    string   `json:"generation"`
		MissingAssets []string `json:"missingAssets"`
		SealDigest    string   `json:"sealDigest"`
		FailureCode   string   `json:"failureCode"`
	}
	if err = json.Unmarshal(data, &status); err != nil {
		return nil, err
	}
	if status.Phase == "sealed" {
		return json.RawMessage(data), nil
	}
	if status.Phase == "failed" || status.Phase == "expired" {
		_, headers, err := c.request(ctx, "GET", revisionPath, nil, nil)
		if err != nil {
			return nil, err
		}
		data, _, err = c.request(ctx, "POST", revisionPath+"/resume", body(map[string]any{}), map[string]string{"If-Match": headers.Get("ETag"), "Idempotency-Key": b.Report.ID + "-resume"})
		if err != nil {
			return nil, err
		}
		data, _, err = c.request(ctx, "GET", revisionPath, nil, nil)
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &status); err != nil {
			return nil, err
		}
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	missing := map[string]bool{}
	for _, id := range status.MissingAssets {
		missing[id] = true
	}
	for _, a := range b.Manifest.Assets {
		if !missing[a.ID] {
			continue
		}
		f, err := root.Open(a.Path)
		if err != nil {
			return nil, err
		}
		_, _, err = c.request(ctx, "PUT", revisionPath+"/assets/"+a.ID+"/content", f, map[string]string{"Content-Type": "application/octet-stream", "X-Upload-Generation": status.Generation})
		f.Close()
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(log, "uploaded asset %s\n", a.ID)
	}
	data, _, err = c.request(ctx, "POST", revisionPath+"/finalize", body(map[string]any{"generation": status.Generation}), map[string]string{"Idempotency-Key": b.Report.ID + "-finalize"})
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(wait)
	for {
		data, _, err = c.request(ctx, "GET", revisionPath, nil, nil)
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &status); err != nil {
			return nil, err
		}
		if status.Phase == "sealed" {
			return json.RawMessage(data), nil
		}
		if status.Phase == "failed" {
			code := status.FailureCode
			if code == "" {
				code = "INTERNAL_ERROR"
			}
			return json.RawMessage(data), protocol.Failure(code, "", "publication failed; query status before resume")
		}
		if !time.Now().Before(deadline) {
			return json.RawMessage(data), protocol.Failure("WAIT_TIMEOUT", "", "publication status unknown; retain original Run and revision IDs")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
