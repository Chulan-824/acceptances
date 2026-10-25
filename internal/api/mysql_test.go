package api_test

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
)

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
	empty := t.TempDir()
	reopened, err := api.OpenMySQL(empty, dsn)
	if err != nil {
		t.Fatal("database-only restart in an empty directory:", err)
	}
	defer reopened.Close()
	w := httptest.NewRecorder()
	reopened.Handler().ServeHTTP(w, localRequest("GET", "/api/v1/runs/"+rid+"/evidence/screen.png", nil))
	if w.Code != 200 || w.Body.Len() == 0 {
		t.Fatal("database-only restart lost evidence:", w.Code)
	}
	entries, err := os.ReadDir(empty)
	if err != nil || len(entries) != 0 {
		t.Fatalf("database-only startup wrote local files: %v %v", entries, err)
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
	// MySQL acknowledges KILL before the target connection finishes exiting.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var released bool
		if err = db.QueryRow("SELECT IS_USED_LOCK(?) IS NULL", fmt.Sprintf("acceptances:%x", sum[:24])).Scan(&released); err != nil {
			t.Fatal(err)
		}
		if released {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("killed lease did not exit")
		}
		time.Sleep(time.Millisecond)
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

func TestMySQLReviewDecisionsUseSaveOrderWhenTimestampsMatch(t *testing.T) {
	app, _, cid, dir := deliveryTestSetup(t)
	rid := upload(t, app, cid, "equal-timestamps", report, map[string]string{"log.txt": "observations"}, 201)["id"].(string)
	path := "/api/v1/runs/" + rid
	request(t, app, "POST", path+"/reviews", `{"checkId":"c1","kind":"accepted","body":"first"}`, 201)
	request(t, app, "POST", path+"/reviews", `{"checkId":"c1","kind":"rejected","body":"later"}`, 201)
	app.Close()
	db := artifactDB(t, dir)
	if _, err := db.Exec("UPDATE reviews SET created_at='2026-10-25T00:00:00Z',id=CASE kind WHEN 'accepted' THEN 'z-first' ELSE 'a-later' END WHERE check_id='c1'"); err != nil {
		t.Fatal(err)
	}
	reopened, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	run := request(t, reopened, "GET", path, "", 200)
	current := run["checkReviews"].([]any)[0].(map[string]any)
	if run["status"] != "rejected" || current["lastReviewId"] != "a-later" {
		t.Fatal(run)
	}
}
