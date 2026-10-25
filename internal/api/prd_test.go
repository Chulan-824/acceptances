package api_test

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/prd"
)

func prdJSON(t *testing.T, app *api.Server, token, method, path string, body any, headers map[string]string, want int, result any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := localRequest(method, path, strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, req)
	if w.Code != want {
		t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
	}
	if result != nil && json.Unmarshal(w.Body.Bytes(), result) != nil {
		t.Fatal("invalid PRD response")
	}
	return w
}

func prdTestBundle(t *testing.T, revision, text string) (prd.Manifest, map[string][]byte) {
	t.Helper()
	raw, err := json.Marshal(prd.SourceDocument{DocumentID: "DocToken123", RevisionID: revision, Content: "<title>PRD fixture</title><p>" + text + "</p>", ReferenceMap: map[string]json.RawMessage{}})
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{"source.json": raw, "document.md": []byte("# PRD fixture\n\n" + text)}
	manifest := prd.Manifest{SchemaVersion: 1, DocumentID: "DocToken123", Realm: "feishu", RevisionID: revision, Title: "PRD fixture", FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), NormalizerVersion: prd.NormalizerVersion, Completeness: "complete", Warnings: []prd.Warning{}, Resources: []prd.Resource{}, Files: []prd.File{}}
	for _, name := range []string{"source.json", "document.md"} {
		role, kind := "source", "application/json"
		if name == "document.md" {
			role, kind = "markdown", "text/markdown"
		}
		sum := sha256.Sum256(files[name])
		manifest.Files = append(manifest.Files, prd.File{Name: name, Role: role, ContentType: kind, Size: int64(len(files[name])), SHA256: hex.EncodeToString(sum[:])})
	}
	return manifest, files
}

func prdUpload(t *testing.T, f prdTestFixture, task prd.Import, claim prd.Claim, manifest prd.Manifest, files map[string][]byte, want int) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	raw, _ := json.Marshal(manifest)
	if err := writer.WriteField("manifest", string(raw)); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := localRequest("POST", "/api/v1/prd-imports/"+task.ID+"/result", &body)
	req.Header.Set("Authorization", "Bearer "+f.alice)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-Acceptances-Connector-Token", f.registration.ConnectorToken)
	req.Header.Set("X-Acceptances-Claim-Token", claim.ClaimToken)
	req.Header.Set("X-Acceptances-Claim-Attempt", "1")
	response := httptest.NewRecorder()
	f.app.Handler().ServeHTTP(response, req)
	if response.Code != want {
		t.Fatalf("upload: %d %s", response.Code, response.Body.String())
	}
}

func prdStart(t *testing.T, f prdTestFixture, request string) (prd.Import, prd.Claim) {
	t.Helper()
	var task prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", map[string]string{"url": "https://example.feishu.cn/docx/DocToken123", "connectorId": f.registration.Connector.ID, "clientRequestId": request}, nil, 202, &task)
	var claim prd.Claim
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors/"+f.registration.Connector.ID+"/poll", map[string]any{}, map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}, 200, &claim)
	if claim.ImportID != task.ID {
		t.Fatal("another task was claimed")
	}
	return task, claim
}

func TestPRDConfirmedSnapshotIsSharedAndImmutable(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "snapshot-first")
	manifest, files := prdTestBundle(t, "1", "Requirement")
	prdUpload(t, f, task, claim, manifest, files, 200)
	prdUpload(t, f, task, claim, manifest, files, 200)
	path := "/api/v1/prd-imports/" + task.ID + "/files/document.md"
	prdJSON(t, f.app, f.bob, "GET", path, nil, nil, 404, nil)
	response := prdJSON(t, f.app, f.alice, "GET", path, nil, nil, 200, nil)
	if response.Body.String() != string(files["document.md"]) {
		t.Fatal("candidate text changed")
	}
	var snapshot prd.Snapshot
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": "", "acceptPartial": false}, nil, 201, &snapshot)
	var repeated prd.Snapshot
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": "", "acceptPartial": false}, nil, 200, &repeated)
	if repeated.ID != snapshot.ID {
		t.Fatal("confirmation duplicated snapshot")
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if list.CurrentSnapshotID != snapshot.ID || len(list.Items) != 1 {
		t.Fatal("confirmed snapshot not shared")
	}
	response = prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+snapshot.ID+"/files/document.md", nil, nil, 200, nil)
	if response.Body.String() != string(files["document.md"]) {
		t.Fatal("shared content changed")
	}
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/cancel", map[string]any{}, nil, 409, nil)
	var campaign map[string]any
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign, nil, nil, 200, &campaign)
	if campaign["status"] != "pending" || campaign["latestRunId"] != "" {
		t.Fatal("PRD import changed verification state")
	}
}

