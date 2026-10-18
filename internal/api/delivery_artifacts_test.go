package api_test

import (
	"context"
	"database/sql"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func readyArtifactRun(t *testing.T) (*api.Server, string, string) {
	t.Helper()
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "artifact-run", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	return app, runID, dir
}

func artifactDB(t *testing.T, dir string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func artifactSQL(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func artifactEntries(t *testing.T, dir string, want int) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != want {
		t.Fatalf("%s: entries=%v error=%v want=%d", dir, entries, err, want)
	}
}

func noArtifactStages(t *testing.T, dir string) {
	t.Helper()
	for _, pattern := range []string{".delivery-*", ".document-*"} {
		paths, err := filepath.Glob(filepath.Join(dir, pattern))
		if err != nil || len(paths) != 0 {
			t.Fatalf("stages remain: %v %v", paths, err)
		}
	}
}

func TestArtifactPublicationFailuresLeaveNoReadablePartialFiles(t *testing.T) {
	for _, kind := range []string{"deliveries", "documents"} {
		for _, failure := range []string{"sync-file", "sync-directory", "rename", "parent-sync", "renamed"} {
			t.Run(kind+"/"+failure, func(t *testing.T) {
				app, runID, dir := readyArtifactRun(t)
				path, body := "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, preparedFreeze(t, app, runID, "freeze"))
				if kind == "documents" {
					snapshot := freezeFixture(t, app, runID, "freeze")
					path, body = "/api/v1/deliveries/"+snapshot["id"].(string)+"/documents", `{"requestId":"document"}`
				}
				hit := false
				api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
					if failure == "rename" && phase == "staged" {
						hit = true
						// A real rename failure: the destination parent is unavailable.
						return os.Rename(filepath.Join(dir, kind), filepath.Join(dir, kind+"-unavailable"))
					}
					if phase == failure || failure == "parent-sync" && phase == "sync-directory" && path == filepath.Join(dir, kind) {
						hit = true
						return errors.New("injected " + failure)
					}
					return nil
				})
				want := 500
				if kind == "documents" {
					want = 200
				}
				result := request(t, app, "POST", path, body, want)
				if !hit {
					t.Fatal("fault was not reached")
				}
				if failure == "rename" {
					if err := os.Rename(filepath.Join(dir, kind+"-unavailable"), filepath.Join(dir, kind)); err != nil {
						t.Fatal(err)
					}
				}
				if kind == "documents" {
					if result["status"] != "failed" || result["error"] == "" {
						t.Fatal(result)
					}
					request(t, app, "GET", "/api/v1/documents/"+result["id"].(string)+"/html", "", 409)
				} else if len(request(t, app, "GET", "/api/v1/deliveries", "", 200)["items"].([]any)) != 0 {
					t.Fatal("partial snapshot visible")
				}
				artifactEntries(t, filepath.Join(dir, kind), 0)
				noArtifactStages(t, dir)
			})
		}
	}
}

func TestArtifactCleanupFailureRetriesBothDocumentEntrypoints(t *testing.T) {
	for _, retryByID := range []bool{true, false} {
		name := "request-id"
		if retryByID {
			name = "retry-id"
		}
		t.Run(name, func(t *testing.T) {
			app, runID, dir := readyArtifactRun(t)
			deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
			path, body := "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"retry-cleanup"}`
			api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
				if phase == "renamed" {
					return errors.New("publication fault")
				}
				if phase == "remove" && filepath.Dir(path) == filepath.Join(dir, "documents") {
					return errors.New("cleanup fault")
				}
				return nil
			})
			failed := request(t, app, "POST", path, body, 200)
			if failed["status"] != "failed" || !strings.Contains(failed["error"].(string), "publication fault") || !strings.Contains(failed["error"].(string), "cleanup fault") {
				t.Fatal(failed)
			}
			artifactEntries(t, filepath.Join(dir, "documents"), 1)
			if retryByID {
				path, body = "/api/v1/documents/"+failed["id"].(string)+"/retry", `{}`
			}
			request(t, app, "POST", path, body, 500)
			unchanged := request(t, app, "GET", "/api/v1/documents/"+failed["id"].(string), "", 200)
			if fixtureJSON(t, unchanged) != fixtureJSON(t, failed) {
				t.Fatal("cleanup failure consumed an attempt or changed the failed version", unchanged)
			}
			api.SetDeliveryArtifactCheckpointForTest(app, nil)
			retried := request(t, app, "POST", path, body, 201)
			if retried["id"] != failed["id"] || retried["version"] != failed["version"] || retried["attempts"] != float64(2) || retried["status"] != "succeeded" {
				t.Fatal(retried)
			}
			artifactEntries(t, filepath.Join(dir, "documents"), 1)
			noArtifactStages(t, dir)
		})
	}
}

func TestDocumentFinalUpdateAndFailureStateErrors(t *testing.T) {
	for _, failState := range []bool{false, true} {
		name := "success-update"
		if failState {
			name = "also-failed-update"
		}
		t.Run(name, func(t *testing.T) {
			app, runID, dir := readyArtifactRun(t)
			deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
			db := artifactDB(t, dir)
			condition := "NEW.status='succeeded'"
			if failState {
				condition = "NEW.status IN ('succeeded','failed')"
			}
			artifactSQL(t, db, "CREATE TRIGGER reject_document BEFORE UPDATE ON business_documents WHEN "+condition+" BEGIN SELECT RAISE(ABORT,'document state fault'); END")
			want := 200
			if failState {
				want = 500
			}
			result := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"state-fault"}`, want)
			if failState && result["code"] != "DOCUMENT_STATE_SAVE_FAILED" || !failState && result["status"] != "failed" {
				t.Fatal(result)
			}
			artifactEntries(t, filepath.Join(dir, "documents"), 0)
			artifactSQL(t, db, "DROP TRIGGER reject_document")
			app.Close()
			reopened, err := api.Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			result = request(t, reopened, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"state-fault"}`, 201)
			if result["attempts"] != float64(2) || result["version"] != float64(1) {
				t.Fatal(result)
			}
		})
	}
}

