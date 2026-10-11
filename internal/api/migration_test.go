package api_test

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

// This is a v1 archive fixture, built before the API starts. HTTP assertions
// exercise the upgraded archive; the snapshot assertion verifies backup bytes.
const oldCanonicalReport = `{"title":"Feature","description":"Real check","verifiedAt":"2026-10-09T10:00:00Z","scope":"partial: failure only","environment":"unknown","versions":[{"repository":"unknown","commit":"unknown","dirty":null}],"checks":[{"id":"c1","title":"Broken","expected":"works","actual":"failed","status":"failed","evidence":["log.txt"]}],"evidence":[{"path":"log.txt","description":"execution log"}]}`

func legacyArchive(t *testing.T, dir string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`PRAGMA journal_mode=WAL;
PRAGMA wal_autocheckpoint=0;
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE repositories(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,source TEXT NOT NULL,UNIQUE(project_id,source));
CREATE TABLE campaigns(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',latest_run_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE TABLE runs(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,submission_id TEXT NOT NULL UNIQUE,hash TEXT NOT NULL,report TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',void_reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE TABLE reviews(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
INSERT INTO projects VALUES('legacy-project','Legacy product','Preserved project','2026-10-09T10:00:00Z');
INSERT INTO repositories VALUES('legacy-repo','legacy-project','web','git:product');
INSERT INTO campaigns VALUES('legacy-campaign','legacy-project','Legacy delivery','Preserved campaign','accepted','legacy-accepted','2026-10-09T10:00:00Z');
PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"accepted", "rejected", "void"} {
		rid := "legacy-" + status
		reason := ""
		if status == "void" {
			reason = "Wrong target environment"
		}
		_, err = db.Exec("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)", rid, "legacy-campaign", "submission-"+status, "dc8ae0aab45cdb7e4a8dda8ad1d916a45b0155f17a4773753df99791a6e0456e", oldCanonicalReport, status, reason, "2026-10-09T10:00:00Z")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.MkdirAll(filepath.Join(dir, "evidence", rid), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "evidence", rid, "log.txt"), []byte("legacy evidence"), 0600); err != nil {
			t.Fatal(err)
		}
		kind := status
		if status == "void" {
			kind = "comment"
		}
		if _, err = db.Exec("INSERT INTO reviews VALUES(?,?,?,?,?)", "review-"+status, rid, kind, "Old review text", "2026-10-09T10:00:00Z"); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestUpgradePreservesArchiveAndStartsItemsPendingOnlyOnce(t *testing.T) {
	dir := t.TempDir()
	legacyArchive(t, dir) // Keep WAL connection open so the snapshot must include it.
	app, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	project := request(t, app, "GET", "/api/v1/projects/legacy-project", "", 200)
	repositories := request(t, app, "GET", "/api/v1/projects/legacy-project/repositories", "", 200)
	if project["description"] != "Preserved project" || len(repositories["items"].([]any)) != 1 {
		t.Fatal(project, repositories)
	}
	campaign := request(t, app, "GET", "/api/v1/campaigns/legacy-campaign", "", 200)
	if campaign["status"] != "pending" || campaign["latestRunId"] != "legacy-accepted" {
		t.Fatal(campaign)
	}
	var original map[string]any
	if err = json.Unmarshal([]byte(oldCanonicalReport), &original); err != nil {
		t.Fatal(err)
	}
	for _, oldStatus := range []string{"accepted", "rejected", "void"} {
		rid := "legacy-" + oldStatus
		run := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
		wantStatus := "pending"
		if oldStatus == "void" {
			wantStatus = "void"
			if run["voidReason"] != "Wrong target environment" {
				t.Fatal(run)
			}
		}
		if run["status"] != wantStatus || !reflect.DeepEqual(run["report"], original) || run["reviewCounts"].(map[string]any)["pending"] != float64(1) {
			t.Fatal(run)
		}
		review := run["reviews"].([]any)[0].(map[string]any)
		if review["body"] != "Old review text" || review["legacy"] != (oldStatus != "void") {
			t.Fatal(review)
		}
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+rid+"/evidence/log.txt", nil))
		if w.Code != 200 || w.Body.String() != "legacy evidence" {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	backups, err := filepath.Glob(filepath.Join(dir, "archive.before-v2.*.db"))
	if err != nil || len(backups) != 1 {
		t.Fatal(backups, err)
	}
	snapshot, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	var version int
	var raw, status string
	if err = snapshot.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err = snapshot.QueryRow("SELECT report,status FROM runs WHERE id='legacy-accepted'").Scan(&raw, &status); err != nil {
		t.Fatal(err)
	}
	if version != 1 || raw != oldCanonicalReport || status != "accepted" {
		t.Fatal("backup did not preserve the committed v1 archive", version, raw, status)
	}
	upload(t, app, "legacy-campaign", "submission-accepted", report, map[string]string{"log.txt": "legacy evidence"}, 200)
	request(t, app, "POST", "/api/v1/runs/legacy-accepted/reviews", `{"checkId":"c1","kind":"accepted","body":"Human verified the expected result"}`, 201)
	if err = app.Close(); err != nil {
		t.Fatal(err)
	}
	app, err = api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := request(t, app, "GET", "/api/v1/runs/legacy-accepted", "", 200)
	if got["status"] != "accepted" || got["reviewCounts"].(map[string]any)["accepted"] != float64(1) || len(got["reviews"].([]any)) != 2 {
		t.Fatal("restart reran migration and cleared new item decisions", got)
	}
	backups, err = filepath.Glob(filepath.Join(dir, "archive.before-v2.*.db"))
	if err != nil || len(backups) != 1 {
		t.Fatal("restart unnecessarily reran migration backup", backups, err)
	}
}

func TestReviewDecisionsUseSaveOrderWhenTimestampsMatch(t *testing.T) {
	dir := t.TempDir()
	db := legacyArchive(t, dir)
	app, err := api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	request(t, app, "POST", "/api/v1/runs/legacy-accepted/reviews", `{"checkId":"c1","kind":"accepted","body":"First judgment"}`, 201)
	request(t, app, "POST", "/api/v1/runs/legacy-accepted/reviews", `{"checkId":"c1","kind":"rejected","body":"Later judgment"}`, 201)
	if err = app.Close(); err != nil {
		t.Fatal(err)
	}
	// An offline fixture supplies the hard-to-produce equal clock timestamp and
	// reverse lexical IDs. Judgment order still comes from their saved history.
	if _, err = db.Exec(`UPDATE reviews SET created_at='2026-10-11T12:00:00Z',id=CASE kind WHEN 'accepted' THEN 'z-first' ELSE 'a-later' END WHERE legacy=0 AND check_id='c1'`); err != nil {
		t.Fatal(err)
	}
	app, err = api.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	run := request(t, app, "GET", "/api/v1/runs/legacy-accepted", "", 200)
	current := run["checkReviews"].([]any)[0].(map[string]any)
	if run["status"] != "rejected" || current["status"] != "rejected" || current["lastReviewId"] != "a-later" {
		t.Fatal(run)
	}
}