type prdTestFixture struct {
	app          *api.Server
	alice, bob   string
	campaign     string
	registration prd.Registration
	dsn          string
	db           *sql.DB
}

func newPRDFixture(t *testing.T) prdTestFixture {
	t.Helper()
	dsn, db := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	alice, _, _ := registerAccount(t, app, "prd-alice", true)
	bob, _, _ := registerAccount(t, app, "prd-bob", true)
	var project, campaign struct{ ID string }
	prdJSON(t, app, alice, "POST", "/api/v1/projects", map[string]string{"name": "PRD fixture"}, nil, 201, &project)
	prdJSON(t, app, alice, "POST", "/api/v1/projects/"+project.ID+"/campaigns", map[string]string{"title": "Requirement"}, nil, 201, &campaign)
	var registration prd.Registration
	prdJSON(t, app, alice, "POST", "/api/v1/lark-connectors", map[string]any{"name": "Alice laptop", "protocolVersion": 1, "larkCliVersion": "1.0.98"}, nil, 201, &registration)
	return prdTestFixture{app: app, alice: alice, bob: bob, campaign: campaign.ID, registration: registration, dsn: dsn, db: db}
}

func prdConfirm(t *testing.T, f prdTestFixture, task prd.Import, head string, partial bool, want int) prd.Snapshot {
	t.Helper()
	var snapshot prd.Snapshot
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head, "acceptPartial": partial}, nil, want, &snapshot)
	return snapshot
}

func TestPRDFileAuditAndCampaignDeletion(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "audit-first")
	manifest, files := prdTestBundle(t, "1", "Durable requirement")
	prdUpload(t, f, task, claim, manifest, files, 200)
	snapshot := prdConfirm(t, f, task, "", false, 201)
	f.app.Close()
	audit, err := api.MigrateFilesToMySQL(t.Context(), t.TempDir(), f.dsn)
	if err != nil || audit.Files != 2 || audit.Objects != 2 {
		t.Fatalf("PRD files missing from audit: files=%d objects=%d err=%v", audit.Files, audit.Objects, err)
	}
	reopened, err := api.OpenMySQL(t.TempDir(), f.dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	f.app = reopened
	body := prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+snapshot.ID+"/files/document.md", nil, nil, 200, nil)
	if body.Body.String() != string(files["document.md"]) {
		t.Fatal("restart lost PRD bytes")
	}
	var impact map[string]int
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/campaigns/"+f.campaign+"/delete-preview", nil, nil, 200, &impact)
	if impact["prdSnapshots"] != 1 || impact["prdFiles"] != 2 {
		t.Fatalf("PRD deletion impact missing: %v", impact)
	}
	prdJSON(t, f.app, f.alice, "DELETE", "/api/v1/campaigns/"+f.campaign, nil, nil, 204, nil)
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+snapshot.ID, nil, nil, 404, nil)
	for _, table := range []string{"prd_imports", "prd_snapshots", "prd_import_files", "campaign_prd_heads"} {
		var count int
		if err = f.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("Campaign deletion left %s: %d %v", table, count, err)
		}
	}
}

func TestPRDUploadRejectsUntrustedBundleAndPath(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "invalid-upload")
	manifest, files := prdTestBundle(t, "1", "Requirement")
	for _, change := range []string{"hash", "missing", "extra", "revision", "path"} {
		t.Run(change, func(t *testing.T) {
			altered := maps.Clone(files)
			m := manifest
			switch change {
			case "hash":
				altered["document.md"] = []byte("tampered")
			case "missing":
				delete(altered, "document.md")
			case "extra":
				altered["extra.txt"] = []byte("undeclared")
			case "revision":
				m.RevisionID = "2"
			case "path":
				altered["../document.md"] = altered["document.md"]
				delete(altered, "document.md")
			}
			prdUpload(t, f, task, claim, m, altered, 400)
		})
	}
	var state prd.Import
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+task.ID, nil, nil, 200, &state)
	if state.Status != "fetching" {
		t.Fatalf("invalid result changed task: %s", state.Status)
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if len(list.Items) != 0 || list.CurrentSnapshotID != "" {
		t.Fatal("invalid upload became shared")
	}
}

