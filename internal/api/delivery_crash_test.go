package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
)

type artifactCrashRequest struct {
	Directory string
	DSNFile   string
	Path      string
	Body      string
	Phase     string
}

// A separate process serves a real HTTP request and exits at the checkpoint,
// bypassing all deferred DB, filesystem and HTTP cleanup.
func TestDeliveryArtifactCrashHelper(t *testing.T) {
	configPath := os.Getenv("ACCEPTANCES_ARTIFACT_CRASH_REQUEST")
	if configPath == "" {
		return
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var input artifactCrashRequest
	if err = json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	dsn, err := os.ReadFile(input.DSNFile)
	if err != nil {
		t.Fatal(err)
	}
	app, err := api.OpenMySQL(input.Directory, string(dsn))
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
		if phase == input.Phase {
			os.Exit(73)
		}
		return nil
	})
	server := httptest.NewServer(authenticatedHandler(t, app))
	defer server.Close()
	response, err := http.Post(server.URL+input.Path, "application/json", strings.NewReader(input.Body))
	if err == nil {
		response.Body.Close()
	}
	t.Fatalf("process did not exit at %s: %v", input.Phase, err)
}

func TestDeliveryArtifactCrashRecovery(t *testing.T) {
	for _, kind := range []string{"deliveries", "documents"} {
		for _, phase := range []string{"staged", "renamed", "persisted"} {
			t.Run(kind+"/"+phase, func(t *testing.T) {
				app, runID, dir := readyArtifactRun(t)
				input := artifactCrashRequest{Directory: dir, Phase: phase, Path: "/api/v1/runs/" + runID + "/deliveries", Body: fixtureJSON(t, preparedFreeze(t, app, runID, "crash-freeze"))}
				if kind == "documents" {
					deliveryID := freezeFixture(t, app, runID, "crash-freeze")["id"].(string)
					input.Path, input.Body = "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"crash-document"}`
				}
				app.Close()
				input.DSNFile = filepath.Join(t.TempDir(), "connection.dsn")
				if err := os.WriteFile(input.DSNFile, []byte(archiveDSN(t, dir)), 0600); err != nil {
					t.Fatal(err)
				}
				configPath := filepath.Join(t.TempDir(), "crash-request.json")
				if err := os.WriteFile(configPath, []byte(fixtureJSON(t, input)), 0600); err != nil {
					t.Fatal(err)
				}
				executable, err := os.Executable()
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, executable, "-test.run=^TestDeliveryArtifactCrashHelper$")
				command.Env = append(os.Environ(), "ACCEPTANCES_ARTIFACT_CRASH_REQUEST="+configPath)
				output, err := command.CombinedOutput()
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 73 {
					t.Fatalf("crash checkpoint not reached: %v\n%s", err, output)
				}
				before := 1
				if phase == "staged" {
					before = 0
				}
				artifactEntries(t, filepath.Join(dir, kind), before)
				db := artifactDB(t, dir)
				var documentID, status string
				if kind == "documents" {
					if err = db.QueryRow("SELECT id,status FROM business_documents WHERE request_id='crash-document'").Scan(&documentID, &status); err != nil {
						t.Fatal(err)
					}
					want := "generating"
					if phase == "persisted" {
						want = "succeeded"
					}
					if status != want {
						t.Fatal("wrong pre-recovery document state", status)
					}
				}
				reopened, err := openArchive(t, dir)
				if err != nil {
					t.Fatal(err)
				}
				defer reopened.Close()
				noArtifactStages(t, dir)
				wantHTTP, wantFiles := 201, 0
				if phase == "persisted" {
					wantHTTP, wantFiles = 200, 1
				}
				artifactEntries(t, filepath.Join(dir, kind), wantFiles)
				if kind == "documents" && phase != "persisted" {
					document := request(t, reopened, "GET", "/api/v1/documents/"+documentID, "", 200)
					if document["status"] != "failed" {
						t.Fatal(document)
					}
				}
				replayed := request(t, reopened, "POST", input.Path, input.Body, wantHTTP)
				if replayed["version"] != float64(1) {
					t.Fatal("recovery created a new version", replayed)
				}
				readPath := "/api/v1/deliveries/" + replayed["id"].(string) + "/evidence/screen.png"
				if kind == "documents" {
					attempts := float64(2)
					if phase == "persisted" {
						attempts = 1
					}
					if replayed["id"] != documentID || replayed["attempts"] != attempts {
						t.Fatal("recovery changed document identity or attempts", replayed)
					}
					readPath = "/api/v1/documents/" + documentID + "/html"
				}
				w := httptest.NewRecorder()
				authenticatedHandler(t, reopened).ServeHTTP(w, localRequest("GET", readPath, nil))
				if w.Code != 200 || w.Body.Len() == 0 || kind == "documents" && fixtureDigest(w.Body.String()) != replayed["sha256"] {
					t.Fatal("recovered artifact cannot be verified", w.Code)
				}
			})
		}
	}
}
