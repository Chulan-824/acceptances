package api_test

import (
	"reflect"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestCampaignDescriptionCorrectionDoesNotRewriteVerificationOrDelivery(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	checkCampaignDescriptionHistory(t, app, pid, cid)
}

func TestMySQLCampaignDescriptionHistory(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"Campaign history"}`, 201)["id"].(string)
	cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"History"}`, 201)["id"].(string)
	checkCampaignDescriptionHistory(t, app, pid, cid)
}

func checkCampaignDescriptionHistory(t *testing.T, app *api.Server, pid, cid string) {
	t.Helper()
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
	if repeated := request(t, app, "PATCH", "/api/v1/campaigns/"+cid, `{"description":"Correct current requirement ownership"}`, 200); !reflect.DeepEqual(repeated, updated) {
		t.Fatal("repeated description save changed campaign fields")
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
