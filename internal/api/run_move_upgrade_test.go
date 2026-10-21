package api_test

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestRunMoveSchemaUpgradeBacksUpAndPreservesVersionFour(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	key := publishDeliveryFixture(t, app, cid, "v4-archive", f)
	request(t, app, "POST", "/api/v1/runs/"+key+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, key, "v4-frozen")
	before := readRun(t, app, key)
	app.Close()
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE run_consolidations; DROP TABLE run_moves; PRAGMA user_version=4;"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	upgraded, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	if !reflect.DeepEqual(before, readRun(t, upgraded, key)) {
		t.Fatal("upgrade changed Run facts")
	}
	if !reflect.DeepEqual(snapshot, request(t, upgraded, "GET", "/api/v1/deliveries/"+snapshot["id"].(string), "", 200)) {
		t.Fatal("upgrade changed delivery")
	}
	backups, err := filepath.Glob(filepath.Join(dir, "archive.before-v5.*.db"))
	if err != nil || len(backups) != 1 {
		t.Fatal("missing consistent backup", backups, err)
	}
	backup, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var version, count int
	if err = backup.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 4 {
		t.Fatal("wrong backup version", version, err)
	}
	if err = backup.QueryRow("SELECT COUNT(*) FROM runs WHERE id=?", key).Scan(&count); err != nil || count != 1 {
		t.Fatal("backup missing Run", err)
	}
	if err = backup.QueryRow("SELECT COUNT(*) FROM reviews WHERE run_id=?", key).Scan(&count); err != nil || count != 1 {
		t.Fatal("backup missing review", err)
	}
	upgraded.Close()
	again, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	backups, err = filepath.Glob(filepath.Join(dir, "archive.before-v5.*.db"))
	if err != nil || len(backups) != 1 {
		t.Fatal("migration repeated", err)
	}
}
