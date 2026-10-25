package api_test

import (
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBusinessDocumentOfflineSafeAndIndependentlyVersioned(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.Materials.Features[0].Summary = "<script>globalThis.injected=true</script>"
	f.Materials.Features[0].Screenshots[0].Caption = "<img src=\"https://example.invalid/x\" onerror=\"alert(1)\">"
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "document-safe", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", "{}", 200)
	runBefore := request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)
	snapshot := freezeFixture(t, app, runID, "freeze-safe-document")
	deliveryID := snapshot["id"].(string)
	document := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"document-one\"}", 201)
	if document["status"] != "succeeded" || document["version"] != float64(1) || document["sha256"] == "" {
		t.Fatal(document)
	}
	documentID := document["id"].(string)
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/documents/"+documentID+"/html?download=1", nil))
	html := w.Body.String()
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal(w.Code, w.Header())
	}
	if strings.Contains(html, "<script>") || strings.Contains(html, "<img src=\"https:") || !strings.Contains(html, "&lt;script&gt;") || !strings.Contains(html, "data:image/png;base64,") || !strings.Contains(html, "受验提交") {
		t.Fatal(html)
	}
	if !strings.Contains(html, "data:font/woff2;base64,") || strings.Contains(html, `url("/fonts/`) || !strings.Contains(html, "SIL OPEN FONT LICENSE") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "font-src data:") || document["templateVersion"] != "test-report-html-v1" {
		t.Fatal("offline document must embed licensed Geist fonts and use the current template")
	}
	if fixtureDigest(html) != document["sha256"] {
		t.Fatal("document digest mismatch")
	}
	replay := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"document-one\"}", 200)
	if replay["id"] != document["id"] {
		t.Fatal("document request duplicated version")
	}
	two := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"document-two\"}", 201)
	if two["version"] != float64(2) || two["id"] == document["id"] {
		t.Fatal(two)
	}
	beforeAgain := request(t, app, "GET", "/api/v1/documents/"+documentID, "", 200)
	if beforeAgain["sha256"] != document["sha256"] {
		t.Fatal("successful version overwritten")
	}
	runAfter := request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)
	if fixtureJSON(t, runAfter) != fixtureJSON(t, runBefore) {
		t.Fatal("document generation mutated Run")
	}
	copy := request(t, app, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
	if copy["sha256"] != snapshot["sha256"] || fixtureJSON(t, copy["payload"]) != fixtureJSON(t, snapshot["payload"]) {
		t.Fatal("document generation mutated snapshot")
	}
}

func TestDeliverySourceDeletionPreservesSnapshotsEvidenceAndDocuments(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "retention", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", "{}", 200)
	snapshot := freezeFixture(t, app, runID, "freeze-retention")
	deliveryID := snapshot["id"].(string)
	document := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"retained-document\"}", 201)
	preview := request(t, app, "GET", "/api/v1/projects/"+pid+"/delete-preview", "", 200)
	if preview["retainedDeliveries"] != float64(1) || preview["retainedDocuments"] != float64(1) {
		t.Fatal(preview)
	}
	request(t, app, "DELETE", "/api/v1/projects/"+pid, "", 204)
	copy := request(t, app, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
	if copy["status"] != "invalidated" || copy["sourceRunAvailable"] != false || copy["sha256"] != snapshot["sha256"] {
		t.Fatal(copy)
	}
	for _, path := range []string{"/api/v1/deliveries/" + deliveryID + "/evidence/screen.png", "/api/v1/documents/" + document["id"].(string) + "/html"} {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("GET", path, nil))
		if w.Code != 200 || w.Body.Len() == 0 {
			t.Fatal(path, w.Code)
		}
	}
	list := request(t, app, "GET", "/api/v1/deliveries?projectId="+pid, "", 200)
	if len(list["items"].([]any)) != 1 {
		t.Fatal("deleted project archive inaccessible")
	}
	request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"inactive-document\"}", 409)
}

func TestFailedDocumentRetriesSameVersionAndRestartRecoversGenerating(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "retry-document", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", "{}", 200)
	snapshot := freezeFixture(t, app, runID, "freeze-retry-document")
	deliveryID := snapshot["id"].(string)
	imagePath := filepath.Join(dir, "deliveries", deliveryID, "evidence", "screen.png")
	if err := os.WriteFile(imagePath, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	request(t, app, "GET", "/api/v1/deliveries/"+deliveryID+"/evidence/screen.png", "", 409)
	failed := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", "{\"requestId\":\"failed-document\"}", 200)
	if failed["status"] != "failed" || failed["error"] == "" {
		t.Fatal(failed)
	}
	request(t, app, "GET", "/api/v1/documents/"+failed["id"].(string)+"/html", "", 409)
	if err := os.WriteFile(imagePath, []byte(f.Files["screen.png"]), 0600); err != nil {
		t.Fatal(err)
	}
	retried := request(t, app, "POST", "/api/v1/documents/"+failed["id"].(string)+"/retry", "{}", 201)
	if retried["id"] != failed["id"] || retried["version"] != failed["version"] || retried["attempts"] != float64(2) || retried["status"] != "succeeded" {
		t.Fatal(retried)
	}
	db, err := sql.Open("mysql", archiveDSN(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO business_documents(id,delivery_id,version,request_id,template_version,status,created_at) VALUES('interrupted',?,2,'interrupted-request',?,'generating','2026-10-13T09:00:00Z')", deliveryID, retried["templateVersion"]); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(dir, ".document-interrupted"), 0700); err != nil {
		t.Fatal(err)
	}
	db.Close()
	app.Close()
	reopened, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	interrupted := request(t, reopened, "GET", "/api/v1/documents/interrupted", "", 200)
	if interrupted["status"] != "failed" || !strings.Contains(interrupted["error"].(string), "重启") {
		t.Fatal(interrupted)
	}
	if _, err = os.Stat(filepath.Join(dir, ".document-interrupted")); !os.IsNotExist(err) {
		t.Fatal("interrupted stage was not cleaned")
	}
	result := request(t, reopened, "POST", "/api/v1/documents/interrupted/retry", "{}", 201)
	if result["version"] != float64(2) || result["attempts"] != float64(2) {
		t.Fatal(result)
	}
}

func TestDeliveryVoidRevokeAndDocumentRequestConflict(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "revoke", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", "{}", 200)
	one := freezeFixture(t, app, runID, "revoke-freeze")
	firstID := one["id"].(string)
	request(t, app, "POST", "/api/v1/deliveries/"+firstID+"/documents", "{\"requestId\":\"document-global-key\"}", 201)
	request(t, app, "POST", "/api/v1/deliveries/"+firstID+"/revoke", "{\"reason\":\"Wrong delivery scope\"}", 200)
	two := freezeFixture(t, app, runID, "revoke-refreeze")
	request(t, app, "POST", "/api/v1/deliveries/"+two["id"].(string)+"/documents", "{\"requestId\":\"document-global-key\"}", 409)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/void", "{\"reason\":\"Wrong environment\"}", 200)
	copy := request(t, app, "GET", "/api/v1/deliveries/"+two["id"].(string), "", 200)
	if copy["status"] != "invalidated" {
		t.Fatal(copy)
	}
}
