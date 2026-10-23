package api_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func isolatedMySQL(t *testing.T) (string, *sql.DB) {
	t.Helper()
	path := os.Getenv("ACCEPTANCES_MYSQL_TEST_DSN_FILE")
	if path == "" {
		t.Skip("set ACCEPTANCES_MYSQL_TEST_DSN_FILE to run against Docker MySQL")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := mysql.ParseDSN(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal("invalid test MySQL configuration")
	}
	admin, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	name := "acceptances_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec("CREATE DATABASE " + name + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin"); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	cfg.DBName = name
	dsn := cfg.FormatDSN()
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close(); admin.Exec("DROP DATABASE " + name); admin.Close() })
	return dsn, db
}

func TestMySQLMigrationPreservesArchive(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.Report.Description = "迁移保留中文与 emoji 🧭"
	f.finalize(t)
	rid := publishDeliveryFixture(t, app, cid, "existing-report", f)
	for _, kind := range []string{"rejected", "pending", "accepted"} {
		request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"checkId":"fixture-export--download","kind":"`+kind+`","body":"Explicit original review"}`, 201)
	}
	legacy, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = legacy.Exec("UPDATE reviews SET created_at='2026-10-13T09:00:00.123456789Z'"); err != nil {
		t.Fatal(err)
	}
	legacy.Close()
	snapshot := freezeFixture(t, app, rid, "existing-freeze")
	did := snapshot["id"].(string)
	document := request(t, app, "POST", "/api/v1/deliveries/"+did+"/documents", `{"requestId":"existing-document"}`, 201)
	before := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	app.Close()
	result, err := api.MigrateSQLiteToMySQL(context.Background(), dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if result.Rows["runs"] != 1 || result.Rows["reviews"] != 3 || result.Rows["business_documents"] != 1 || result.Files == 0 {
		t.Fatal(result)
	}
	if _, err = os.Stat(filepath.Join(result.Backup, "data/archive.db")); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dir, "archive.db")); err != nil {
		t.Fatal("source SQLite was removed")
	}
	replay, err := api.MigrateSQLiteToMySQL(context.Background(), dir, dsn)
	if err != nil || !replay.AlreadyImported {
		t.Fatalf("migration retry: %+v %v", replay, err)
	}
	app, err = api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { app.Close() }()
	after := request(t, app, "GET", "/api/v1/runs/"+rid, "", 200)
	if fixtureJSON(t, before) != fixtureJSON(t, after) {
		t.Fatal("Run, review order or timestamps changed during import")
	}
	got := request(t, app, "GET", "/api/v1/deliveries/"+did, "", 200)
	if fixtureJSON(t, snapshot) != fixtureJSON(t, got) {
		t.Fatal("frozen snapshot changed during import")
	}
	upload(t, app, cid, "existing-report", fixtureJSON(t, f.Report), f.Files, 200)
	upload(t, app, cid, "existing-report", fixtureJSON(t, f.Report), map[string]string{}, 400)
	for _, query := range []string{
		"UPDATE delivery_snapshots SET payload='{}' WHERE id='" + did + "'",
		"DELETE FROM delivery_snapshots WHERE id='" + did + "'",
		"UPDATE business_documents SET status='failed' WHERE id='" + document["id"].(string) + "'",
	} {
		if _, err = db.Exec(query); err == nil {
			t.Fatal("immutable archive accepted mutation")
		}
	}
	request(t, app, "POST", "/api/v1/runs/"+rid+"/reviews", `{"checkId":"fixture-export--download","kind":"pending"}`, 201)
	got = request(t, app, "GET", "/api/v1/deliveries/"+did, "", 200)
	if got["status"] != "invalidated" || got["sha256"] != snapshot["sha256"] {
		t.Fatal(got)
	}
	request(t, app, "DELETE", "/api/v1/projects/"+pid, "", 204)
	for _, path := range []string{"/api/v1/deliveries/" + did, "/api/v1/documents/" + document["id"].(string)} {
		request(t, app, "GET", path, "", 200)
	}
	for _, path := range []string{"/api/v1/deliveries/" + did + "/evidence/screen.png", "/api/v1/documents/" + document["id"].(string) + "/html"} {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("GET", path, nil))
		if w.Code != 200 {
			t.Fatalf("retained file %s: %d", path, w.Code)
		}
	}
	app.Close()
	app, err = api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	request(t, app, "GET", "/api/v1/deliveries/"+did, "", 200)
}

func TestMySQLIdentityConcurrencyAndOwnership(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	dir := t.TempDir()
	app, err := api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	if other, err := api.OpenMySQL(t.TempDir(), dsn); err == nil {
		other.Close()
		t.Fatal("second backend acquired the archive")
	}
	project := request(t, app, "POST", "/api/v1/projects", `{"name":"MySQL fixture"}`, 201)
	pid := project["id"].(string)
	a := request(t, app, "POST", "/api/v1/projects/"+pid+"/repositories", `{"name":"one","source":"git:Product"}`, 201)
	b := request(t, app, "POST", "/api/v1/projects/"+pid+"/repositories", `{"name":"two","source":"git:product"}`, 201)
	if a["id"] == b["id"] {
		t.Fatal("repository identity became case insensitive")
	}
	campaign := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Concurrent freeze"}`, 201)
	cid := campaign["id"].(string)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	rid := publishDeliveryFixture(t, app, cid, "new-report", f)
	request(t, app, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
	input := preparedFreeze(t, app, rid, "concurrent-freeze")
	body := fixtureJSON(t, input)
	var group sync.WaitGroup
	results := make(chan int, 4)
	for range 4 {
		group.Go(func() {
			w := httptest.NewRecorder()
			app.Handler().ServeHTTP(w, localRequest("POST", "/api/v1/runs/"+rid+"/deliveries", strings.NewReader(body)))
			results <- w.Code
		})
	}
	group.Wait()
	close(results)
	for status := range results {
		if status != 200 && status != 201 {
			t.Fatalf("concurrent request: %d", status)
		}
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM delivery_snapshots").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate snapshot: %d %v", count, err)
	}
	app.Close()
	if other, err := api.OpenMySQL(t.TempDir(), dsn); err == nil {
		other.Close()
		t.Fatal("wrong directory accepted populated database")
	}
	if err = os.Remove(filepath.Join(dir, ".mysql-storage.json")); err != nil {
		t.Fatal(err)
	}
	if other, err := api.OpenMySQL(dir, dsn); err == nil {
		other.Close()
		t.Fatal("unbound archive allowed cleanup")
	}
	if _, err = os.Stat(filepath.Join(dir, "evidence", rid)); err != nil {
		t.Fatal("startup failure removed evidence")
	}
}

