package api_test

import (
	"database/sql"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func consolidateBody(t *testing.T, source, from, key string) string {
	t.Helper()
	return fixtureJSON(t, api.ConsolidateRunInput{RequestID: key, SourceRunID: source, FromCampaignID: from, Reason: "Group earlier verification under complete current report; preserve facts"})
}

func TestConsolidationPreservesFactsHistoryAndEvidence(t *testing.T) {
	app, pid, from, dir := deliveryTestSetup(t)
	to := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, from)
	f.finalize(t)
	history := publishDeliveryFixture(t, app, from, "historic", f)
	request(t, app, "POST", "/api/v1/runs/"+history+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, history, "historic-delivery")
	source := publishDeliveryFixture(t, app, from, "early", f)
	request(t, app, "POST", "/api/v1/runs/"+source+"/reviews", `{"kind":"comment","body":"Retain early problem"}`, 201)
	primary := publishDeliveryFixture(t, app, to, "complete", f)
	beforeSource, beforePrimary := readRun(t, app, source), readRun(t, app, primary)
	beforePrep := request(t, app, "GET", "/api/v1/runs/"+primary+"/delivery-preparation", "", 200)
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var raw, hash, submission, created string
	if err = db.QueryRow("SELECT report,hash,submission_id,created_at FROM runs WHERE id=?", source).Scan(&raw, &hash, &submission, &created); err != nil {
		t.Fatal(err)
	}
	body := consolidateBody(t, source, from, "merge-original")
	receipt := request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", body, 201)
	afterSource, afterPrimary := readRun(t, app, source), readRun(t, app, primary)
	assertSameRunFacts(t, beforeSource, afterSource)
	assertSameRunFacts(t, beforePrimary, afterPrimary)
	if afterSource["campaignId"] != to || afterSource["consolidatedInto"].(map[string]any)["primaryRunId"] != primary {
		t.Fatal(afterSource)
	}
	if len(afterPrimary["consolidatedRuns"].([]any)) != 1 {
		t.Fatal(afterPrimary)
	}
	for name, data := range f.Files {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+source+"/evidence/"+name, nil))
		if w.Code != 200 || w.Body.String() != data {
			t.Fatalf("source evidence changed %s", name)
		}
	}
	var gotRaw, gotHash, gotSubmission, gotCreated string
	if err = db.QueryRow("SELECT report,hash,submission_id,created_at FROM runs WHERE id=?", source).Scan(&gotRaw, &gotHash, &gotSubmission, &gotCreated); err != nil {
		t.Fatal(err)
	}
	if raw != gotRaw || hash != gotHash || submission != gotSubmission || created != gotCreated {
		t.Fatal("immutable source storage changed")
	}
	visible := request(t, app, "GET", "/api/v1/campaigns/"+to+"/runs", "", 200)["items"].([]any)
	archived := request(t, app, "GET", "/api/v1/campaigns/"+to+"/runs?includeArchived=true", "", 200)["items"].([]any)
	if len(visible) != 1 || visible[0].(map[string]any)["id"] != primary || len(archived) != 2 {
		t.Fatal("wrong grouped list")
	}
	campaign := request(t, app, "GET", "/api/v1/campaigns/"+from, "", 200)
	if campaign["latestRunId"] != history || campaign["status"] != "accepted" {
		t.Fatal("source delivery not restored", campaign)
	}
	if !reflect.DeepEqual(snapshot, request(t, app, "GET", "/api/v1/deliveries/"+snapshot["id"].(string), "", 200)) {
		t.Fatal("history delivery changed")
	}
	if !reflect.DeepEqual(receipt, request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", body, 200)) {
		t.Fatal("retry not idempotent")
	}
	for _, op := range []struct{ path, body string }{{"accept-all", `{}`}, {"reviews", `{"kind":"comment","body":"Cannot change archived record"}`}, {"void", `{"reason":"Cannot change archive"}`}} {
		request(t, app, "POST", "/api/v1/runs/"+source+"/"+op.path, op.body, 409)
	}
	for _, key := range []string{source, primary} {
		request(t, app, "DELETE", "/api/v1/runs/"+key, "", 409)
		request(t, app, "POST", "/api/v1/runs/"+key+"/move", moveInput(t, to, from, "split-"+key), 409)
	}
	prep := request(t, app, "GET", "/api/v1/runs/"+primary+"/delivery-preparation", "", 200)
	if prep["token"] == beforePrep["token"] {
		t.Fatal("stale confirmation token")
	}
	if _, err = db.Exec("UPDATE run_consolidations SET reason='changed'"); err == nil {
		t.Fatal("audit mutable")
	}
	app.Close()
	reopened, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(afterSource, readRun(t, reopened, source)) || !reflect.DeepEqual(afterPrimary, readRun(t, reopened, primary)) {
		t.Fatal("archive not durable")
	}
}

