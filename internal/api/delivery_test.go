package api_test

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestDeliveryFreezeGates(t *testing.T) {
	cases := []struct {
		name   string
		change func(*deliveryFixture)
		code   string
	}{
		{"partial", func(f *deliveryFixture) { f.Report.ScopeType = "partial" }, "FULL_SCOPE_REQUIRED"},
		{"unknown-commit", func(f *deliveryFixture) { f.Report.Versions[0].Commit = "unknown" }, "SOURCE_IDENTITY_REQUIRED"},
		{"dirty", func(f *deliveryFixture) { dirty := true; f.Report.Versions[0].Dirty = &dirty }, "SOURCE_IDENTITY_REQUIRED"},
		{"dirty-unknown", func(f *deliveryFixture) { f.Report.Versions[0].Dirty = nil }, "SOURCE_IDENTITY_REQUIRED"},
		{"missing-check", func(f *deliveryFixture) {
			f.Map.Features[0].Checks = append(f.Map.Features[0].Checks, api.MapCheck{ID: "fixture-export--missing", Title: "Missing", Expected: "Exists", Required: true})
		}, "DELIVERY_MATERIALS_INVALID"},
		{"mismatched-expected", func(f *deliveryFixture) { f.Map.Features[0].Checks[0].Expected = "Different behavior" }, "DELIVERY_MATERIALS_INVALID"},
		{"cross-project", func(f *deliveryFixture) { f.Map.ProjectID = "other-project" }, "DELIVERY_MATERIALS_INVALID"},
		{"duplicate-feature", func(f *deliveryFixture) { f.Map.Features = append(f.Map.Features, f.Map.Features[0]) }, "DELIVERY_MATERIALS_INVALID"},
		{"build-unknown", func(f *deliveryFixture) { f.Manifest.Build.ID = "unknown" }, "DELIVERY_MATERIALS_INVALID"},
		{"no-build-unknown", func(f *deliveryFixture) {
			f.Manifest.Build = api.BuildIdentity{Kind: "not-applicable", Sources: f.Report.Versions, Reason: " Unknown "}
		}, "DELIVERY_MATERIALS_INVALID"},
		{"screenshot-unrelated", func(f *deliveryFixture) { f.Report.Checks[0].Evidence = []string{} }, "DELIVERY_MATERIALS_INVALID"},
		{"missing-materials-feature", func(f *deliveryFixture) { f.Materials.Features = nil }, "DELIVERY_MATERIALS_INVALID"},
		{"svg-screenshot", func(f *deliveryFixture) { f.Files["screen.png"] = `<svg onload="alert(1)"></svg>` }, "DELIVERY_MATERIALS_INVALID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, pid, cid, _ := deliveryTestSetup(t)
			f := newDeliveryFixture(t, pid, cid)
			tc.change(&f)
			f.finalize(t)
			runID := publishDeliveryFixture(t, app, cid, tc.name, f)
			request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
			prep := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
			if prep["eligible"] != false || !strings.Contains(fixtureJSON(t, prep["issues"]), tc.code) {
				t.Fatal(prep)
			}
			input := preparedFreeze(t, app, runID, "freeze-"+tc.name)
			request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 409)
		})
	}
}

func TestDeliveryRequiresExplicitConfirmationsAndExceptionReasons(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.Report.Checks[0].Status = "blocked"
	f.Materials.Features[0].Limitations = []string{"Environment prevented execution; behavior is not verified."}
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "exception", f)
	input := preparedFreeze(t, app, runID, "freeze-exception")
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 409)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	input = preparedFreeze(t, app, runID, "freeze-exception")
	input.MapConfirmed = false
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 400)
	input.MapConfirmed = true
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 400)
	input.ExceptionReasons["fixture-export--download"] = "Explicitly accept documented environment limitation."
	snapshot := request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 201)
	if snapshot["payload"].(map[string]any)["run"].(map[string]any)["report"].(map[string]any)["checks"].([]any)[0].(map[string]any)["status"] != "blocked" {
		t.Fatal(snapshot)
	}
}