func TestMySQLMigrationRejectsDifferentDestination(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	request(t, app, "POST", "/api/v1/projects", `{"name":"Existing destination"}`, 201)
	app.Close()
	source, _, _, dir := deliveryTestSetup(t)
	source.Close()
	if _, err = api.MigrateSQLiteToMySQL(context.Background(), dir, dsn); err == nil {
		t.Fatal("different destination was overwritten")
	}
	// No binding is created when a destination contains unrelated records.
	if _, err = os.Stat(filepath.Join(dir, ".mysql-storage.json")); !os.IsNotExist(err) {
		t.Fatal("failed import bound source directory")
	}
	data, err := os.ReadFile(filepath.Join(dir, "archive.db"))
	if err != nil || len(data) == 0 {
		t.Fatal("source database was lost")
	}
}

func TestMySQLRequestCancellationAndLeaseLoss(t *testing.T) {
	dsn, db := isolatedMySQL(t)
	app, err := api.OpenMySQL(t.TempDir(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	pid := request(t, app, "POST", "/api/v1/projects", `{"name":"Lease guard"}`, 201)["id"].(string)
	listPath := "/api/v1/projects/" + pid + "/campaigns"
	cid := request(t, app, "POST", listPath, `{"title":"Campaign"}`, 201)["id"].(string)
	// A browser can cancel parallel fetches during navigation. These contexts
	// must never close the dedicated connection that owns the archive lease.
	var requests sync.WaitGroup
	for range 100 {
		requests.Go(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Microsecond)
			defer cancel()
			_ = app.Ready(ctx)
		})
	}
	requests.Wait()
	if err = app.Ready(context.Background()); err != nil {
		t.Fatalf("cancelled requests released the archive lease: %v", err)
	}
	request(t, app, "GET", "/api/v1/projects", "", 200)
	var database string
	if err = db.QueryRow("SELECT DATABASE()").Scan(&database); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(database))
	var owner uint64
	if err = db.QueryRow("SELECT IS_USED_LOCK(?)", fmt.Sprintf("acceptances:%x", sum[:24])).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(fmt.Sprintf("KILL CONNECTION %d", owner)); err != nil {
		t.Fatal(err)
	}
	if err = app.Ready(context.Background()); err == nil {
		t.Fatal("lost lease reported ready")
	}
	request(t, app, "GET", "/api/v1/projects", "", 503)
	request(t, app, "GET", listPath, "", 503)
	request(t, app, "POST", listPath, `{"title":"Must not be created"}`, 503)
	request(t, app, "GET", "/api/v1/campaigns/"+cid, "", 503)
	request(t, app, "PATCH", "/api/v1/campaigns/"+cid, `{"description":"Must not be saved"}`, 503)
	var count int
	var description string
	if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM campaigns").Scan(&count); err != nil || count != 1 {
		t.Fatalf("lease loss allowed campaign creation: %d, %v", count, err)
	}
	if err := db.QueryRowContext(t.Context(), "SELECT description FROM campaigns WHERE id=?", cid).Scan(&description); err != nil || description != "" {
		t.Fatalf("lease loss allowed campaign update: %q, %v", description, err)
	}
}
