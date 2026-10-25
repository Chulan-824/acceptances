package api_test

import (
	"database/sql"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestAcceptAllPreservesHistoryAndOnlyAcceptsRemainingItems(t *testing.T) {
	app, _, cid := setup(t)
	run := upload(t, app, cid, "bulk-history", reviewReport(t, "full", "passed", "failed", "blocked", "skipped"), map[string]string{"log.txt": "original observations"}, 201)
	rid := run["id"].(string)
	path := "/api/v1/runs/" + rid
	accepted := request(t, app, "POST", path+"/reviews", `{"checkId":"a","kind":"accepted"}`, 201)
	rejected := request(t, app, "POST", path+"/reviews", `{"checkId":"b","kind":"rejected","body":"Previously not accepted"}`, 201)
	comment := request(t, app, "POST", path+"/reviews", `{"checkId":"b","kind":"comment","body":"Additional evidence"}`, 201)
	got := request(t, app, "POST", path+"/accept-all", `{}`, 200)
	if got["status"] != "accepted" || !reflect.DeepEqual(got["report"], run["report"]) {
		t.Fatal("bulk judgment must preserve the report", got)
	}
	if !reflect.DeepEqual(got["reviewCounts"], map[string]any{"accepted": float64(4), "pending": float64(0), "rejected": float64(0)}) {
		t.Fatal(got)
	}
	history := got["reviews"].([]any)
	if len(history) != 6 || !reflect.DeepEqual(history[:3], []any{accepted, rejected, comment}) {
		t.Fatal("bulk acceptance replaced existing history", history)
	}
	judgments := got["checkReviews"].([]any)
	for i, judgment := range judgments {
		current := judgment.(map[string]any)
		if current["status"] != "accepted" {
			t.Fatal(current)
		}
		if i == 0 {
			if current["lastReviewId"] != accepted["id"] {
				t.Fatal("already accepted item was rewritten", current)
			}
			continue
		}
		entry := history[i+2].(map[string]any)
		if entry["checkId"] != current["checkId"] || entry["id"] != current["lastReviewId"] || entry["legacy"] != false || entry["body"] != "批量人工通过：人工确认本轮全部检查项通过。" {
			t.Fatal(entry, current)
		}
	}
	if repeated := request(t, app, "POST", path+"/accept-all", `{}`, 200); !reflect.DeepEqual(got, repeated) {
		t.Fatal("retry changed an already accepted Run", repeated)
	}
	// The new bulk action must not relax the individual judgment gate.
	request(t, app, "POST", path+"/reviews", `{"checkId":"b","kind":"accepted"}`, 400)
	w := httptest.NewRecorder()
	authenticatedHandler(t, app).ServeHTTP(w, localRequest("GET", path+"/evidence/log.txt", nil))
	if w.Code != 200 || w.Body.String() != "original observations" {
		t.Fatal("bulk action altered evidence", w.Code, w.Body.String())
	}
}

func TestAcceptAllScopeAndLaterJudgments(t *testing.T) {
	for _, scope := range []string{"", "unknown", "partial", "full"} {
		t.Run(scope, func(t *testing.T) {
			app, _, cid := setup(t)
			run := upload(t, app, cid, "bulk-scope", reviewReport(t, scope, "passed", "failed", "blocked", "skipped"), map[string]string{"log.txt": "observations"}, 201)
			path := "/api/v1/runs/" + run["id"].(string)
			got := request(t, app, "POST", path+"/accept-all", `{}`, 200)
			wantCampaign := "pending"
			if scope == "full" {
				wantCampaign = "accepted"
			}
			campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
			if got["status"] != "accepted" || len(got["reviews"].([]any)) != 4 || campaign["status"] != wantCampaign {
				t.Fatal(got, campaign)
			}
			request(t, app, "POST", path+"/reviews", `{"checkId":"a","kind":"pending"}`, 201)
			got = request(t, app, "GET", path, "", 200)
			campaign = request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
			if got["status"] != "pending" || campaign["status"] != "pending" {
				t.Fatal("withdrawal did not reopen delivery", got, campaign)
			}
			request(t, app, "POST", path+"/reviews", `{"checkId":"a","kind":"rejected","body":"New issue"}`, 201)
			got = request(t, app, "GET", path, "", 200)
			campaign = request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
			if got["status"] != "rejected" || campaign["status"] != "rejected" {
				t.Fatal("rejection did not change delivery", got, campaign)
			}
			got = request(t, app, "POST", path+"/accept-all", `{}`, 200)
			if got["status"] != "accepted" || len(got["reviews"].([]any)) != 7 {
				t.Fatal("repeated delivery should only reaccept the changed item", got)
			}
		})
	}
}

func TestAcceptAllDoesNotChangeLatestRunOrInheritJudgments(t *testing.T) {
	app, _, cid := setup(t)
	old := upload(t, app, cid, "old-bulk", reviewReport(t, "full", "passed", "passed"), map[string]string{"log.txt": "old"}, 201)
	request(t, app, "POST", "/api/v1/runs/"+old["id"].(string)+"/accept-all", `{}`, 200)
	latest := upload(t, app, cid, "latest-bulk", reviewReport(t, "full", "passed", "failed"), map[string]string{"log.txt": "latest"}, 201)
	if latest["status"] != "pending" || latest["reviewCounts"].(map[string]any)["pending"] != float64(2) || len(latest["reviews"].([]any)) != 0 {
		t.Fatal("new Run inherited bulk acceptance", latest)
	}
	request(t, app, "POST", "/api/v1/runs/"+old["id"].(string)+"/reviews", `{"checkId":"a","kind":"pending"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+old["id"].(string)+"/accept-all", `{}`, 200)
	campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if campaign["status"] != "pending" || campaign["latestRunId"] != latest["id"] {
		t.Fatal("historical delivery changed the current campaign", campaign)
	}
}

func TestConcurrentAcceptAllDoesNotDuplicateJudgments(t *testing.T) {
	app, _, cid := setup(t)
	run := upload(t, app, cid, "concurrent-bulk", reviewReport(t, "full", "passed", "failed"), map[string]string{"log.txt": "observations"}, 201)
	path := "/api/v1/runs/" + run["id"].(string)
	results := make(chan *httptest.ResponseRecorder, 8)
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			w := httptest.NewRecorder()
			authenticatedHandler(t, app).ServeHTTP(w, localRequest("POST", path+"/accept-all", strings.NewReader(`{}`)))
			results <- w
		})
	}
	group.Wait()
	close(results)
	for w := range results {
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	got := request(t, app, "GET", path, "", 200)
	if got["status"] != "accepted" || len(got["reviews"].([]any)) != 2 {
		t.Fatal("concurrent retries duplicated judgment history", got)
	}
}

func TestAcceptAllRejectsVoidMissingAndInvalidInput(t *testing.T) {
	app, _, cid := setup(t)
	request(t, app, "POST", "/api/v1/runs/missing/accept-all", `{}`, 404)
	run := upload(t, app, cid, "void-bulk", reviewReport(t, "full", "passed"), map[string]string{"log.txt": "observations"}, 201)
	path := "/api/v1/runs/" + run["id"].(string)
	request(t, app, "POST", path+"/accept-all", `{"checkId":"a"}`, 400)
	request(t, app, "POST", path+"/void", `{"reason":"Wrong report"}`, 200)
	if error := request(t, app, "POST", path+"/accept-all", `{}`, 409); error["code"] != "RUN_VOID" {
		t.Fatal(error)
	}
	got := request(t, app, "GET", path, "", 200)
	if got["status"] != "void" || len(got["reviews"].([]any)) != 0 {
		t.Fatal("void bulk request changed judgment history", got)
	}
}

func TestAcceptAllRollsBackEveryWriteOnFailure(t *testing.T) {
	for _, fault := range []struct {
		name string
		sql  string
	}{
		{"second-review", `CREATE TRIGGER fail_bulk BEFORE INSERT ON reviews FOR EACH ROW BEGIN IF NEW.check_id='b' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected review failure'; END IF; END;`},
		{"campaign-update", `CREATE TRIGGER fail_bulk BEFORE UPDATE ON campaigns FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected campaign failure';`},
	} {
		t.Run(fault.name, func(t *testing.T) {
			dir := t.TempDir()
			app, err := openArchive(t, dir)
			if err != nil {
				t.Fatal(err)
			}
			defer app.Close()
			project := request(t, app, "POST", "/api/v1/projects", `{"name":"Rollback fixture"}`, 201)
			campaign := request(t, app, "POST", "/api/v1/projects/"+project["id"].(string)+"/campaigns", `{"title":"Rollback"}`, 201)
			cid := campaign["id"].(string)
			run := upload(t, app, cid, "rollback-bulk", reviewReport(t, "full", "passed", "failed"), map[string]string{"log.txt": "observations"}, 201)
			path := "/api/v1/runs/" + run["id"].(string)
			db, err := sql.Open("mysql", archiveDSN(t, dir))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err = db.Exec(fault.sql); err != nil {
				t.Fatal(err)
			}
			if response := request(t, app, "POST", path+"/accept-all", `{}`, 500); response["code"] != "SAVE_FAILED" {
				t.Fatal(response)
			}
			if got := request(t, app, "GET", path, "", 200); !reflect.DeepEqual(got, run) {
				t.Fatal("failed bulk delivery left a partial Run", got)
			}
			if got := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200); got["status"] != "pending" {
				t.Fatal("failed delivery changed campaign", got)
			}
			if _, err = db.Exec("DROP TRIGGER fail_bulk"); err != nil {
				t.Fatal(err)
			}
			if got := request(t, app, "POST", path+"/accept-all", `{}`, 200); got["status"] != "accepted" || len(got["reviews"].([]any)) != 2 {
				t.Fatal("retry after rollback failed", got)
			}
		})
	}
}
