package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/prd"
)

// These tests start the instrumented test binary as the CLI and again for each
// Lark call. Their deadline is a failure bound, not a product polling interval.
const larkProcessTimeout = 90 * time.Second

// This subprocess is the public acceptances entry point. Lark itself is a
// separate controlled executable on PATH, never a patched Go function.
func TestLarkProcess(t *testing.T) {
	if os.Getenv("ACCEPTANCES_LARK_PROCESS") != "1" {
		return
	}
	for index, arg := range os.Args {
		if arg == "--" {
			os.Exit(Run(os.Args[index+1:], os.Stdout, os.Stderr))
		}
	}
	os.Exit(2)
}

func TestLarkFixture(t *testing.T) {
	if os.Getenv("ACCEPTANCES_LARK_FIXTURE") != "1" {
		return
	}
	var args []string
	for index, arg := range os.Args {
		if arg == "--" {
			args = os.Args[index+1:]
			break
		}
	}
	f, _ := os.OpenFile(os.Getenv("LARK_FIXTURE_CALLS"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	json.NewEncoder(f).Encode(args)
	f.Close()
	joined := strings.Join(args, " ")
	scenario := os.Getenv("LARK_FIXTURE_SCENARIO")
	calls, _ := os.ReadFile(os.Getenv("LARK_FIXTURE_CALLS"))
	callCount := func(fragment string) int {
		count := 0
		for _, line := range strings.Split(string(calls), "\n") {
			if strings.Contains(line, fragment) {
				count++
			}
		}
		return count
	}
	switch {
	case joined == "--version":
		fmt.Print("lark-cli version 1.0.98\n")
	case joined == "profile list":
		fmt.Print(`[{"name":"personal","brand":"feishu","effective":true,"active":true}]`)
	case strings.Contains(joined, "auth status"):
		identity := "ou_fixture"
		if scenario == "identity_changed" && callCount(`"auth","status"`) > 2 {
			identity = "ou_other"
		}
		fmt.Printf(`{"appId":"cli_fixture","brand":"feishu","identity":"user","identities":{"user":{"openId":%q,"verified":true,"available":true}}}`, identity)
	case strings.Contains(joined, "wiki +node-get"):
		kind := "docx"
		if scenario == "wiki_sheet" {
			kind = "sheet"
		}
		fmt.Printf(`{"ok":true,"identity":"user","data":{"obj_type":%q,"obj_token":"DocToken123"}}`, kind)
	case strings.Contains(joined, "docs +fetch"):
		content := `<title>PRD fixture</title><p comment-id="private">Requirement</p>`
		references := map[string]any{"comments": map[string]any{"c1": map[string]string{"data": "private comment"}}}
		revision := 1
		if scenario == "version_changed" {
			revision = callCount(`"--doc-format","xml"`)
		}
		if scenario == "rate_limit" && callCount(`"docs","+fetch"`) <= 2 {
			fmt.Fprint(os.Stderr, `{"ok":false,"error":{"type":"rate_limit","code":99991400,"retry_after_seconds":1,"message":"secret-upstream-error","hint":"secret-auth-url"}}`)
			os.Exit(1)
		}
		if scenario == "permission" {
			fmt.Fprint(os.Stderr, `{"ok":false,"identity":"user","error":{"type":"authorization","subtype":"permission_denied","code":131006,"message":"secret-upstream-error","hint":"secret-auth-url"}}`)
			os.Exit(1)
		}
		if scenario == "malformed" {
			fmt.Print(`{"ok":true,"identity":"user","data":{"document":{"document_id":"DocToken123"}}}`)
			os.Exit(0)
		}
		if scenario == "resources" || scenario == "slow_media" {
			content += `<img ref="image-1"/><whiteboard token="WhiteboardToken123"/><img ref="external"/><sheet token="SheetToken123" id="sheet-block"/>`
			references["images"] = map[string]any{"image-1": map[string]string{"token": "ImageToken123", "url": "https://example.com/image?signature=secret"}, "external": map[string]string{"url": "http://127.0.0.1:9/private"}}
		}
		if strings.Contains(joined, "--doc-format markdown") {
			content = "# PRD fixture\n\nRequirement\n"
			if scenario == "code" {
				content += "\n```text\n![literal](https://example.com/sample)\n<!-- literal comment example -->\n```\n\n`![inline](https://example.com/example)`\n"
			}
			if scenario == "resources" || scenario == "slow_media" {
				content += "\n![image](ImageToken123)\n![board](WhiteboardToken123)\n![external](http://127.0.0.1:9/private)\n"
			}
		}
		json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "identity": "user", "data": map[string]any{"document": map[string]any{"document_id": "DocToken123", "revision_id": revision, "content": content, "reference_map": references}}})
	case strings.Contains(joined, "docs +media-download"):
		var output string
		for index, arg := range args {
			if arg == "--output" && index+1 < len(args) {
				output = args[index+1]
			}
		}
		if output == "" {
			os.Exit(2)
		}
		file, err := os.Create(output + ".png")
		if err != nil {
			os.Exit(2)
		}
		picture := image.NewRGBA(image.Rect(0, 0, 1, 1))
		picture.Set(0, 0, color.White)
		png.Encode(file, picture)
		file.Close()
		if scenario == "slow_media" {
			os.WriteFile(os.Getenv("LARK_FIXTURE_CALLS")+".pid", []byte(fmt.Sprint(os.Getpid())), 0600)
			time.Sleep(time.Minute)
		}
		fmt.Print(`{"ok":true,"identity":"user","data":{"path":"fixture.png"}}`)
	default:
		fmt.Fprint(os.Stderr, `{"ok":false,"error":{"type":"validation","subtype":"invalid_argument","message":"unexpected fixture command"}}`)
		os.Exit(1)
	}
	os.Exit(0)
}