func TestPRDVersionsDeduplicateAndConflictsKeepHead(t *testing.T) {
	f := newPRDFixture(t)
	first, claim := prdStart(t, f, "version-one")
	m, files := prdTestBundle(t, "9007199254740993", "Requirement")
	prdUpload(t, f, first, claim, m, files, 200)
	head := prdConfirm(t, f, first, "", false, 201)
	duplicate, claim := prdStart(t, f, "duplicate")
	// Read metadata differs, while stable source/resources still identify the same version.
	m.FetchedAt = time.Now().UTC().Format(time.RFC3339Nano)
	prdUpload(t, f, duplicate, claim, m, files, 200)
	reused := prdConfirm(t, f, duplicate, head.ID, false, 200)
	if reused.ID != head.ID {
		t.Fatal("same version duplicated")
	}
	bad, claim := prdStart(t, f, "inconsistent")
	changed, changedFiles := prdTestBundle(t, m.RevisionID, "Changed same revision")
	prdUpload(t, f, bad, claim, changed, changedFiles, 200)
	response := prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+bad.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head.ID}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "IMPORT_INCONSISTENT") {
		t.Fatal("same revision inconsistency not identified")
	}
	newer, claim := prdStart(t, f, "version-two")
	m, files = prdTestBundle(t, "9007199254740994", "Requirement")
	prdUpload(t, f, newer, claim, m, files, 200)
	head = prdConfirm(t, f, newer, head.ID, false, 201)
	if head.Manifest.RevisionID != "9007199254740994" {
		t.Fatal("revision precision lost")
	}
	repeated := prdConfirm(t, f, first, "", false, 200)
	if repeated.ID != reused.ID {
		t.Fatal("response-loss recovery changed original confirmation")
	}
	old, claim := prdStart(t, f, "old-version")
	m, files = prdTestBundle(t, "9007199254740993", "Requirement")
	prdUpload(t, f, old, claim, m, files, 200)
	response = prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+old.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head.ID}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "PRD_REVISION_STALE") {
		t.Fatal("old revision was not rejected")
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if len(list.Items) != 2 || list.CurrentSnapshotID != head.ID {
		t.Fatal("failed import changed current or history")
	}
}

