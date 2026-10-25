package api_test

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func moveTarget(t *testing.T, app *api.Server, pid string) string {
	t.Helper()
	return request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Independent requirement"}`, 201)["id"].(string)
}
func moveInput(t *testing.T, from, to, key string) string {
	t.Helper()
	return fixtureJSON(t, api.MoveRunInput{RequestID: key, FromCampaignID: from, ToCampaignID: to, Reason: "Correct requirement ownership; retain original verification"})
}
func readRun(t *testing.T, app *api.Server, key string) map[string]any {
	t.Helper()
	return request(t, app, "GET", "/api/v1/runs/"+key, "", 200)
}
func assertSameRunFacts(t *testing.T, before, after map[string]any) {
	t.Helper()
	for key, value := range before {
		if key == "campaignId" || key == "moves" {
			continue
		}
		if !reflect.DeepEqual(value, after[key]) {
			t.Fatalf("Run fact changed: %s", key)
		}
	}
}

func TestMoveRunRetainsFactsEvidenceReviewsAndDeliveryBindings(t *testing.T) {
	app, pid, source, dir := deliveryTestSetup(t)
	target := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, source)
	f.finalize(t)
	old := publishDeliveryFixture(t, app, source, "historical", f)
	request(t, app, "POST", "/api/v1/runs/"+old+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, old, "historical-freeze")
	runID := publishDeliveryFixture(t, app, source, "moving", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"kind":"comment","body":"Keep original comment"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"checkId":"fixture-export--download","kind":"accepted","body":"Original review"}`, 201)
	before := readRun(t, app, runID)
	prepBefore := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	var storedReport, hash, submission, created string
	db, err := sql.Open("mysql", archiveDSN(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.QueryRow("SELECT report,hash,submission_id,created_at FROM runs WHERE id=?", runID).Scan(&storedReport, &hash, &submission, &created); err != nil {
		t.Fatal(err)
	}
	body := moveInput(t, source, target, "move-original")
	receipt := request(t, app, "POST", "/api/v1/runs/"+runID+"/move", body, 201)
	after := readRun(t, app, runID)
	assertSameRunFacts(t, before, after)
	if after["campaignId"] != target || len(after["moves"].([]any)) != 1 {
		t.Fatal("missing ownership or audit")
	}
	for name, data := range f.Files {
		archived, err := os.ReadFile(filepath.Join(dir, "evidence", runID, name))
		if err != nil || string(archived) != data {
			t.Fatalf("evidence changed: %s %v", name, err)
		}
		w := httptest.NewRecorder()
		authenticatedHandler(t, app).ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+runID+"/evidence/"+name, nil))
		if w.Code != 200 || w.Body.String() != data {
			t.Fatalf("evidence API changed: %s", name)
		}
	}
	var newReport, newHash, newSubmission, newCreated string
	if err = db.QueryRow("SELECT report,hash,submission_id,created_at FROM runs WHERE id=?", runID).Scan(&newReport, &newHash, &newSubmission, &newCreated); err != nil {
		t.Fatal(err)
	}
	if storedReport != newReport || hash != newHash || submission != newSubmission || created != newCreated {
		t.Fatal("immutable storage changed")
	}
	a := request(t, app, "GET", "/api/v1/campaigns/"+source, "", 200)
	b := request(t, app, "GET", "/api/v1/campaigns/"+target, "", 200)
	if a["latestRunId"] != old || a["status"] != "accepted" || b["latestRunId"] != runID || b["status"] != "accepted" {
		t.Fatal(a, b)
	}
	historical := request(t, app, "GET", "/api/v1/deliveries/"+snapshot["id"].(string), "", 200)
	if !reflect.DeepEqual(snapshot, historical) {
		t.Fatal("historical delivery changed")
	}
	replay := request(t, app, "POST", "/api/v1/runs/"+runID+"/move", body, 200)
	if !reflect.DeepEqual(receipt, replay) {
		t.Fatal("move retry changed receipt")
	}
	retried := upload(t, app, source, "moving", fixtureJSON(t, f.Report), f.Files, 200)
	assertSameRunFacts(t, after, retried)
	if retried["campaignId"] != target {
		t.Fatal("publish retry lost actual Campaign")
	}
	upload(t, app, target, "moving", fixtureJSON(t, f.Report), f.Files, 409)
	changed := map[string]string{}
	for k, v := range f.Files {
		changed[k] = v
	}
	changed["build.txt"] = "changed"
	upload(t, app, source, "moving", fixtureJSON(t, f.Report), changed, 409)
	prepAfter := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	if prepAfter["eligible"] != true || prepAfter["token"] == prepBefore["token"] {
		t.Fatal("moved materials invalid or stale token accepted", prepAfter)
	}
	// A stale pre-move freeze confirmation must fail, without freezing anything.
	input := api.FreezeDeliveryInput{RequestID: "stale-move", Token: prepBefore["token"].(string), MapConfirmed: true, MaterialsConfirmed: true, SensitiveInfoReviewed: true, ExceptionReasons: map[string]string{}}
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 409)
	newerSnapshot := freezeFixture(t, app, runID, "target-freeze")
	if newerSnapshot["payload"].(map[string]any)["campaign"].(map[string]any)["id"] != target {
		t.Fatal("new snapshot wrong Campaign")
	}
	if !reflect.DeepEqual(snapshot, request(t, app, "GET", "/api/v1/deliveries/"+snapshot["id"].(string), "", 200)) {
		t.Fatal("target freeze altered source history")
	}
}

func TestMoveRunGuardsAndPublicationOrder(t *testing.T) {
	app, pid, source, _ := deliveryTestSetup(t)
	target := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, source)
	f.Manifest.CampaignID = "unrelated"
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, source, "bad-manifest", f)
	newer := publishDeliveryFixture(t, app, target, "newer", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, source, target, "old-to-new"), 201)
	for _, campaign := range []string{source, target} {
		c := request(t, app, "GET", "/api/v1/campaigns/"+campaign, "", 200)
		expected := ""
		if campaign == target {
			expected = newer
		}
		if c["latestRunId"] != expected || c["status"] != "pending" {
			t.Fatal("latest changed to older imported Run", c)
		}
	}
	prep := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	if !strings.Contains(fixtureJSON(t, prep["issues"]), "DELIVERY_MATERIALS_INVALID") {
		t.Fatal("migration bypassed invalid manifest")
	}
	third := moveTarget(t, app, pid)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, source, third, "stale-source"), 409)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, target, third, "old-to-new"), 409)
	otherProject := request(t, app, "POST", "/api/v1/projects", `{"name":"Other"}`, 201)["id"].(string)
	other := moveTarget(t, app, otherProject)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, target, other, "cross-project"), 409)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, target, target, "same"), 400)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, target, "missing", "missing-target"), 404)
	request(t, app, "POST", "/api/v1/runs/missing/move", moveInput(t, target, third, "missing-run"), 404)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", `{"fromCampaignId":"x","toCampaignId":"y","requestId":"empty-reason"}`, 400)
	if len(readRun(t, app, runID)["moves"].([]any)) != 1 {
		t.Fatal("failed request appended move")
	}
}

func TestMoveRunFrozenAndFeedbackLinksAreProtected(t *testing.T) {
	app, pid, source, _ := deliveryTestSetup(t)
	target := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, source)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, source, "frozen", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	freezeFixture(t, app, runID, "freeze")
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, source, target, "frozen-valid"), 409)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"checkId":"fixture-export--download","kind":"pending"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, source, target, "frozen-invalid"), 409)
	parent := publishDeliveryFixture(t, app, source, "parent", f)
	f.Report.FollowUp = &api.FollowUp{SourceRunID: parent, Responses: []api.FeedbackResponse{}}
	child := publishDeliveryFixture(t, app, source, "child", f)
	for _, key := range []string{parent, child} {
		result := request(t, app, "POST", "/api/v1/runs/"+key+"/move", moveInput(t, source, target, "linked-"+key), 409)
		if result["code"] != "RUN_HAS_FEEDBACK_LINKS" {
			t.Fatal(result)
		}
	}
}

func TestMoveRunAtomicRetryAndReopen(t *testing.T) {
	app, pid, source, dir := deliveryTestSetup(t)
	target := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, source)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, source, "atomic-move", f)
	db, err := sql.Open("mysql", archiveDSN(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER fail_move BEFORE INSERT ON run_moves FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure';`); err != nil {
		t.Fatal(err)
	}
	body := moveInput(t, source, target, "atomic-request")
	request(t, app, "POST", "/api/v1/runs/"+runID+"/move", body, 500)
	if readRun(t, app, runID)["campaignId"] != source {
		t.Fatal("partial ownership mutation")
	}
	if request(t, app, "GET", "/api/v1/campaigns/"+target, "", 200)["latestRunId"] != "" {
		t.Fatal("partial target mutation")
	}
	if _, err = db.Exec("DROP TRIGGER fail_move"); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	results := make(chan map[string]any, 6)
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			w := httptest.NewRecorder()
			authenticatedHandler(t, app).ServeHTTP(w, localRequest("POST", "/api/v1/runs/"+runID+"/move", strings.NewReader(body)))
			var v map[string]any
			json.Unmarshal(w.Body.Bytes(), &v)
			if w.Code != 200 && w.Code != 201 {
				v["error"] = w.Code
			}
			results <- v
		}()
	}
	wait.Wait()
	close(results)
	key := ""
	for v := range results {
		if v["error"] != nil {
			t.Fatal(v)
		}
		m := v["move"].(map[string]any)["id"].(string)
		if key != "" && key != m {
			t.Fatal("duplicate migration")
		}
		key = m
	}
	if len(readRun(t, app, runID)["moves"].([]any)) != 1 {
		t.Fatal("duplicate audit")
	}
	if _, err = db.Exec("UPDATE run_moves SET reason='overwrite'"); err == nil {
		t.Fatal("audit mutable")
	}
	app.Close()
	reopened, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	saved := readRun(t, reopened, runID)
	if saved["campaignId"] != target || len(saved["moves"].([]any)) != 1 {
		t.Fatal("move not durable")
	}
	request(t, reopened, "POST", "/api/v1/runs/"+runID+"/move", body, 200)
	third := moveTarget(t, reopened, pid)
	request(t, reopened, "POST", "/api/v1/runs/"+runID+"/move", moveInput(t, target, third, "second-move"), 201)
	prep := request(t, reopened, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	if strings.Contains(fixtureJSON(t, prep["issues"]), "DELIVERY_MATERIALS_INVALID") {
		t.Fatal("multi-move provenance broken")
	}
}