type connectorHarness struct {
	server           *httptest.Server
	uploads          chan prd.Bundle
	failures         chan map[string]any
	renewals         atomic.Int32
	disconnected     atomic.Bool
	cancelBusy       bool
	disconnectUpload bool
	readyAfterUpload bool
	readyStored      atomic.Bool
	readyChecked     chan bool
}

func newConnectorHarness(t *testing.T, source string) *connectorHarness {
	t.Helper()
	h := &connectorHarness{uploads: make(chan prd.Bundle, 1), failures: make(chan map[string]any, 1), readyChecked: make(chan bool, 1)}
	var claimed atomic.Bool
	var uploadAttempts atomic.Int32
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			fmt.Fprint(w, `{"user":{"id":"fixture-user"},"token":"platform-secret","expiresAt":"2099-01-01T00:00:00Z"}`)
		case "/api/v1/auth/me":
			fmt.Fprint(w, `{"id":"fixture-user"}`)
		case "/api/v1/lark-connectors":
			fmt.Fprint(w, `{"connector":{"id":"connector-1","protocolVersion":1},"connectorToken":"connector-secret"}`)
		case "/api/v1/lark-connectors/connector-1":
			h.disconnected.Store(true)
			w.WriteHeader(204)
		case "/api/v1/lark-connectors/connector-1/poll":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if body["importId"] != nil {
				h.renewals.Add(1)
				if h.cancelBusy || h.readyAfterUpload && h.readyStored.Load() {
					w.WriteHeader(409)
					return
				}
			} else if !claimed.CompareAndSwap(false, true) {
				w.WriteHeader(204)
				return
			}
			json.NewEncoder(w).Encode(prd.Claim{ImportID: "import-1", CampaignID: "campaign-1", URL: source, Attempt: 1, ClaimToken: "claim-secret", LeaseExpiresAt: time.Now().Add(90 * time.Second).UTC().Format(time.RFC3339)})
		case "/api/v1/prd-imports/import-1/failure":
			var problem map[string]any
			json.NewDecoder(r.Body).Decode(&problem)
			h.failures <- problem
			w.WriteHeader(204)
		case "/api/v1/prd-imports/import-1":
			if h.readyStored.Load() {
				fmt.Fprint(w, `{"id":"import-1","attempt":1,"status":"ready","connectorId":"connector-1"}`)
				h.readyChecked <- true
			} else {
				w.WriteHeader(404)
			}
		case "/api/v1/prd-imports/import-1/result":
			if h.disconnectUpload && uploadAttempts.Add(1) == 1 {
				connection, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					connection.Close()
				}
				return
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			defer r.MultipartForm.RemoveAll()
			var m prd.Manifest
			json.Unmarshal([]byte(r.FormValue("manifest")), &m)
			files := make(map[string][]byte)
			for _, header := range r.MultipartForm.File["file"] {
				file, _ := header.Open()
				var data bytes.Buffer
				data.ReadFrom(file)
				file.Close()
				files[header.Filename] = data.Bytes()
			}
			bundle, err := prd.ValidateBundle(m, files)
			if err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			h.uploads <- bundle
			h.readyStored.Store(true)
			if h.readyAfterUpload {
				<-r.Context().Done()
				return
			}
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected connector request %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(h.server.Close)
	return h
}