func TestConsolidationRejectsMismatchedCoverageAndFrozenRuns(t *testing.T) {
	for _, scenario := range []string{"status", "expected", "version", "scope", "environment", "newer-source", "frozen-primary", "frozen-source", "cross-project", "stale-source", "feedback"} {
		t.Run(scenario, func(t *testing.T) {
			app, pid, from, _ := deliveryTestSetup(t)
			to := moveTarget(t, app, pid)
			f := newDeliveryFixture(t, pid, from)
			f.finalize(t)
			source := publishDeliveryFixture(t, app, from, "source", f)
			switch scenario {
			case "status":
				f.Report.Checks[0].Status = "failed"
			case "expected":
				f.Report.Checks[0].Expected = "different"
			case "version":
				f.Report.Versions[0].Commit = strings.Repeat("b", 40)
			case "scope":
				f.Report.ScopeType = "partial"
			case "environment":
				f.Report.Environment = "different"
			case "feedback":
				f.Report.FollowUp = &api.FollowUp{SourceRunID: source, Responses: []api.FeedbackResponse{}}
				to = from
			case "cross-project":
				other := request(t, app, "POST", "/api/v1/projects", `{"name":"Other"}`, 201)["id"].(string)
				to = moveTarget(t, app, other)
			}
			if scenario == "frozen-primary" {
				f.Manifest.CampaignID = to
			}
			f.finalize(t)
			primary := publishDeliveryFixture(t, app, to, "primary", f)
			if scenario == "newer-source" {
				source = publishDeliveryFixture(t, app, from, "late", f)
			}
			if scenario == "frozen-primary" || scenario == "frozen-source" {
				key := primary
				if scenario == "frozen-source" {
					key = source
				}
				request(t, app, "POST", "/api/v1/runs/"+key+"/accept-all", `{}`, 200)
				freezeFixture(t, app, key, "freeze")
			}
			expectedFrom := from
			if scenario == "stale-source" {
				expectedFrom = "changed"
			}
			request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", consolidateBody(t, source, expectedFrom, "guard"), 409)
			if readRun(t, app, source)["campaignId"] != from || readRun(t, app, source)["consolidatedInto"] != nil {
				t.Fatal("guard mutated source")
			}
		})
	}
}

func TestConsolidationRollbackConcurrencyAndConflict(t *testing.T) {
	app, pid, from, dir := deliveryTestSetup(t)
	to := moveTarget(t, app, pid)
	f := newDeliveryFixture(t, pid, from)
	f.finalize(t)
	source := publishDeliveryFixture(t, app, from, "source", f)
	primary := publishDeliveryFixture(t, app, to, "primary", f)
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER fail_consolidation BEFORE INSERT ON run_consolidations BEGIN SELECT RAISE(ABORT,'injected failure'); END;`); err != nil {
		t.Fatal(err)
	}
	body := consolidateBody(t, source, from, "atomic")
	request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", body, 500)
	after := readRun(t, app, source)
	if after["campaignId"] != from || after["moves"] != nil {
		t.Fatal("migration not rolled back")
	}
	if _, err = db.Exec("DROP TRIGGER fail_consolidation"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 5)
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			app.Handler().ServeHTTP(w, localRequest("POST", "/api/v1/runs/"+primary+"/consolidate", strings.NewReader(body)))
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)
	created := 0
	for code := range codes {
		if code == 201 {
			created++
		} else if code != 200 {
			t.Fatal(code)
		}
	}
	if created != 1 {
		t.Fatal("non-atomic retry", created)
	}
	request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", strings.Replace(body, "Group earlier", "Changed", 1), 409)
	request(t, app, "POST", "/api/v1/runs/"+primary+"/consolidate", consolidateBody(t, source, to, "second"), 409)
}

func TestConsolidationVersionFiveUpgradePreservesFacts(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	key := publishDeliveryFixture(t, app, cid, "v5", f)
	before := readRun(t, app, key)
	app.Close()
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE run_consolidations; PRAGMA user_version=5;"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	upgraded, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	if !reflect.DeepEqual(before, readRun(t, upgraded, key)) {
		t.Fatal("upgrade changed facts")
	}
	paths, err := filepath.Glob(filepath.Join(dir, "archive.before-v6.*.db"))
	if err != nil || len(paths) != 1 {
		t.Fatal("missing v5 backup", paths, err)
	}
	backup, err := sql.Open("sqlite", paths[0])
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var version, count int
	if err = backup.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 5 {
		t.Fatal(version, err)
	}
	if err = backup.QueryRow("SELECT COUNT(*) FROM runs WHERE id=?", key).Scan(&count); err != nil || count != 1 {
		t.Fatal("backup missing Run")
	}
	upgraded.Close()
	again, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	paths, err = filepath.Glob(filepath.Join(dir, "archive.before-v6.*.db"))
	if err != nil || len(paths) != 1 {
		t.Fatal("upgrade repeated")
	}
}
