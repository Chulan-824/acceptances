package api_test

import (
	"encoding/json"
	"testing"
)

func reviewReport(t *testing.T, scopeType string, statuses ...string) string {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(report), &doc); err != nil {
		t.Fatal(err)
	}
	if scopeType != "" {
		doc["scopeType"] = scopeType
	}
	checks := []any{}
	for i, status := range statuses {
		checks = append(checks, map[string]any{"id": string(rune('a' + i)), "title": "Behavior", "expected": "Expected outcome", "actual": "Observed outcome", "status": status, "evidence": []string{"log.txt"}})
	}
	doc["checks"] = checks
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestCheckAcceptancePreservesVerificationResult(t *testing.T) {
	app, _, cid := setup(t)
	run := upload(t, app, cid, "human-acceptance", report, map[string]string{"log.txt": "observed failure"}, 201)
	rid := run["id"].(string)
	review := request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"checkId":"c1","kind":"accepted","body":"Expected behavior was incorrect; human accepts the evidence"}`, 201)
	got := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if got["status"] != "accepted" {
		t.Fatal(got)
	}
	checks := got["report"].(map[string]any)["checks"].([]any)
	if checks[0].(map[string]any)["status"] != "failed" {
		t.Fatal("human decision rewrote the verification result", got)
	}
	current := got["checkReviews"].([]any)[0].(map[string]any)
	if current["status"] != "accepted" || current["lastReviewId"] != review["id"] || got["reviewCounts"].(map[string]any)["accepted"] != float64(1) {
		t.Fatal(got)
	}
	campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if campaign["status"] != "pending" {
		t.Fatal("unknown scope accepted the whole campaign", campaign)
	}
}

func TestRunRequiresAllCheckDecisionsAndRecomputesOnChange(t *testing.T) {
	app, _, cid := setup(t)
	run := upload(t, app, cid, "all-checks", reviewReport(t, "full", "passed", "failed"), map[string]string{"log.txt": "real observations"}, 201)
	rid := run["id"].(string)
	path := "/api/v1/runs/" + rid + "/reviews"
	assertStatus := func(wantRun, wantCampaign string) map[string]any {
		t.Helper()
		got := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
		campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
		if got["status"] != wantRun || campaign["status"] != wantCampaign {
			t.Fatal(got, campaign)
		}
		return got
	}
	assertStatus("pending", "pending")
	request(t, app, "POST", path, `{"checkId":"a","kind":"accepted"}`, 201)
	assertStatus("pending", "pending")
	request(t, app, "POST", path, `{"checkId":"b","kind":"rejected","body":"Needs correction"}`, 201)
	assertStatus("rejected", "rejected")
	request(t, app, "POST", path, `{"checkId":"b","kind":"comment","body":"Additional context"}`, 201)
	assertStatus("rejected", "rejected")
	request(t, app, "POST", path, `{"checkId":"b","kind":"accepted","body":"  "}`, 400)
	request(t, app, "POST", path, `{"checkId":"b","kind":"accepted","body":"Evidence satisfies the requirement"}`, 201)
	assertStatus("accepted", "accepted")
	withdrawal := request(t, app, "POST", path, `{"checkId":"a","kind":"pending"}`, 201)
	got := assertStatus("pending", "pending")
	if len(got["reviews"].([]any)) != 5 || got["checkReviews"].([]any)[0].(map[string]any)["lastReviewId"] != withdrawal["id"] {
		t.Fatal(got)
	}
}

func TestReportScopeControlsCampaignAcceptance(t *testing.T) {
	for _, scopeType := range []string{"", "unknown", "partial", "full"} {
		t.Run(scopeType, func(t *testing.T) {
			app, _, cid := setup(t)
			run := upload(t, app, cid, "scope", reviewReport(t, scopeType, "passed"), map[string]string{"log.txt": "observation"}, 201)
			request(t, app, "POST", "/api/v1/runs/"+run["id"].(string)+"/reviews", `{"checkId":"a","kind":"accepted"}`, 201)
			campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
			want := "pending"
			if scopeType == "full" {
				want = "accepted"
			}
			if campaign["status"] != want {
				t.Fatal(campaign)
			}
		})
	}
	app, _, cid := setup(t)
	upload(t, app, cid, "invalid-scope", reviewReport(t, "complete-ish", "passed"), map[string]string{"log.txt": "observation"}, 400)
}

func TestCheckReviewValidationAndVoidBoundary(t *testing.T) {
	app, _, cid := setup(t)
	run := upload(t, app, cid, "review-gates", reviewReport(t, "full", "passed", "failed", "blocked", "skipped"), map[string]string{"log.txt": "observations"}, 201)
	rid := run["id"].(string)
	path := "/api/v1/runs/" + rid + "/reviews"
	for _, body := range []string{
		`{"kind":"accepted"}`,
		`{"kind":"rejected","body":"Cannot bypass item review"}`,
		`{"kind":"pending"}`,
		`{"checkId":"missing","kind":"accepted"}`,
		`{"checkId":"missing","kind":"comment","body":"Unknown item"}`,
		`{"checkId":"a","kind":"invalid"}`,
		`{"checkId":"a","kind":"rejected","body":" "}`,
		`{"checkId":"a","kind":"comment","body":" "}`,
		`{"kind":"comment","body":" "}`,
		`{"checkId":"b","kind":"accepted"}`,
		`{"checkId":"c","kind":"accepted"}`,
		`{"checkId":"d","kind":"accepted"}`,
	} {
		request(t, app, "POST", path, body, 400)
	}
	request(t, app, "POST", path, `{"kind":"comment","body":"New overall issue for the next run"}`, 201)
	request(t, app, "POST", path, `{"checkId":"a","kind":"accepted"}`, 201)
	request(t, app, "POST", path, `{"checkId":"b","kind":"accepted","body":"Reviewed actual failure and accepted it"}`, 201)
	request(t, app, "POST", path, `{"checkId":"c","kind":"accepted","body":"Accepted limitation of blocked check"}`, 201)
	request(t, app, "POST", path, `{"checkId":"d","kind":"accepted","body":"Accepted the skipped check for this run"}`, 201)
	got := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if got["status"] != "accepted" || len(got["reviews"].([]any)) != 5 {
		t.Fatal(got)
	}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/void", `{"reason":"Wrong environment"}`, 200)
	for _, kind := range []string{"accepted", "rejected", "pending"} {
		request(t, app, "POST", path, `{"checkId":"a","kind":"`+kind+`","body":"Reason"}`, 409)
	}
	request(t, app, "POST", path, `{"checkId":"a","kind":"comment","body":"Comment remains allowed on a void item"}`, 201)
	request(t, app, "POST", path, `{"kind":"comment","body":"Overall void context"}`, 201)
	got = request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if got["status"] != "void" || len(got["reviews"].([]any)) != 7 {
		t.Fatal(got)
	}
}

func TestHistoricalReviewCannotChangeLatestCampaignAndNewItemsStartPending(t *testing.T) {
	app, _, cid := setup(t)
	first := upload(t, app, cid, "first", reviewReport(t, "full", "passed"), map[string]string{"log.txt": "observed"}, 201)["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+first+"/reviews", `{"checkId":"a","kind":"accepted"}`, 201)
	next := upload(t, app, cid, "next", reviewReport(t, "full", "passed"), map[string]string{"log.txt": "observed again"}, 201)
	if next["status"] != "pending" || next["reviewCounts"].(map[string]any)["pending"] != float64(1) || len(next["reviews"].([]any)) != 0 {
		t.Fatal("new run inherited human review", next)
	}
	request(t, app, "POST", "/api/v1/runs/"+first+"/reviews", `{"checkId":"a","kind":"rejected","body":"Reconsidered original evidence"}`, 201)
	campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if campaign["status"] != "pending" || campaign["latestRunId"] != next["id"] {
		t.Fatal(campaign)
	}
	request(t, app, "POST", "/api/v1/runs/"+next["id"].(string)+"/reviews", `{"checkId":"a","kind":"accepted"}`, 201)
	request(t, app, "POST", "/api/v1/runs/"+first+"/reviews", `{"checkId":"a","kind":"pending"}`, 201)
	campaign = request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	if campaign["status"] != "accepted" {
		t.Fatal(campaign)
	}
}