func TestArtifactCleanupUsesDurableOwnershipAfterRequestErrors(t *testing.T) {
	for _, kind := range []string{"deliveries", "documents"} {
		for _, outcome := range []string{"committed", "unknown", "cancelled"} {
			t.Run(kind+"/"+outcome, func(t *testing.T) {
				app, runID, dir := readyArtifactRun(t)
				path, body := "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, preparedFreeze(t, app, runID, "freeze"))
				if kind == "documents" {
					deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
					path, body = "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"document"}`
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
					if outcome == "committed" && phase == "persisted" {
						return errors.New("error after confirmed commit")
					}
					if outcome == "unknown" && phase == "renamed" {
						return app.Close() // Both persistence and ownership lookup now fail.
					}
					if outcome == "cancelled" && phase == "renamed" {
						cancel()
					}
					return nil
				})
				w := httptest.NewRecorder()
				app.Handler().ServeHTTP(w, localRequest("POST", path, strings.NewReader(body)).WithContext(ctx))
				wantHTTP := 500
				if kind == "documents" && outcome != "unknown" {
					wantHTTP = 200
				}
				if w.Code != wantHTTP {
					t.Fatal(w.Code, w.Body.String())
				}
				wantFiles := 1
				if outcome == "cancelled" {
					wantFiles = 0
				}
				artifactEntries(t, filepath.Join(dir, kind), wantFiles)
				app.Close()
				reopened, err := api.Open(dir)
				if err != nil {
					t.Fatal(err)
				}
				defer reopened.Close()
				if outcome != "committed" {
					artifactEntries(t, filepath.Join(dir, kind), 0)
				} else {
					replay := request(t, reopened, "POST", path, body, 200)
					if replay["version"] != float64(1) {
						t.Fatal(replay)
					}
					artifactEntries(t, filepath.Join(dir, kind), 1)
				}
			})
		}
	}
}

func TestDocumentRenderingAllowsInvalidationButRejectsConcurrentGeneration(t *testing.T) {
	app, runID, dir := readyArtifactRun(t)
	deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
	staged, resume := make(chan struct{}), make(chan struct{})
	api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
		if phase == "staged" {
			close(staged)
			<-resume
		}
		return nil
	})
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, localRequest("POST", "/api/v1/deliveries/"+deliveryID+"/documents", strings.NewReader(`{"requestId":"render"}`)))
		done <- w
	}()
	<-staged
	request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"render"}`, 409)
	request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"other"}`, 409)
	request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/revoke", `{"reason":"Invalidated during rendering"}`, 200)
	close(resume)
	w := <-done
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"failed"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	artifactEntries(t, filepath.Join(dir, "documents"), 0)
	noArtifactStages(t, dir)
}

func TestSnapshotCommitFailureReleasesUncommittedOwnership(t *testing.T) {
	app, runID, dir := readyArtifactRun(t)
	db := artifactDB(t, dir)
	// All statements succeed, but COMMIT rejects a deferred foreign key.
	artifactSQL(t, db, `CREATE TABLE commit_parent(id INTEGER PRIMARY KEY);
CREATE TABLE commit_guard(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
CREATE TRIGGER reject_commit AFTER INSERT ON delivery_events BEGIN INSERT INTO commit_guard VALUES(42); END;`)
	input := fixtureJSON(t, preparedFreeze(t, app, runID, "commit-failure"))
	path := "/api/v1/runs/" + runID + "/deliveries"
	for range 2 {
		request(t, app, "POST", path, input, 500)
		if len(request(t, app, "GET", "/api/v1/deliveries", "", 200)["items"].([]any)) != 0 {
			t.Fatal("failed COMMIT leaked an uncommitted snapshot through the pooled connection")
		}
		for _, table := range []string{"delivery_snapshots", "delivery_requests", "delivery_events", "commit_guard"} {
			var count int
			if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
				t.Fatalf("%s after failed commit: %d, %v", table, count, err)
			}
		}
		artifactEntries(t, filepath.Join(dir, "deliveries"), 0)
	}
	artifactSQL(t, db, "DROP TRIGGER reject_commit")
	snapshot := request(t, app, "POST", path, input, 201)
	if snapshot["version"] != float64(1) {
		t.Fatal(snapshot)
	}
}

func TestDocumentReservationCommitFailureDoesNotConsumeVersion(t *testing.T) {
	app, runID, dir := readyArtifactRun(t)
	deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
	db := artifactDB(t, dir)
	artifactSQL(t, db, `CREATE TABLE commit_parent(id INTEGER PRIMARY KEY);
CREATE TABLE commit_guard(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
CREATE TRIGGER reject_commit AFTER INSERT ON business_documents BEGIN INSERT INTO commit_guard VALUES(42); END;`)
	path := "/api/v1/deliveries/" + deliveryID + "/documents"
	for range 2 {
		request(t, app, "POST", path, `{"requestId":"reserve"}`, 500)
		if len(request(t, app, "GET", path, "", 200)["items"].([]any)) != 0 {
			t.Fatal("failed reservation leaked a generating document")
		}
		artifactEntries(t, filepath.Join(dir, "documents"), 0)
		noArtifactStages(t, dir)
	}
	artifactSQL(t, db, "DROP TRIGGER reject_commit")
	document := request(t, app, "POST", path, `{"requestId":"reserve"}`, 201)
	if document["version"] != float64(1) || document["attempts"] != float64(1) {
		t.Fatal(document)
	}
}