func TestPRDConcurrentConfirmRequiresExplicitHead(t *testing.T) {
	f := newPRDFixture(t)
	one, claim := prdStart(t, f, "concurrent-one")
	m, files := prdTestBundle(t, "1", "Requirement")
	prdUpload(t, f, one, claim, m, files, 200)
	two, claim := prdStart(t, f, "concurrent-two")
	prdUpload(t, f, two, claim, m, files, 200)
	results := make(chan *httptest.ResponseRecorder, 2)
	var group sync.WaitGroup
	for _, task := range []prd.Import{one, two} {
		group.Go(func() {
			req := localRequest("POST", "/api/v1/prd-imports/"+task.ID+"/confirm", strings.NewReader(`{"expectedCurrentSnapshotId":""}`))
			req.Header.Set("Authorization", "Bearer "+f.alice)
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			f.app.Handler().ServeHTTP(response, req)
			results <- response
		})
	}
	group.Wait()
	close(results)
	statuses := map[int]int{}
	for result := range results {
		statuses[result.Code]++
		if result.Code == 409 && !strings.Contains(result.Body.String(), "PRD_HEAD_CHANGED") {
			t.Fatal("wrong concurrent conflict")
		}
	}
	if statuses[201] != 1 || statuses[409] != 1 {
		t.Fatalf("concurrent confirmations: %v", statuses)
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if len(list.Items) != 1 {
		t.Fatal("concurrent duplicate")
	}
	for _, task := range []prd.Import{one, two} {
		prdConfirm(t, f, task, list.CurrentSnapshotID, false, 200)
	}
}

func prdImageBundle(t *testing.T, saved bool, pixel uint8) (prd.Manifest, map[string][]byte) {
	t.Helper()
	m, files := prdTestBundle(t, "1", "Image requirement")
	source := prd.SourceDocument{DocumentID: m.DocumentID, RevisionID: m.RevisionID, Content: `<title>PRD fixture</title><img ref="img_1"></img>`, ReferenceMap: map[string]json.RawMessage{"images": json.RawMessage(`{"img_1":{"token":"ImageToken123"}}`)}}
	files["source.json"], _ = json.Marshal(source)
	m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
	m.Resources = []prd.Resource{{Reference: "img_1", ResourceID: "ImageToken123", Kind: "image", Status: "missing", Reason: "RESOURCE_NOT_DOWNLOADED"}}
	m.Completeness = "partial"
	if saved {
		img := image.NewRGBA(image.Rect(0, 0, 1, 1))
		img.SetRGBA(0, 0, color.RGBA{R: pixel, A: 255})
		var output bytes.Buffer
		if err := png.Encode(&output, img); err != nil {
			t.Fatal(err)
		}
		files["image.png"] = output.Bytes()
		m.Files = append(m.Files, prd.DescribeFile("image.png", "image", "image/png", files["image.png"]))
		m.Resources[0].Status, m.Resources[0].Filename, m.Resources[0].Reason = "saved", "image.png", ""
		m.Resources[0].FetchedAt = time.Now().UTC().Format(time.RFC3339Nano)
		m.Completeness = "complete"
	}
	return m, files
}

func TestPRDPartialRequiresConsentAndCanBeCompleted(t *testing.T) {
	f := newPRDFixture(t)
	first, claim := prdStart(t, f, "partial")
	m, files := prdImageBundle(t, false, 0)
	prdUpload(t, f, first, claim, m, files, 200)
	response := prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+first.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": ""}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "PRD_PARTIAL_CONFIRMATION_REQUIRED") {
		t.Fatal("partial lacks explicit consent")
	}
	head := prdConfirm(t, f, first, "", true, 201)
	second, claim := prdStart(t, f, "completed")
	m, files = prdImageBundle(t, true, 10)
	prdUpload(t, f, second, claim, m, files, 200)
	full := prdConfirm(t, f, second, head.ID, false, 201)
	if head.ID == full.ID || full.Manifest.Completeness != "complete" {
		t.Fatal("partial was not completed as a new snapshot")
	}
	third, claim := prdStart(t, f, "read-resource-failure")
	m, files = prdImageBundle(t, false, 0)
	prdUpload(t, f, third, claim, m, files, 200)
	reused := prdConfirm(t, f, third, full.ID, true, 200)
	if reused.ID != full.ID {
		t.Fatal("full snapshot downgraded after resource failure")
	}
	fourth, claim := prdStart(t, f, "changed-resource")
	m, files = prdImageBundle(t, true, 20)
	prdUpload(t, f, fourth, claim, m, files, 200)
	response = prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+fourth.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": full.ID}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "IMPORT_INCONSISTENT") {
		t.Fatal("changed saved resource was not rejected")
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if len(list.Items) != 2 || list.CurrentSnapshotID != full.ID {
		t.Fatal("partial history was rewritten")
	}
}

func TestPRDRepeatedResourceCannotHideChangedBytes(t *testing.T) {
	f := newPRDFixture(t)
	m, files := prdImageBundle(t, true, 10)
	var source prd.SourceDocument
	if err := json.Unmarshal(files["source.json"], &source); err != nil {
		t.Fatal(err)
	}
	source.Content += `<img ref="img_2"></img>`
	source.ReferenceMap["images"] = json.RawMessage(`{"img_1":{"token":"ImageToken123"},"img_2":{"token":"ImageToken123"}}`)
	files["source.json"], _ = json.Marshal(source)
	m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
	repeated := m.Resources[0]
	repeated.Reference = "img_2"
	m.Resources = append(m.Resources, repeated)
	first, claim := prdStart(t, f, "duplicate-resource-first")
	prdUpload(t, f, first, claim, m, files, 200)
	head := prdConfirm(t, f, first, "", false, 201)
	_, changedFiles := prdImageBundle(t, true, 20)
	files["changed.png"] = changedFiles["image.png"]
	m.Files = append(m.Files, prd.DescribeFile("changed.png", "image", "image/png", files["changed.png"]))
	// The last alias still uses the original bytes, so comparing only the last map entry would hide the change.
	m.Resources[0].Filename = "changed.png"
	second, claim := prdStart(t, f, "duplicate-resource-changed")
	prdUpload(t, f, second, claim, m, files, 200)
	response := prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+second.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head.ID}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "IMPORT_INCONSISTENT") {
		t.Fatal("repeated resource hid changed retained bytes")
	}
}

