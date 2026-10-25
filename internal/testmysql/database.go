// Package testmysql creates disposable databases in the reserved test namespace.
package testmysql

import (
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func New(t *testing.T) (string, *sql.DB) {
	t.Helper()
	path := os.Getenv("ACCEPTANCES_MYSQL_TEST_DSN_FILE")
	if path == "" {
		t.Fatal("MySQL integration tests require ACCEPTANCES_MYSQL_TEST_DSN_FILE; run make test")
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
	admin.SetMaxOpenConns(1)
	name := "acceptances_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.ExecContext(t.Context(), "CREATE DATABASE "+name+" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin"); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	cfg.DBName = name
	dsn := cfg.FormatDSN()
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		admin.Exec("DROP DATABASE " + name)
		admin.Close()
		t.Fatal(err)
	}
	db.SetMaxOpenConns(3)
	t.Cleanup(func() {
		db.Close()
		if _, err := admin.Exec("DROP DATABASE " + name); err != nil {
			t.Error("clean isolated MySQL database:", err)
		}
		admin.Close()
	})
	return dsn, db
}
