package api_test

import "testing"

func TestDashboardLatestSummaryAndReviewBoundaries(t *testing.T) {
	app, _, cid := setup(t)
	get := func() map[string]any {
		t.Helper()
		items := request(t, app, "GET", "/api/v1/dashboard", "", 200)["items"].([]any)
		if len(items) != 1 {
			t.Fatalf("expected one campaign, got %v", items)
		}
		return items[0].(map[string]any)
	}
	if get()["latestRun"] != nil {
		t.Fatal("empty campaign has a report")
	}
	first := upload(t, app, cid, "dashboard-first", reviewReport(t, "full", "passed"), map[string]string{"log.txt": "first"}, 201)
	request(t, app, "POST", "/api/v1/runs/"+first["id"].(string)+"/reviews", `{"checkId":"a","kind":"accepted"}`, 201)
	if get()["status"] != "accepted" {
		t.Fatal("full accepted campaign not represented")
	}
	second := upload(t, app, cid, "dashboard-second", reviewReport(t, "partial", "passed", "failed", "blocked", "skipped", "passed"), map[string]string{"log.txt": "second"}, 201)
	rid := second["id"].(string)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
	item := get()
	run := item["latestRun"].(map[string]any)
	if item["status"] != "pending" || run["status"] != "accepted" || run["id"] != rid || run["scopeType"] != "partial" {
		t.Fatal(item)
	}
	counts := run["counts"].(map[string]any)
	if counts["passed"] != float64(2) || counts["failed"] != float64(1) || counts["blocked"] != float64(1) || counts["skipped"] != float64(1) || run["evidenceCount"] != float64(1) || len(run["checks"].([]any)) != 4 {
		t.Fatal(run)
	}
	if _, ok := run["report"]; ok {
		t.Fatal("dashboard exposes full report")
	}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/void", `{"reason":"test"}`, 200)
	if get()["latestRun"].(map[string]any)["status"] != "void" {
		t.Fatal("void run hidden")
	}
	request(t, app, "DELETE", "/api/v1/runs/"+rid, "", 204)
	if get()["latestRun"] != nil || get()["status"] != "pending" {
		t.Fatal("deleted latest must not revive historical acceptance")
	}
}
