package api_test

import (
	"reflect"
	"testing"
)

func TestCampaignDescriptionCorrectionDoesNotRewriteVerificationOrDelivery(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	key := publishDeliveryFixture(t, app, cid, "description-original", f)
	request(t, app, "POST", "/api/v1/runs/"+key+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, key, "description-frozen")
	before := readRun(t, app, key)
	campaign := request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 200)
	updated := request(t, app, "PATCH", "/api/v1/campaigns/"+cid, `{"description":"Correct current requirement ownership"}`, 200)
	for field, value := range campaign {
		if field != "description" && !reflect.DeepEqual(value, updated[field]) {
			t.Fatalf("campaign field changed: %s", field)
		}
	}
	if updated["description"] != "Correct current requirement ownership" {
		t.Fatal(updated)
	}
	if !reflect.DeepEqual(before, readRun(t, app, key)) {
		t.Fatal("metadata edit changed Run")
	}
	if !reflect.DeepEqual(snapshot, request(t, app, "GET", "/api/v1/deliveries/"+snapshot["id"].(string), "", 200)) {
		t.Fatal("metadata edit changed frozen snapshot")
	}
	request(t, app, "PATCH", "/api/v1/campaigns/"+cid, `{}`, 400)
	request(t, app, "PATCH", "/api/v1/campaigns/"+cid, `{"description":"x","status":"accepted"}`, 400)
	request(t, app, "PATCH", "/api/v1/campaigns/missing", `{"description":"x"}`, 404)
}
