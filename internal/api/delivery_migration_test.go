package api_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestDeliveryMigrationBacksUpAndPreservesVersionTwoReviews(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "migration-fixture", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	before := request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)
	app.Close()
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	// The pre-existing report/review schema remains untouched. Remove only
	// empty delivery tables to reproduce an actual version-two archive.
	if _, err = db.Exec(`DROP TABLE business_documents;
DROP TABLE delivery_events;
DROP TABLE delivery_requests;
DROP TABLE delivery_snapshots;
PRAGMA user_version=2;`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	reopened, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	after := request(t, reopened, "GET", "/api/v1/runs/"+runID, "", 200)
	if fixtureJSON(t, before) != fixtureJSON(t, after) {
		t.Fatal("delivery migration changed report or accepted review")
	}
	backups, err := filepath.Glob(filepath.Join(dir, "archive.before-v3.*.db"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("expected one migration backup: %v %v", backups, err)
	}
	backup, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	var version, runCount, reviewCount int
	if err = backup.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 2 {
		t.Fatalf("backup version: %d %v", version, err)
	}
	if err = backup.QueryRow("SELECT COUNT(*) FROM runs WHERE id=?", runID).Scan(&runCount); err != nil || runCount != 1 {
		t.Fatal("backup lost original Run", err)
	}
	if err = backup.QueryRow("SELECT COUNT(*) FROM reviews WHERE run_id=?", runID).Scan(&reviewCount); err != nil || reviewCount == 0 {
		t.Fatal("backup lost accepted reviews", err)
	}
	backup.Close()
	reopened.Close()
	reopened, err = api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	again := request(t, reopened, "GET", "/api/v1/runs/"+runID, "", 200)
	backups, err = filepath.Glob(filepath.Join(dir, "archive.before-v3.*.db"))
	if err != nil || len(backups) != 1 || fixtureJSON(t, again) != fixtureJSON(t, before) {
		t.Fatal("restart repeated migration or changed reviews", err)
	}
}