func TestPRDExpiredCancelledAndFailedClaimsCannotPublish(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "claim-proof")
	m, files := prdTestBundle(t, "1", "Requirement")
	wrong := claim
	wrong.ClaimToken = "invalid"
	prdUpload(t, f, task, wrong, m, files, 403)
	headers := map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken, "X-Acceptances-Claim-Token": claim.ClaimToken, "X-Acceptances-Claim-Attempt": "1"}
	prdJSON(t, f.app, f.bob, "POST", "/api/v1/prd-imports/"+task.ID+"/failure", map[string]any{"errorCode": "LARK_SCOPE_REQUIRED", "phase": "reading", "retryable": false}, headers, 404, nil)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/failure", map[string]any{"errorCode": "raw token should never be persisted", "phase": "reading", "retryable": false}, headers, 400, nil)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/failure", map[string]any{"errorCode": "LARK_SCOPE_REQUIRED", "phase": "reading", "retryable": false}, headers, 204, nil)
	prdUpload(t, f, task, claim, m, files, 409)
	expired, expiredClaim := prdStart(t, f, "expired-lease")
	if _, err := f.db.Exec("UPDATE prd_imports SET lease_expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", expired.ID); err != nil {
		t.Fatal(err)
	}
	prdUpload(t, f, expired, expiredClaim, m, files, 409)
	var state prd.Import
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+expired.ID, nil, nil, 200, &state)
	if state.Status != "expired" || state.ErrorCode != "CONNECTOR_LOST" {
		t.Fatal("lost lease did not remain expired")
	}
	cancelled, late := prdStart(t, f, "cancelled-late")
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+cancelled.ID+"/cancel", map[string]any{}, nil, 204, nil)
	prdUpload(t, f, cancelled, late, m, files, 409)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/auth/logout", map[string]any{}, nil, 204, nil)
	prdUpload(t, f, cancelled, late, m, files, 401)
}

func TestPRDCreateRecoverySurvivesOfflineConnector(t *testing.T) {
	f := newPRDFixture(t)
	input := map[string]string{"url": "https://example.feishu.cn/docx/DocToken123", "connectorId": f.registration.Connector.ID, "clientRequestId": "lost-response"}
	var first, repeat prd.Import
	path := "/api/v1/campaigns/" + f.campaign + "/prd-imports"
	prdJSON(t, f.app, f.alice, "POST", path, input, nil, 202, &first)
	if _, err := f.db.Exec("UPDATE lark_connectors SET last_seen_at=UTC_TIMESTAMP(6)-INTERVAL 31 SECOND WHERE id=?", f.registration.Connector.ID); err != nil {
		t.Fatal(err)
	}
	prdJSON(t, f.app, f.alice, "POST", path, input, nil, 202, &repeat)
	if repeat.ID != first.ID {
		t.Fatal("offline recovery duplicated task")
	}
	input["url"] = "https://example.feishu.cn/docx/DifferentToken"
	response := prdJSON(t, f.app, f.alice, "POST", path, input, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "PRD_REQUEST_CONFLICT") {
		t.Fatal("request id changed payload silently")
	}
	input["clientRequestId"] = "new-request"
	response = prdJSON(t, f.app, f.alice, "POST", path, input, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "CONNECTOR_OFFLINE") {
		t.Fatal("offline connector accepted new work")
	}
	prdJSON(t, f.app, f.alice, "DELETE", "/api/v1/lark-connectors/"+f.registration.Connector.ID, nil, nil, 204, nil)
	input["url"], input["clientRequestId"] = "https://example.feishu.cn/docx/DocToken123", "lost-response"
	prdJSON(t, f.app, f.alice, "POST", path, input, nil, 202, &repeat)
	if repeat.ID != first.ID || repeat.Status != "failed" {
		t.Fatal("disconnection erased response-loss recovery")
	}
}

