package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/cli"
	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/Chulan-824/acceptances/internal/testmysql"
)

// The helper runs the public CLI in a separate process, including its signal handling.
func TestPRDConnectorCommandProcess(t *testing.T) {
	if os.Getenv("ACCEPTANCES_PRD_COMMAND_PROCESS") != "1" {
		return
	}
	index := slices.Index(os.Args, "--")
	if index < 0 {
		os.Exit(2)
	}
	os.Exit(cli.Run(os.Args[index+1:], os.Stdout, os.Stderr))
}

func TestPRDLocalConnectorPublishesForItsOwnUser(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("this controlled subprocess fixture uses a Unix executable; Windows requires a separate real-OS receipt")
	}
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal("the locked Node toolchain is required for this subprocess integration test")
	}
	dsn, _ := testmysql.New(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.Close() })
	server := httptest.NewServer(app.Handler())
	t.Cleanup(server.Close)

	request := func(token, method, path string, value any) (int, []byte) {
		t.Helper()
		var body io.Reader
		if value != nil {
			raw, marshalErr := json.Marshal(value)
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			body = bytes.NewReader(raw)
		}
		req, requestErr := http.NewRequestWithContext(t.Context(), method, server.URL+"/api/v1"+path, body)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		if value != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		response, requestErr := server.Client().Do(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		defer response.Body.Close()
		raw, readErr := io.ReadAll(response.Body)
		if readErr != nil {
			t.Fatal(readErr)
		}
		return response.StatusCode, raw
	}
	register := func(name string) string {
		t.Helper()
		status, raw := request("", "POST", "/auth/register", map[string]string{
			"username": name, "password": "synthetic test password", "client": "cli",
		})
		if status != http.StatusCreated {
			t.Fatalf("create synthetic account: status %d", status)
		}
		var session struct{ Token string }
		if err := json.Unmarshal(raw, &session); err != nil || session.Token == "" {
			t.Fatal("synthetic account did not return a session")
		}
		return session.Token
	}
	first, second := register("prd_connector_first"), register("prd_connector_second")
	status, raw := request(first, "POST", "/projects", map[string]string{"name": "Synthetic PRD connector"})
	if status != http.StatusCreated {
		t.Fatalf("create synthetic project: status %d", status)
	}
	var project struct{ ID string }
	if err := json.Unmarshal(raw, &project); err != nil {
		t.Fatal(err)
	}
	status, raw = request(first, "POST", "/projects/"+project.ID+"/campaigns", map[string]string{"title": "Synthetic requirement"})
	if status != http.StatusCreated {
		t.Fatalf("create synthetic campaign: status %d", status)
	}
	var campaign struct{ ID string }
	if err := json.Unmarshal(raw, &campaign); err != nil {
		t.Fatal(err)
	}

	directory := t.TempDir()
	fakeCLI := filepath.Join(directory, "lark-cli")
	if err := os.WriteFile(fakeCLI, []byte(prdControlledLark), 0700); err != nil {
		t.Fatal(err)
	}
	environment := append(os.Environ(),
		"ACCEPTANCES_PRD_COMMAND_PROCESS=1",
		"ACCEPTANCES_CONFIG_DIR="+filepath.Join(directory, "config"),
		"PATH="+directory+string(os.PathListSeparator)+os.Getenv("PATH"),
	)
	command := func(args ...string) *exec.Cmd {
		cmd := exec.CommandContext(t.Context(), os.Args[0], append([]string{"-test.run=^TestPRDConnectorCommandProcess$", "--"}, args...)...)
		cmd.Env, cmd.Dir = environment, directory
		return cmd
	}
	login := command("login", "--url", server.URL, "--username", "prd_connector_first", "--password-stdin")
	login.Stdin = strings.NewReader("synthetic test password\n")
	if err := login.Run(); err != nil {
		t.Fatalf("public CLI login failed: %v", err)
	}
	connector := command("lark", "connect", "--url", server.URL)
	if err := connector.Start(); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	var commandErr error
	go func() {
		commandErr = connector.Wait()
		close(finished)
	}()
	t.Cleanup(func() {
		_ = connector.Process.Signal(os.Interrupt)
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			_ = connector.Process.Kill()
			<-finished
		}
	})
	wait := func(check func() bool) {
		t.Helper()
		deadline := time.Now().Add(45 * time.Second)
		for time.Now().Before(deadline) {
			select {
			case <-finished:
				t.Fatalf("connector exited before completing the public workflow: %v", commandErr)
			default:
			}
			if check() {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("public connector workflow did not reach its expected state")
	}
	var connectorID string
	wait(func() bool {
		status, raw := request(first, "GET", "/lark-connectors", nil)
		if status != http.StatusOK {
			return false
		}
		var list struct{ Items []prd.Connector }
		if err := json.Unmarshal(raw, &list); err == nil && len(list.Items) == 1 && list.Items[0].Online {
			connectorID = list.Items[0].ID
			return true
		}
		return false
	})
	status, raw = request(first, "POST", "/campaigns/"+campaign.ID+"/prd-imports", map[string]string{
		"url":         "https://fixture.feishu.cn/docx/docxSyntheticConnector01#share-part",
		"connectorId": connectorID, "clientRequestId": "synthetic-connector-roundtrip",
	})
	if status != http.StatusAccepted {
		t.Fatalf("create URL import: status %d", status)
	}
	var imported prd.Import
	if err := json.Unmarshal(raw, &imported); err != nil {
		t.Fatal(err)
	}
	if status, _ := request(second, "GET", "/prd-imports/"+imported.ID, nil); status != http.StatusNotFound && status != http.StatusForbidden {
		t.Fatalf("another account could inspect the private task: status %d", status)
	}
	wait(func() bool {
		status, raw := request(first, "GET", "/prd-imports/"+imported.ID, nil)
		if status != http.StatusOK || json.Unmarshal(raw, &imported) != nil {
			return false
		}
		if imported.Status == "failed" {
			t.Fatalf("controlled Lark import failed: %s", imported.ErrorCode)
		}
		return imported.Status == "ready"
	})
	status, raw = request(second, "GET", "/campaigns/"+campaign.ID+"/prd-snapshots", nil)
	var before prd.SnapshotList
	if status != http.StatusOK || json.Unmarshal(raw, &before) != nil || len(before.Items) != 0 {
		t.Fatal("unconfirmed content became visible to another account")
	}
	status, raw = request(first, "POST", "/prd-imports/"+imported.ID+"/confirm", map[string]any{
		"expectedCurrentSnapshotId": imported.BaseSnapshotID, "acceptPartial": false,
	})
	var snapshot prd.Snapshot
	if status != http.StatusCreated || json.Unmarshal(raw, &snapshot) != nil || snapshot.ID == "" {
		t.Fatalf("confirm synthetic PRD: status %d", status)
	}
	status, markdown := request(second, "GET", "/prd-snapshots/"+snapshot.ID+"/files/document.md", nil)
	if status != http.StatusOK || !bytes.Contains(markdown, []byte("成员本机正文")) {
		t.Fatal("confirmed reading view was not shared with the other account")
	}
	status, raw = request(first, "GET", "/campaigns/"+campaign.ID, nil)
	var current struct{ Status, LatestRunID string }
	if status != http.StatusOK || json.Unmarshal(raw, &current) != nil || current.Status != "pending" || current.LatestRunID != "" {
		t.Fatal("import changed the Campaign verification conclusion")
	}
}

const prdControlledLark = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
if (args.includes("--version") || args[0] === "version") {
  process.stdout.write("lark-cli version 1.0.98\n");
} else if (args.includes("profile") && args.includes("list")) {
  send([{name:"integration",brand:"feishu",active:true,effective:true}]);
} else if (args.includes("auth") && args.includes("status")) {
  send({appId:"cli_synthetic",brand:"feishu",identity:"user",identities:{user:{openId:"ou_synthetic_reader",verified:true,available:true}}});
} else if (args.includes("+fetch")) {
  const format = args[args.indexOf("--doc-format")+1];
  send({ok:true,identity:"user",data:{document:{document_id:"docxSyntheticConnector01",revision_id:42,content:format==="xml"?"<title>合成 PRD</title><p>成员本机正文。</p><table><tr><th>能力</th><th>结果</th></tr><tr><td>URL 导入</td><td>待确认后共享</td></tr></table><img ref=\"image-1\"/>":"# 合成 PRD\n\n成员本机正文。\n\n| 能力 | 结果 |\n| --- | --- |\n| URL 导入 | 待确认后共享 |\n\n![合成图片](ImageSynthetic01)\n",reference_map:{images:{"image-1":{token:"ImageSynthetic01"}}}}}});
} else if (args.includes("+media-download")) {
  const output = args[args.indexOf("--output")+1] + ".png";
  fs.writeFileSync(output,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=","base64"));
  send({ok:true,identity:"user",data:{path:output}});
} else {
  process.stderr.write(JSON.stringify({ok:false,error:{type:"invalid_parameters",code:"SYNTHETIC_COMMAND_NOT_SUPPORTED"}})+"\n");
  process.exitCode=2;
}
`
