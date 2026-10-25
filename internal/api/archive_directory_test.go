package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestArchiveDirectoryLockHelper(t *testing.T) {
	dir := os.Getenv("ACCEPTANCES_DIRECTORY_LOCK_CHECK")
	if dir == "" {
		return
	}
	var app *api.Server
	var err error
	if dsnFile := os.Getenv("ACCEPTANCES_DIRECTORY_LOCK_DSN_FILE"); dsnFile != "" {
		dsn, readErr := os.ReadFile(dsnFile)
		if readErr != nil {
			t.Fatal(readErr)
		}
		app, err = api.OpenMySQL(dir, string(dsn))
	} else {
		t.Fatal("missing isolated MySQL DSN")
	}
	if err == nil {
		app.Close()
		t.Fatal("another process took the active archive directory")
	}
	if !strings.Contains(err.Error(), "archive directory is already in use") && !strings.Contains(err.Error(), "MySQL archive is already in use") {
		t.Fatal("startup failed for a reason other than the directory lock:", err)
	}
}

func assertArchiveLockedInOtherProcess(t *testing.T, dir, dsn string) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "-test.run=^TestArchiveDirectoryLockHelper$")
	command.Env = append(os.Environ(), "ACCEPTANCES_DIRECTORY_LOCK_CHECK="+dir)
	if dsn != "" {
		dsnFile := filepath.Join(t.TempDir(), "dsn")
		if err = os.WriteFile(dsnFile, []byte(dsn), 0600); err != nil {
			t.Fatal(err)
		}
		command.Env = append(command.Env, "ACCEPTANCES_DIRECTORY_LOCK_DSN_FILE="+dsnFile)
	}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("cross-process directory lock: %v\n%s", err, output)
	}
}

func TestArchiveDirectoryOwnershipIncludesRequestCleanup(t *testing.T) {
	dir := t.TempDir()
	app, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	assertArchiveLockedInOtherProcess(t, dir, archiveDSN(t, dir))
	reached, resume, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var resumeOnce sync.Once
	unblock := func() { resumeOnce.Do(func() { close(resume) }) }
	defer unblock()
	handler := app.Guard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(reached)
		<-resume
	}))
	go func() {
		defer close(done)
		handler.ServeHTTP(httptest.NewRecorder(), localRequest("GET", "/", nil))
	}()
	<-reached
	if err = app.Close(); err != nil {
		t.Fatal(err)
	}
	assertArchiveLockedInOtherProcess(t, dir, archiveDSN(t, dir))
	unblock()
	<-done
	replacement, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.Close()
	app.Close() // A stale repeated Close must not release the new owner's lock.
	assertArchiveLockedInOtherProcess(t, dir, archiveDSN(t, dir))
	response := httptest.NewRecorder()
	app.Handler().ServeHTTP(response, localRequest("GET", "/api/v1/projects", nil))
	if response.Code != 503 {
		t.Fatalf("closed archive: %d", response.Code)
	}
}