func TestPRDResultTransactionAndConfirmedStorageGuards(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "transaction-failure")
	m, files := prdTestBundle(t, "1", "Atomic requirement")
	// The public upload must roll back metadata and all business references when attaching a file fails.
	_, err := f.db.Exec(`CREATE TRIGGER prd_test_attachment_failure BEFORE INSERT ON prd_import_files FOR EACH ROW BEGIN IF NEW.filename='document.md' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='controlled attachment failure'; END IF; END`)
	if err != nil {
		t.Fatal(err)
	}
	prdUpload(t, f, task, claim, m, files, 500)
	var state prd.Import
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+task.ID, nil, nil, 200, &state)
	var count int
	if err = f.db.QueryRow("SELECT COUNT(*) FROM prd_import_files WHERE import_id=?", task.ID).Scan(&count); err != nil || count != 0 || state.Status != "fetching" {
		t.Fatalf("partial result became visible: status=%s refs=%d err=%v", state.Status, count, err)
	}
	if _, err = f.db.Exec("DROP TRIGGER prd_test_attachment_failure"); err != nil {
		t.Fatal(err)
	}
	prdUpload(t, f, task, claim, m, files, 200)
	snapshot := prdConfirm(t, f, task, "", false, 201)
	for _, statement := range []string{
		"UPDATE prd_snapshots SET payload=JSON_SET(payload,'$.manifest.title','changed')",
		"DELETE FROM prd_snapshots",
		"UPDATE prd_import_files SET filename='changed'",
		"DELETE FROM prd_import_files",
		"UPDATE prd_imports SET source_hash=REPEAT('0',64)",
		"UPDATE prd_imports SET payload=JSON_SET(payload,'$.url','https://example.feishu.cn/docx/OtherToken')",
		"UPDATE prd_imports SET status='cancelled',payload=JSON_SET(payload,'$.status','cancelled')",
	} {
		if _, err = f.db.Exec(statement); err == nil {
			t.Fatalf("confirmed storage allowed: %s", statement)
		}
	}
	var project, campaign struct{ ID string }
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/projects", map[string]string{"name": "Other PRD"}, nil, 201, &project)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/projects/"+project.ID+"/campaigns", map[string]string{"title": "Other requirement"}, nil, 201, &campaign)
	if _, err = f.db.Exec("INSERT INTO campaign_prd_heads(campaign_id,snapshot_id) VALUES(?,?)", campaign.ID, snapshot.ID); err == nil {
		t.Fatal("head accepted another Campaign's snapshot")
	}
	response := prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+snapshot.ID+"/files/document.md", nil, map[string]string{"Range": "bytes=0-4"}, 206, nil)
	if response.Body.String() != string(files["document.md"][:5]) {
		t.Fatal("PRD range reader changed bytes")
	}
}

func TestPRDReadySurvivesDisconnectAndExpiresPrivately(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "ready-disconnect")
	m, files := prdTestBundle(t, "1", "Requirement")
	prdUpload(t, f, task, claim, m, files, 200)
	prdJSON(t, f.app, f.alice, "DELETE", "/api/v1/lark-connectors/"+f.registration.Connector.ID, nil, nil, 204, nil)
	snapshot := prdConfirm(t, f, task, "", false, 201)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors", map[string]any{"name": "New process", "protocolVersion": 1, "larkCliVersion": "1.0.98"}, nil, 201, &f.registration)
	expired, claim := prdStart(t, f, "ready-expired")
	prdUpload(t, f, expired, claim, m, files, 200)
	before := time.Now().UTC().Add(-time.Second)
	if _, err := f.db.Exec("UPDATE prd_imports SET expires_at=?,payload=JSON_SET(payload,'$.expiresAt',?) WHERE id=?", before, before.Format(time.RFC3339Nano), expired.ID); err != nil {
		t.Fatal(err)
	}
	var state prd.Import
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+expired.ID, nil, nil, 200, &state)
	if state.Status != "expired" {
		t.Fatal("ready candidate failed to expire")
	}
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+expired.ID+"/files/document.md", nil, nil, 404, nil)
	prdConfirm(t, f, expired, snapshot.ID, false, 409)
	var count int
	if err := f.db.QueryRow("SELECT COUNT(*) FROM prd_import_files WHERE import_id=?", expired.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("expired candidate retained business file references")
	}
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+snapshot.ID+"/files/document.md", nil, nil, 200, nil)
}