func stopConnector(t *testing.T, cmd *exec.Cmd, output *bytes.Buffer, dir string) {
	t.Helper()
	cmd.Process.Signal(os.Interrupt)
	if err := cmd.Wait(); err != nil {
		t.Fatalf("connector failed: %v %s", err, output.String())
	}
	if strings.Contains(output.String(), "secret") || strings.Contains(output.String(), "ou_fixture") {
		t.Fatalf("unsafe output: %s", output.String())
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "acceptances-lark-") {
			t.Fatal("temporary task data retained")
		}
	}
}

func TestLarkConnectResolvesWikiAndRetainsAvailableResources(t *testing.T) {
	t.Setenv("LARK_FIXTURE_SCENARIO", "resources")
	h := newConnectorHarness(t, "https://team.feishu.cn/wiki/WikiToken123")
	cmd, output, dir := connectorProcess(t, h.server.URL)
	select {
	case bundle := <-h.uploads:
		if bundle.Manifest.DocumentID != "DocToken123" || bundle.Manifest.Completeness != "partial" || len(bundle.Manifest.Resources) != 4 || len(bundle.Files) != 4 {
			t.Fatalf("incomplete resource manifest: %#v", bundle.Manifest)
		}
		if bundle.Manifest.Resources[0].Status != "saved" || bundle.Manifest.Resources[1].Status != "saved" || bundle.Manifest.Resources[2].Reason != "NO_RESOURCE_TOKEN" || bundle.Manifest.Resources[3].Status != "unsupported" {
			t.Fatalf("missing resource state: %#v", bundle.Manifest.Resources)
		}
		if !strings.Contains(string(bundle.Files["document.md"]), "](resource-001.png)") || strings.Contains(string(bundle.Files["source.json"]), "signature") || bundle.Manifest.Resources[0].FetchedAt == "" {
			t.Fatal("resources or provenance not normalized")
		}
	case problem := <-h.failures:
		t.Fatalf("unexpected failure: %#v", problem)
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("resource upload timed out: %s", output.String())
	}
	stopConnector(t, cmd, output, dir)
	raw, _ := os.ReadFile(filepath.Join(dir, "calls.jsonl"))
	if !strings.Contains(string(raw), `"wiki","+node-get"`) || !strings.Contains(string(raw), `"--type","whiteboard"`) || strings.Contains(string(raw), "127.0.0.1:9") {
		t.Fatalf("resource protocol violated: %s", raw)
	}
}

