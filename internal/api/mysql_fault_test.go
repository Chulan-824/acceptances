package api_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestMySQLLeaseLossDuringPublication(t *testing.T) {
	for _, kind := range []string{"deliveries", "documents"} {
		for _, closeDuringRequest := range []bool{false, true} {
			name := kind + "/lease-loss"
			if closeDuringRequest {
				name += "/close-in-flight"
			}
			t.Run(name, func(t *testing.T) {
				dsn, db := isolatedMySQL(t)
				dir := t.TempDir()
				app := openLegacyMySQL(t, dir, dsn)
				var err error
				defer app.Close()
				pid := request(t, app, "POST", "/api/v1/projects", `{"name":"lease-loss fixture"}`, 201)["id"].(string)
				cid := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"lease-loss fixture"}`, 201)["id"].(string)
				f := newDeliveryFixture(t, pid, cid)
				f.finalize(t)
				rid := publishDeliveryFixture(t, app, cid, "lease-loss", f)
				request(t, app, "POST", "/api/v1/runs/"+rid+"/accept-all", `{}`, 200)
				path := "/api/v1/runs/" + rid + "/deliveries"
				body := fixtureJSON(t, preparedFreeze(t, app, rid, "lease-loss-freeze"))
				if kind == "documents" {
					did := freezeFixture(t, app, rid, "lease-loss-freeze")["id"].(string)
					path, body = "/api/v1/deliveries/"+did+"/documents", `{"requestId":"lease-loss-document"}`
				}
				reached, resume := make(chan string, 1), make(chan struct{})
				var resumeOnce sync.Once
				unblock := func() { resumeOnce.Do(func() { close(resume) }) }
				defer unblock()
				api.SetDeliveryArtifactCheckpointForTest(app, func(phase, path string) error {
					if phase == "renamed" {
						reached <- path
						<-resume
					}
					return nil
				})
				done := make(chan *httptest.ResponseRecorder, 1)
				go func() {
					w := httptest.NewRecorder()
					app.Handler().ServeHTTP(w, localRequest("POST", path, strings.NewReader(body)))
					done <- w
				}()
				var target string
				select {
				case target = <-reached:
				case <-time.After(10 * time.Second):
					t.Fatal("publication checkpoint not reached")
				}
				killMySQLLease(t, db)
				if closeDuringRequest {
					if err = app.Close(); err != nil {
						t.Fatal(err)
					}
				}
				assertArchiveLockedInOtherProcess(t, dir, dsn)
				if replacement, err := api.OpenMySQL(dir, dsn); err == nil {
					replacement.Close()
					t.Error("replacement took over files owned by an in-flight request")
				}
				if _, err = os.Stat(target); err != nil {
					t.Error("replacement startup removed in-flight files:", err)
				}
				unblock()
				select {
				case w := <-done:
					if w.Code == 201 {
						t.Error("publication succeeded after losing its archive lease")
					}
				case <-time.After(10 * time.Second):
					t.Fatal("publication did not finish")
				}
				var succeeded int
				query := "SELECT COUNT(*) FROM delivery_snapshots"
				if kind == "documents" {
					query = "SELECT COUNT(*) FROM business_documents WHERE status='succeeded'"
				}
				if err = db.QueryRow(query).Scan(&succeeded); err != nil || succeeded != 0 {
					t.Fatalf("lost owner committed publication: count=%d error=%v", succeeded, err)
				}
				app.Close()
				replacement, err := api.OpenMySQL(dir, dsn)
				if err != nil {
					t.Fatal("restart after request completed:", err)
				}
				defer replacement.Close()
				published := request(t, replacement, "POST", path, body, 201)
				readPath := "/api/v1/deliveries/" + published["id"].(string) + "/evidence/screen.png"
				if kind == "documents" {
					readPath = "/api/v1/documents/" + published["id"].(string) + "/html"
					if published["attempts"] != float64(2) || published["version"] != float64(1) {
						t.Fatal("retry changed reserved version:", published)
					}
				}
				w := httptest.NewRecorder()
				replacement.Handler().ServeHTTP(w, localRequest("GET", readPath, nil))
				if w.Code != 200 || w.Body.Len() == 0 {
					t.Fatal("retried publication lost files:", w.Code)
				}
			})
		}
	}
}

// File size limits belong in a child process so other tests and driver writes
// cannot inherit the injected ENOSPC-like short write.
func TestMySQLBindingWriteFailureHelper(t *testing.T) {
	config := os.Getenv("ACCEPTANCES_BINDING_WRITE_FAULT")
	if config == "" {
		return
	}
	dsn, err := os.ReadFile(filepath.Join(config, "dsn"))
	if err != nil {
		t.Fatal(err)
	}
	var limit syscall.Rlimit
	if err = syscall.Getrlimit(syscall.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	limit.Cur = 8
	signal.Ignore(syscall.SIGXFSZ)
	if err = syscall.Setrlimit(syscall.RLIMIT_FSIZE, &limit); err != nil {
		t.Fatal(err)
	}
	if app, err := api.OpenMySQL(filepath.Join(config, "data"), string(dsn)); err == nil {
		app.Close()
		t.Fatal("write fault was not reached")
	} else if !errors.Is(err, syscall.EFBIG) {
		t.Fatal("startup failed before the intended short write:", err)
	}
}

func TestMySQLBindingRejectsCorruptionWithoutChangingFiles(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	dir := t.TempDir()
	app := openLegacyMySQL(t, dir, dsn)
	app.Close()
	path := filepath.Join(dir, ".mysql-storage.json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dir, "evidence", "retained")
	if err = os.WriteFile(sentinel, []byte("must not be cleaned before binding validation"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, binding := range []string{`{"archiv`, `{"archiveId":"another-archive","database":"another-database"}`} {
		if err = os.WriteFile(path, []byte(binding), 0600); err != nil {
			t.Fatal(err)
		}
		if other, err := api.OpenMySQL(dir, dsn); err == nil {
			other.Close()
			t.Fatal("invalid binding was accepted")
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != binding {
			t.Fatal("startup replaced an existing invalid binding")
		}
		if _, err = os.Stat(sentinel); err != nil {
			t.Fatal("startup cleaned files with an invalid binding:", err)
		}
	}
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestMySQLBindingWriteFailureCanRetry(t *testing.T) {
	dsn, _ := isolatedMySQL(t)
	var err error
	bootstrap := openLegacyMySQL(t, t.TempDir(), dsn)
	bootstrap.Close()
	dir := t.TempDir()
	// Explicitly request the legacy filesystem adapter in the child process.
	if err = os.MkdirAll(filepath.Join(dir, "data", "evidence"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "dsn"), []byte(dsn), 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "-test.run=^TestMySQLBindingWriteFailureHelper$")
	command.Env = append(os.Environ(), "ACCEPTANCES_BINDING_WRITE_FAULT="+dir)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("binding short-write fault: %v\n%s", err, output)
	}
	dataDir := filepath.Join(dir, "data")
	if _, err = os.Stat(filepath.Join(dataDir, ".mysql-storage.json")); !errors.Is(err, os.ErrNotExist) {
		t.Error("failed write left a partial final binding")
	}
	app, err := api.OpenMySQL(dataDir, dsn)
	if err != nil {
		t.Fatal("storage recovered but binding could not be retried:", err)
	}
	defer app.Close()
	request(t, app, "POST", "/api/v1/projects", `{"name":"binding recovered"}`, 201)
	leftovers, err := filepath.Glob(filepath.Join(dataDir, ".mysql-storage-*.tmp"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("temporary bindings leaked: %v %v", leftovers, err)
	}
}

func killMySQLLease(t *testing.T, db *sql.DB) {
	t.Helper()
	var owner uint64
	if err := db.QueryRow("SELECT IS_USED_LOCK(CONCAT('acceptances:',LEFT(SHA2(DATABASE(),256),48)))").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	// Only an isolated acceptances_test_ database created by this test is used.
	if _, err := db.Exec("KILL CONNECTION " + fmt.Sprint(owner)); err != nil {
		t.Fatal(err)
	}
}