func TestPRDSourceIdentityAndAliasesAreBoundAtConfirmation(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "wrong-document")
	m, files := prdTestBundle(t, "1", "Requirement")
	other := m
	other.DocumentID = "OtherDocumentToken"
	altered := maps.Clone(files)
	var source prd.SourceDocument
	if err := json.Unmarshal(altered["source.json"], &source); err != nil {
		t.Fatal(err)
	}
	source.DocumentID = other.DocumentID
	altered["source.json"], _ = json.Marshal(source)
	other.Files = append([]prd.File(nil), other.Files...)
	other.Files[0] = prd.DescribeFile("source.json", "source", "application/json", altered["source.json"])
	prdUpload(t, f, task, claim, other, altered, 409)
	prdUpload(t, f, task, claim, m, files, 200)
	head := prdConfirm(t, f, task, "", false, 201)
	changed := m
	changed.FetchedAt = time.Now().UTC().Format(time.RFC3339Nano)
	prdUpload(t, f, task, claim, changed, files, 409)
	var alias prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", map[string]string{"url": "https://example.feishu.cn/wiki/WikiNodeToken123", "connectorId": f.registration.Connector.ID, "clientRequestId": "wiki-alias"}, nil, 202, &alias)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors/"+f.registration.Connector.ID+"/poll", map[string]any{}, map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}, 200, &claim)
	prdUpload(t, f, alias, claim, m, files, 200)
	repeated := prdConfirm(t, f, alias, head.ID, false, 200)
	if repeated.ID != head.ID {
		t.Fatal("Wiki alias duplicated actual document")
	}
	var second prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", map[string]string{"url": "https://example.feishu.cn/wiki/AnotherWikiNode", "connectorId": f.registration.Connector.ID, "clientRequestId": "different-wiki-source"}, nil, 202, &second)
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors/"+f.registration.Connector.ID+"/poll", map[string]any{}, map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}, 200, &claim)
	prdUpload(t, f, second, claim, other, altered, 200)
	response := prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+second.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head.ID}, nil, 409, nil)
	if !strings.Contains(response.Body.String(), "SOURCE_MISMATCH") {
		t.Fatal("Campaign accepted another Lark document")
	}
	// Browser sessions may use the platform UI, but cannot register a local executor.
	_, cookie, _ := registerAccount(t, f.app, "prd-browser", false)
	response = authCall(f.app, "POST", "/api/v1/lark-connectors", `{"name":"browser","protocolVersion":1,"larkCliVersion":"1.0.98"}`, "", cookie, "http://localhost:8765")
	if response.Code != 403 || !strings.Contains(response.Body.String(), "CONNECTOR_AUTH_REQUIRED") {
		t.Fatal("browser cookie registered a connector")
	}
}

func TestPRDRestartKeepsClaimAndCandidate(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "restart-claim")
	reopen := func() {
		t.Helper()
		if err := f.app.Close(); err != nil {
			t.Fatal(err)
		}
		app, err := api.OpenMySQL(t.TempDir(), f.dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { app.Close() })
		f.app = app
	}
	reopen()
	var renewed prd.Claim
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors/"+f.registration.Connector.ID+"/poll", map[string]any{"importId": task.ID, "attempt": claim.Attempt, "claimToken": claim.ClaimToken}, map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}, 200, &renewed)
	if renewed.ClaimToken != claim.ClaimToken || renewed.Attempt != claim.Attempt {
		t.Fatal("server restart lost active claim")
	}
	m, files := prdTestBundle(t, "1", "Restart requirement")
	prdUpload(t, f, task, claim, m, files, 200)
	reopen()
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-imports/"+task.ID+"/files/document.md", nil, nil, 404, nil)
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+task.ID+"/files/document.md", nil, nil, 200, nil)
	prdConfirm(t, f, task, "", false, 201)
	var queued prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", map[string]string{"url": task.URL, "connectorId": f.registration.Connector.ID, "clientRequestId": "expired-queue"}, nil, 202, &queued)
	before := time.Now().UTC().Add(-time.Second)
	if _, err := f.db.Exec("UPDATE prd_imports SET expires_at=?,payload=JSON_SET(payload,'$.expiresAt',?) WHERE id=?", before, before.Format(time.RFC3339Nano), queued.ID); err != nil {
		t.Fatal(err)
	}
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+queued.ID, nil, nil, 200, &queued)
	if queued.Status != "expired" || queued.ErrorCode != "PRD_IMPORT_EXPIRED" {
		t.Fatal("queued deadline was not enforced")
	}
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/lark-connectors/"+f.registration.Connector.ID+"/poll", map[string]any{}, map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}, 204, nil)
}