func TestLarkConnectRejectsChangedIdentityAndBadReads(t *testing.T) {
	for _, scenario := range []struct {
		name, code string
		stop       bool
	}{{"identity_changed", "LARK_IDENTITY_CHANGED", true}, {"version_changed", "LARK_VERSION_CHANGED", false}, {"malformed", "LARK_INVALID_RESULT", false}, {"permission", "LARK_PERMISSION_DENIED", false}, {"wiki_sheet", "LARK_UNSUPPORTED_DOCUMENT", false}} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("LARK_FIXTURE_SCENARIO", scenario.name)
			source := "https://team.feishu.cn/docx/DocToken123"
			if scenario.name == "wiki_sheet" {
				source = "https://team.feishu.cn/wiki/WikiToken123"
			}
			h := newConnectorHarness(t, source)
			cmd, output, dir := connectorProcess(t, h.server.URL)
			select {
			case problem := <-h.failures:
				if problem["errorCode"] != scenario.code || problem["phase"] != "reading" {
					t.Fatalf("wrong controlled failure: %#v", problem)
				}
			case <-time.After(larkProcessTimeout):
				cmd.Process.Signal(os.Interrupt)
				cmd.Wait()
				t.Fatalf("failure not reported: %s", output.String())
			}
			if scenario.stop {
				if err := cmd.Wait(); err == nil {
					t.Fatal("changed identity did not stop connector")
				}
				if strings.Contains(output.String(), "secret") || strings.Contains(output.String(), "ou_other") {
					t.Fatal("reader identity leaked")
				}
			} else {
				stopConnector(t, cmd, output, dir)
			}
			select {
			case <-h.uploads:
				t.Fatal("bad read was uploaded")
			default:
			}
		})
	}
}

func TestLarkConnectRetriesRateLimitAndLostUploadConnection(t *testing.T) {
	t.Setenv("LARK_FIXTURE_SCENARIO", "rate_limit")
	h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
	h.disconnectUpload = true
	cmd, output, dir := connectorProcess(t, h.server.URL)
	select {
	case <-h.uploads:
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("recovery failed: %s", output.String())
	}
	stopConnector(t, cmd, output, dir)
	raw, _ := os.ReadFile(filepath.Join(dir, "calls.jsonl"))
	if strings.Count(string(raw), `"docs","+fetch"`) != 5 {
		t.Fatalf("read was retried incorrectly: %s", raw)
	}
}

func TestLarkConnectPreservesCodeDuringReadingViewCleanup(t *testing.T) {
	t.Setenv("LARK_FIXTURE_SCENARIO", "code")
	h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
	cmd, output, dir := connectorProcess(t, h.server.URL)
	select {
	case bundle := <-h.uploads:
		reading := string(bundle.Files["document.md"])
		if !strings.Contains(reading, "![literal](https://example.com/sample)") || !strings.Contains(reading, "<!-- literal comment example -->") || !strings.Contains(reading, "`![inline](https://example.com/example)`") {
			t.Fatalf("code changed during resource cleanup: %s", reading)
		}
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("code upload timed out: %s", output.String())
	}
	stopConnector(t, cmd, output, dir)
}

func TestLarkConnectRecognizesReadyCandidateWhenUploadHeartbeatConflicts(t *testing.T) {
	h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
	h.readyAfterUpload = true
	cmd, output, dir := connectorProcess(t, h.server.URL)
	select {
	case <-h.readyChecked:
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("saved candidate was not recovered after heartbeat conflict: %s", output.String())
	}
	stopConnector(t, cmd, output, dir)
	select {
	case problem := <-h.failures:
		t.Fatalf("saved candidate was reported as failed: %#v", problem)
	default:
	}
}

func TestLarkConnectCancelsSubprocessAndCleansTemporaryResources(t *testing.T) {
	t.Setenv("LARK_FIXTURE_SCENARIO", "slow_media")
	h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
	h.cancelBusy = true
	cmd, output, dir := connectorProcess(t, h.server.URL)
	deadline := time.Now().Add(larkProcessTimeout)
	for h.renewals.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if h.renewals.Load() == 0 {
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("lease was not renewed while Lark was running: %s", output.String())
	}
	stopConnector(t, cmd, output, dir)
	select {
	case <-h.uploads:
		t.Fatal("cancelled task was uploaded")
	default:
	}
	if !h.disconnected.Load() {
		t.Fatal("connector registration was not revoked on exit")
	}
}