func TestDeliveryIdempotencyStaleConfirmationsAndSupersession(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "first", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	input := preparedFreeze(t, app, runID, "freeze-first")
	one := request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 201)
	replay := request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 200)
	if one["id"] != replay["id"] {
		t.Fatal("duplicate freeze")
	}
	input.RequestID = "freeze-alias"
	alias := request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 200)
	if alias["id"] != one["id"] {
		t.Fatal("equivalent click duplicated snapshot")
	}
	input.MaterialsConfirmed = false
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 409)
	stale := preparedFreeze(t, app, runID, "stale")
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"kind":"comment","body":"Additional audit context"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, stale), 409)
	secondID := publishDeliveryFixture(t, app, cid, "second", f)
	old := request(t, app, "GET", "/api/v1/deliveries/"+one["id"].(string), "", 200)
	if old["status"] != "valid" {
		t.Fatal("new Run invalidated historical version")
	}
	prep := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	if prep["eligible"] != false {
		t.Fatal("historical Run can freeze")
	}
	request(t, app, "POST", "/api/v1/runs/"+secondID+"/accept-all", `{}`, 200)
	two := freezeFixture(t, app, secondID, "freeze-second")
	old = request(t, app, "GET", "/api/v1/deliveries/"+one["id"].(string), "", 200)
	if old["status"] != "superseded" || old["successorId"] != two["id"] || old["sha256"] != one["sha256"] {
		t.Fatal(old)
	}
}

func TestDeliveryJudgmentWithdrawalNeverMutatesOrRestoresSnapshot(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "withdrawal", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	one := freezeFixture(t, app, runID, "freeze-withdrawal")
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"checkId":"fixture-export--download","kind":"pending"}`, 201)
	old := request(t, app, "GET", "/api/v1/deliveries/"+one["id"].(string), "", 200)
	if old["status"] != "invalidated" || old["sha256"] != one["sha256"] || fixtureJSON(t, old["payload"]) != fixtureJSON(t, one["payload"]) {
		t.Fatal(old)
	}
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	old = request(t, app, "GET", "/api/v1/deliveries/"+one["id"].(string), "", 200)
	if old["status"] != "invalidated" {
		t.Fatal("acceptance resurrected frozen delivery")
	}
	two := freezeFixture(t, app, runID, "explicit-refreeze")
	if two["version"] != float64(2) || two["id"] == one["id"] {
		t.Fatal(two)
	}
	db, err := sql.Open("mysql", archiveDSN(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec("UPDATE delivery_snapshots SET payload='{}' WHERE id=?", one["id"]); err == nil {
		t.Fatal("frozen payload can be overwritten")
	}
	if _, err = db.Exec("DELETE FROM delivery_snapshots WHERE id=?", one["id"]); err == nil {
		t.Fatal("delivery can be deleted")
	}
}

func TestConcurrentFreezeAndAtomicFailure(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "atomic", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	input := preparedFreeze(t, app, runID, "atomic-freeze")
	db, err := sql.Open("mysql", archiveDSN(t, dir))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER fail_freeze BEFORE INSERT ON delivery_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure';`); err != nil {
		t.Fatal(err)
	}
	request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 500)
	list := request(t, app, "GET", "/api/v1/deliveries", "", 200)
	if len(list["items"].([]any)) != 0 {
		t.Fatal("partial delivery visible")
	}
	entries, err := os.ReadDir(filepath.Join(dir, "deliveries"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("partial evidence remains: %v %v", entries, err)
	}
	if _, err = db.Exec("DROP TRIGGER fail_freeze"); err != nil {
		t.Fatal(err)
	}
	body := fixtureJSON(t, input)
	var wait sync.WaitGroup
	results := make(chan string, 8)
	for range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			w := httptest.NewRecorder()
			authenticatedHandler(t, app).ServeHTTP(w, localRequest("POST", "/api/v1/runs/"+runID+"/deliveries", strings.NewReader(body)))
			if w.Code != 200 && w.Code != 201 {
				results <- "error:" + w.Body.String()
				return
			}
			var value map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
				results <- "error:json"
				return
			}
			results <- value["id"].(string)
		}()
	}
	wait.Wait()
	close(results)
	key := ""
	for result := range results {
		if strings.HasPrefix(result, "error:") {
			t.Fatal(result)
		}
		if key != "" && key != result {
			t.Fatal("concurrent request duplicated snapshot")
		}
		key = result
	}
}
