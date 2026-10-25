package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStartupRequiresMySQLWithoutCreatingLocalDatabase(t *testing.T) {
	for _, tc := range []struct {
		name         string
		args         []string
		driver, want string
	}{
		{name: "default requires connection", want: "需要连接配置"},
		{name: "unsupported driver", args: []string{"--database=sqlite"}, want: "仅支持 mysql"},
		{name: "unsupported environment", driver: "sqlite", want: "仅支持 mysql"},
		{name: "removed import", args: []string{"--migrate-sqlite"}, want: "flag provided but not defined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "data")
			t.Setenv("ACCEPTANCES_DB_DRIVER", tc.driver)
			t.Setenv("ACCEPTANCES_MYSQL_DSN", "")
			t.Setenv("ACCEPTANCES_MYSQL_DSN_FILE", "")
			t.Setenv("ACCEPTANCES_DATA_DIR", directory)
			original := os.Args
			os.Args = append([]string{"server"}, tc.args...)
			t.Cleanup(func() { os.Args = original })
			if err := run(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("startup error = %v", err)
			}
			if _, err := os.Stat(directory); !os.IsNotExist(err) {
				t.Fatalf("failed startup created local storage: %v", err)
			}
		})
	}
}