func connectorProcess(t *testing.T, server string) (*exec.Cmd, *bytes.Buffer, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("controlled executable fixture requires Unix; Windows needs a separate OS receipt")
	}
	dir := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	wrapper := "#!/bin/sh\nACCEPTANCES_LARK_FIXTURE=1 exec '" + strings.ReplaceAll(executable, "'", "'\\''") + "' -test.run=^TestLarkFixture$ -- \"$@\"\n"
	if err := os.WriteFile(filepath.Join(dir, "lark-cli"), []byte(wrapper), 0700); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(dir, "config")
	t.Setenv("ACCEPTANCES_CONFIG_DIR", config)
	if _, err := authCommand("login", server, "fixture", true, strings.NewReader("fixture-password\n")); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	cmd := exec.Command(executable, "-test.run=^TestLarkProcess$", "--", "lark", "connect", "--url", server)
	cmd.Dir = dir // No repository or project binding is available.
	cmd.Env = append(os.Environ(), "ACCEPTANCES_LARK_PROCESS=1", "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"), "LARK_FIXTURE_CALLS="+filepath.Join(dir, "calls.jsonl"), "TMPDIR="+dir)
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	})
	return cmd, &output, dir
}

func TestLarkConnectImportsWithPersonalCLIOutsideRepository(t *testing.T) {
	uploaded := make(chan prd.Bundle, 1)
	claimed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/login" {
			fmt.Fprint(w, `{"user":{"id":"fixture-user"},"token":"platform-secret","expiresAt":"2099-01-01T00:00:00Z"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer platform-secret" {
			t.Error("missing personal platform session")
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/v1/auth/me":
			fmt.Fprint(w, `{"id":"fixture-user"}`)
		case "/api/v1/lark-connectors":
			fmt.Fprint(w, `{"connector":{"id":"connector-1","protocolVersion":1},"connectorToken":"connector-secret"}`)
		case "/api/v1/lark-connectors/connector-1":
			w.WriteHeader(204)
		case "/api/v1/lark-connectors/connector-1/poll":
			if r.Header.Get("X-Acceptances-Connector-Token") != "connector-secret" {
				t.Error("missing connector proof")
			}
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if claimed && body["importId"] == nil {
				w.WriteHeader(204)
				return
			}
			claimed = true
			json.NewEncoder(w).Encode(prd.Claim{ImportID: "import-1", CampaignID: "campaign-1", URL: "https://team.feishu.cn/docx/DocToken123?track=ignored#share-selected", Attempt: 1, ClaimToken: "claim-secret", LeaseExpiresAt: time.Now().Add(90 * time.Second).UTC().Format(time.RFC3339)})
		case "/api/v1/prd-imports/import-1/result":
			if r.Header.Get("X-Acceptances-Claim-Token") != "claim-secret" || r.Header.Get("X-Acceptances-Claim-Attempt") != "1" {
				t.Error("missing claim proof")
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			defer r.MultipartForm.RemoveAll()
			var m prd.Manifest
			json.Unmarshal([]byte(r.FormValue("manifest")), &m)
			files := make(map[string][]byte)
			for _, header := range r.MultipartForm.File["file"] {
				file, _ := header.Open()
				var data bytes.Buffer
				data.ReadFrom(file)
				file.Close()
				files[header.Filename] = data.Bytes()
			}
			bundle, err := prd.ValidateBundle(m, files)
			if err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			uploaded <- bundle
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected route: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	cmd, output, dir := connectorProcess(t, server.URL)
	select {
	case bundle := <-uploaded:
		if strings.Contains(string(bundle.Files["source.json"]), "private") || bundle.Manifest.Completeness != "complete" {
			t.Fatal("comments were uploaded or completeness is wrong")
		}
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatalf("connector did not upload: %s", output.String())
	}
	cmd.Process.Signal(os.Interrupt)
	if err := cmd.Wait(); err != nil {
		t.Fatalf("connector failed: %v %s", err, output.String())
	}
	if strings.Contains(output.String(), "secret") || strings.Contains(output.String(), "ou_fixture") || !strings.Contains(output.String(), `"event":"ready"`) {
		t.Fatalf("unsafe or missing ready event: %s", output.String())
	}
	raw, err := os.ReadFile(filepath.Join(dir, "calls.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"--revision-id","1"`) || !strings.Contains(string(raw), `"--profile","personal"`) || strings.Contains(string(raw), "share-selected") {
		t.Fatalf("wrong read protocol: %s", raw)
	}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "acceptances-lark-") {
			t.Fatal("task temporary directory was not removed")
		}
	}
}
