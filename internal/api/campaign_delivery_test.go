package api_test

import (
	"strings"
	"testing"
)

func TestCampaignDeliveryReadinessFollowsLatestRunAndKeepsFrozenVersion(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	path := "/api/v1/campaigns/" + cid + "/delivery"
	empty := request(t, app, "GET", path, "", 200)
	if empty["preparation"] != nil || empty["currentDelivery"] != nil {
		t.Fatal(empty)
	}
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "overview-full", f)
	pending := request(t, app, "GET", path, "", 200)["preparation"].(map[string]any)
	if pending["eligible"] != false || !strings.Contains(fixtureJSON(t, pending["issues"]), "HUMAN_ACCEPTANCE_REQUIRED") {
		t.Fatal(pending)
	}
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	ready := request(t, app, "GET", path, "", 200)["preparation"].(map[string]any)
	if ready["eligible"] != true {
		t.Fatal(ready)
	}
	snapshot := freezeFixture(t, app, runID, "overview-freeze")
	deliveryID := snapshot["id"].(string)
	request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"overview-document"}`, 201)
	f.Report.ScopeType = "partial"
	dirty := true
	f.Report.Versions[0].Dirty = &dirty
	f.finalize(t)
	latestID := publishDeliveryFixture(t, app, cid, "overview-partial", f)
	request(t, app, "POST", "/api/v1/runs/"+latestID+"/accept-all", `{}`, 200)
	view := request(t, app, "GET", path, "", 200)
	prep := view["preparation"].(map[string]any)
	if prep["runId"] != latestID || prep["eligible"] != false || !strings.Contains(fixtureJSON(t, prep["issues"]), "FULL_SCOPE_REQUIRED") || !strings.Contains(fixtureJSON(t, prep["issues"]), "SOURCE_IDENTITY_REQUIRED") {
		t.Fatal(view)
	}
	if view["currentDelivery"].(map[string]any)["id"] != deliveryID || view["latestDocument"].(map[string]any)["status"] != "succeeded" {
		t.Fatal(view)
	}
	// Reading a historical report cannot change the campaign's delivery source.
	request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)
	if got := request(t, app, "GET", path, "", 200)["preparation"].(map[string]any)["runId"]; got != latestID {
		t.Fatal(got)
	}
	request(t, app, "POST", "/api/v1/runs/"+runID+"/reviews", `{"kind":"pending","checkId":"fixture-export--download"}`, 201)
	invalid := request(t, app, "GET", path, "", 200)
	if invalid["currentDelivery"] != nil || invalid["latestDelivery"].(map[string]any)["status"] != "invalidated" || invalid["latestDocument"] == nil {
		t.Fatal(invalid)
	}
	request(t, app, "DELETE", "/api/v1/runs/"+latestID, "", 204)
	if got := request(t, app, "GET", path, "", 200); got["preparation"] != nil || got["latestDelivery"] == nil {
		t.Fatal(got)
	}
	request(t, app, "GET", "/api/v1/campaigns/missing/delivery", "", 404)
}

func TestCampaignDeliveryReportsMissingMaterialsWithoutCreatingSnapshot(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	delete(f.Files, "delivery-manifest.json")
	f.Report.Evidence = f.Report.Evidence[:len(f.Report.Evidence)-1]
	runID := publishDeliveryFixture(t, app, cid, "overview-missing-materials", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	view := request(t, app, "GET", "/api/v1/campaigns/"+cid+"/delivery", "", 200)
	if !strings.Contains(fixtureJSON(t, view), "DELIVERY_MATERIALS_INVALID") || view["currentDelivery"] != nil {
		t.Fatal(view)
	}
}

func TestHistoricalBulkJudgmentCannotServeAsDeliveryExceptionReason(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.Report.Checks[0].Status = "blocked"
	f.Materials.Features[0].Limitations = []string{"Synthetic blocked scenario, not verified."}
	f.finalize(t)
	rid := publishDeliveryFixture(t, app, cid, "legacy-bulk", f)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"kind":"accepted","checkId":"fixture-export--download","body":"一键交付：人工确认本轮全部检查项通过。"}`, 201)
	prep := request(t, app, "GET", "/api/v1/runs/"+rid+"/delivery-preparation", "", 200)
	if prep["exceptionReasons"].(map[string]any)["fixture-export--download"] != "" {
		t.Fatal(prep)
	}
	input := preparedFreeze(t, app, rid, "legacy-freeze")
	input.ExceptionReasons["fixture-export--download"] = "一键交付：人工确认本轮全部检查项通过。"
	request(t, app, "POST", "/api/v1/runs/"+rid+"/deliveries", fixtureJSON(t, input), 400)
}
