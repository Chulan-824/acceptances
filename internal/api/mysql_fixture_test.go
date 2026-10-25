package api_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
	"github.com/Chulan-824/acceptances/internal/testmysql"
)

var archiveDSNs sync.Map

func isolatedMySQL(t *testing.T) (string, *sql.DB) { t.Helper(); return testmysql.New(t) }

// Existing filesystem publication tests exercise the retained MySQL file-import
// compatibility path; database-file tests separately cover the current default.
func openArchive(t *testing.T, dir string) (*api.Server, error) {
	t.Helper()
	value, ok := archiveDSNs.Load(dir)
	if !ok {
		dsn, _ := isolatedMySQL(t)
		value = dsn
		archiveDSNs.Store(dir, dsn)
		t.Cleanup(func() { archiveDSNs.Delete(dir) })
		if err := os.MkdirAll(filepath.Join(dir, "evidence"), 0700); err != nil {
			return nil, err
		}
	}
	return api.OpenMySQL(dir, value.(string))
}

func openLegacyMySQL(t *testing.T, dir, dsn string) *api.Server {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "evidence"), 0700); err != nil {
		t.Fatal(err)
	}
	app, err := api.OpenMySQL(dir, dsn)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func archiveDSN(t *testing.T, dir string) string {
	t.Helper()
	value, ok := archiveDSNs.Load(dir)
	if !ok {
		t.Fatal("no isolated archive for directory")
	}
	return value.(string)
}