func TestPRDTasksStayWithChosenReader(t *testing.T) {
	f := newPRDFixture(t)
	input := map[string]string{"url": "https://example.feishu.cn/docx/DocToken123?share=1#share-anchor", "connectorId": f.registration.Connector.ID, "clientRequestId": "first-request"}
	var task prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", input, nil, 202, &task)
	if task.URL != "https://example.feishu.cn/docx/DocToken123" || task.Status != "queued" {
		t.Fatal("URL was not normalized or import was not queued")
	}
	var repeated prd.Import
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", input, nil, 202, &repeated)
	if repeated.ID != task.ID {
		t.Fatal("duplicate task created")
	}
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-imports/"+task.ID, nil, nil, 404, nil)
	prdJSON(t, f.app, f.bob, "POST", "/api/v1/campaigns/"+f.campaign+"/prd-imports", input, nil, 404, nil)
	path := "/api/v1/lark-connectors/" + f.registration.Connector.ID + "/poll"
	prdJSON(t, f.app, f.alice, "POST", path, map[string]any{}, nil, 403, nil)
	var claim prd.Claim
	headers := map[string]string{"X-Acceptances-Connector-Token": f.registration.ConnectorToken}
	prdJSON(t, f.app, f.alice, "POST", path, map[string]any{}, headers, 200, &claim)
	if claim.ImportID != task.ID || claim.Attempt != 1 || claim.ClaimToken == "" {
		t.Fatal("invalid private claim")
	}
	prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/cancel", map[string]any{}, nil, http.StatusNoContent, nil)
	prdJSON(t, f.app, f.alice, "POST", path, map[string]any{"importId": task.ID, "attempt": claim.Attempt, "claimToken": claim.ClaimToken}, headers, 409, nil)
	prdJSON(t, f.app, f.alice, "GET", "/api/v1/prd-imports/"+task.ID, nil, nil, 200, &task)
	if task.Status != "cancelled" {
		t.Fatal("cancellation was not retained")
	}
}

func TestPRDConnectorIsPrivate(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	alice, _, _ := registerAccount(t, app, "prd-alice", true)
	bob, _, _ := registerAccount(t, app, "prd-bob", true)
	response := authCall(app, "POST", "/api/v1/lark-connectors", `{"name":"Alice laptop","protocolVersion":1,"larkCliVersion":"1.0.98"}`, alice, nil, "")
	if response.Code != 201 {
		t.Fatalf("register connector: %d %s", response.Code, response.Body.String())
	}
	var registration prd.Registration
	if err := json.Unmarshal(response.Body.Bytes(), &registration); err != nil || registration.Connector.ID == "" || registration.ConnectorToken == "" || !registration.Connector.Online {
		t.Fatalf("invalid connector registration: %v", err)
	}
	response = authCall(app, "GET", "/api/v1/lark-connectors", "", bob, nil, "")
	var list struct{ Items []prd.Connector }
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &list) != nil || len(list.Items) != 0 {
		t.Fatalf("other member sees private connector: %d", response.Code)
	}
	response = authCall(app, "DELETE", "/api/v1/lark-connectors/"+registration.Connector.ID, "", bob, nil, "")
	if response.Code != 404 {
		t.Fatalf("other member disconnected private connector: %d", response.Code)
	}
	response = authCall(app, "DELETE", "/api/v1/lark-connectors/"+registration.Connector.ID, "", alice, nil, "")
	if response.Code != 204 {
		t.Fatalf("disconnect own connector: %d", response.Code)
	}
}
