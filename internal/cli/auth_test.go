package cli

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestLoginCredentialsAndLogout(t *testing.T) {
	t.Setenv("ACCEPTANCES_CONFIG_DIR", t.TempDir())
	const secret = "synthetic-session-secret"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/login" {
			fmt.Fprintf(w, `{"user":{"id":"user-1","username":"alice"},"token":%q,"expiresAt":"2099-01-01T00:00:00Z"}`, secret)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+secret {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"code":"AUTH_REQUIRED"}`)
			return
		}
		if r.URL.Path == "/api/v1/auth/logout" {
			w.WriteHeader(204)
			return
		}
		fmt.Fprint(w, `{"items":[],"id":"user-1","username":"alice"}`)
	}))
	defer server.Close()
	result, err := authCommand("login", server.URL, "alice", true, strings.NewReader("sample password\n"))
	if err != nil {
		t.Fatal(err)
	}
	var receipt bytes.Buffer
	fmt.Fprint(&receipt, result)
	if strings.Contains(receipt.String(), secret) {
		t.Fatal("login receipt leaked token")
	}
	path, err := configPath("sessions", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credentials are not private")
	}
	var out, log bytes.Buffer
	if code := Run([]string{"projects", "--url", server.URL, "--repo", t.TempDir()}, &out, &log); code != 0 {
		t.Fatal(log.String())
	}
	if _, err := authCommand("whoami", server.URL, "", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := authCommand("logout", server.URL, "", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("credential file not removed")
	}
	if _, err := authCommand("whoami", server.URL, "", false, nil); err == nil {
		t.Fatal("whoami worked after logout")
	}
	if _, err := authCommand("login", "http://example.com", "alice", true, strings.NewReader("password")); err == nil {
		t.Fatal("remote plaintext login allowed")
	}
}
