package api_test

import (
	"os"
	"path/filepath"
	"testing"
)

func TestArtifactRecoveryPreservesEveryDeliveryEffectAndSuccessfulDamage(t *testing.T) {
	for _, effect := range []string{"valid", "invalidated", "revoked", "superseded"} {
		for _, damage := range []string{"missing", "corrupt"} {
			t.Run(effect+"/"+damage, func(t *testing.T) {
				app, runID, dir := readyArtifactRun(t)
				snapshot := freezeFixture(t, app, runID, "freeze")
				deliveryID := snapshot["id"].(string)
				path := "/api/v1/deliveries/" + deliveryID + "/documents"
				document := request(t, app, "POST", path, `{"requestId":"document"}`, 201)
				documentID := document["id"].(string)
				db := artifactDB(t, dir)
				artifactSQL(t, db, "UPDATE delivery_snapshots SET status=? WHERE id=?", effect, deliveryID)
				evidence := filepath.Join(dir, "deliveries", deliveryID, "evidence", "screen.png")
				html := filepath.Join(dir, "documents", documentID, "business.html")
				for _, filename := range []string{evidence, html} {
					var err error
					if damage == "missing" {
						err = os.Remove(filename)
					} else {
						err = os.WriteFile(filename, []byte("damaged"), 0600)
					}
					if err != nil {
						t.Fatal(err)
					}
				}
				app.Close()
				reopened, err := openArchive(t, dir)
				if err != nil {
					t.Fatal(err)
				}
				defer reopened.Close()
				artifactEntries(t, filepath.Join(dir, "deliveries"), 1)
				artifactEntries(t, filepath.Join(dir, "documents"), 1)
				copy := request(t, reopened, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
				if copy["status"] != effect || copy["sha256"] != snapshot["sha256"] {
					t.Fatal(copy)
				}
				docCode, evidenceCode := "DOCUMENT_INTEGRITY_FAILED", 409
				if damage == "missing" {
					docCode, evidenceCode = "DOCUMENT_FILE_UNAVAILABLE", 404
				}
				result := request(t, reopened, "GET", "/api/v1/documents/"+documentID+"/html", "", 500)
				if result["code"] != docCode {
					t.Fatal(result)
				}
				request(t, reopened, "GET", "/api/v1/deliveries/"+deliveryID+"/evidence/screen.png", "", evidenceCode)
				for _, attempt := range []struct{ path, body string }{{path, `{"requestId":"document"}`}, {"/api/v1/documents/" + documentID + "/retry", `{}`}} {
					replayed := request(t, reopened, "POST", attempt.path, attempt.body, 200)
					if fixtureJSON(t, replayed) != fixtureJSON(t, document) {
						t.Fatal("successful damaged document was rewritten", replayed)
					}
				}
				if damage == "missing" {
					if _, err := os.Stat(html); !os.IsNotExist(err) {
						t.Fatal("missing HTML was rebuilt", err)
					}
				} else if bytes, err := os.ReadFile(html); err != nil || string(bytes) != "damaged" {
					t.Fatal("corrupt HTML was rewritten", err)
				}
			})
		}
	}
}

func TestArtifactRecoveryFailsClosedAndCanBeRetried(t *testing.T) {
	for _, failure := range []string{"ownership-query", "target-cleanup", "stage-cleanup"} {
		t.Run(failure, func(t *testing.T) {
			app, runID, dir := readyArtifactRun(t)
			deliveryID := freezeFixture(t, app, runID, "freeze")["id"].(string)
			app.Close()
			db := artifactDB(t, dir)
			var protected string
			if failure == "ownership-query" {
				artifactSQL(t, db, "ALTER TABLE delivery_snapshots RENAME TO saved_snapshots")
				protected = filepath.Join(dir, "deliveries", deliveryID)
			} else {
				protected = filepath.Join(dir, "documents", "orphan")
				if failure == "stage-cleanup" {
					protected = filepath.Join(dir, ".document-interrupted")
				}
				if err := os.Mkdir(protected, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(protected, "partial"), []byte("unfinished"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(protected, 0500); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.Chmod(protected, 0700) })
			}
			opened, err := openArchive(t, dir)
			if err == nil {
				opened.Close()
				t.Fatal("Open succeeded despite an unresolved recovery failure")
			}
			if _, err := os.Stat(protected); err != nil {
				t.Fatal("failed recovery removed the protected directory", err)
			}
			if failure == "ownership-query" {
				artifactSQL(t, db, "ALTER TABLE saved_snapshots RENAME TO delivery_snapshots")
			} else if err = os.Chmod(protected, 0700); err != nil {
				t.Fatal(err)
			}
			reopened, err := openArchive(t, dir)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			request(t, reopened, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
			artifactEntries(t, filepath.Join(dir, "deliveries"), 1)
			artifactEntries(t, filepath.Join(dir, "documents"), 0)
			noArtifactStages(t, dir)
		})
	}
}
