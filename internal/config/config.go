package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	DatabaseURL  string
	DataDir      string
	PublicOrigin string
}

func Load() (Config, error) {
	c := Config{DataDir: os.Getenv("ACCEPTANCES_DATA_DIR"), PublicOrigin: os.Getenv("ACCEPTANCES_PUBLIC_ORIGIN")}
	if c.DataDir == "" {
		c.DataDir = "/var/lib/acceptances"
	}
	if c.PublicOrigin == "" {
		c.PublicOrigin = "http://127.0.0.1:8765"
	}
	origin, err := url.Parse(c.PublicOrigin)
	if err != nil || origin.Scheme != "http" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || (origin.Hostname() != "127.0.0.1" && origin.Hostname() != "localhost" && origin.Hostname() != "::1") {
		return c, fmt.Errorf("ACCEPTANCES_PUBLIC_ORIGIN must be a loopback HTTP origin")
	}
	if !filepath.IsAbs(c.DataDir) {
		return c, fmt.Errorf("ACCEPTANCES_DATA_DIR must be absolute")
	}
	c.DatabaseURL, err = Secret("ACCEPTANCES_DATABASE_URL")
	if err != nil {
		return c, err
	}
	// Compose may supply a password-free DSN plus the same mounted PostgreSQL password secret.
	if f := os.Getenv("ACCEPTANCES_DATABASE_PASSWORD_FILE"); f != "" {
		if os.Getenv("ACCEPTANCES_DATABASE_URL_FILE") != "" {
			return c, fmt.Errorf("database secret sources conflict")
		}
		raw, err := readSecret(f)
		if err != nil {
			return c, err
		}
		u, err := url.Parse(c.DatabaseURL)
		if err != nil || u.Scheme != "postgres" || u.User == nil {
			return c, fmt.Errorf("database password file requires a password-free postgres URL")
		}
		if _, set := u.User.Password(); set {
			return c, fmt.Errorf("database secret sources conflict")
		}
		u.User = url.UserPassword(u.User.Username(), raw)
		c.DatabaseURL = u.String()
	}
	if provider := os.Getenv("ACCEPTANCES_STORAGE_PROVIDER"); provider != "" && provider != "local" {
		return c, fmt.Errorf("only local storage has been implemented")
	}
	return c, nil
}
func Secret(name string) (string, error) {
	v, has := os.LookupEnv(name)
	f, file := os.LookupEnv(name + "_FILE")
	if has && file {
		return "", fmt.Errorf("%s secret sources conflict", name)
	}
	if file {
		return readSecret(f)
	}
	if has && v == "" {
		return "", fmt.Errorf("%s must not be empty", name)
	}
	return v, nil
}
func readSecret(name string) (string, error) {
	if !filepath.IsAbs(name) {
		return "", fmt.Errorf("secret file must be absolute")
	}
	info, err := os.Stat(name)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("secret file unavailable")
	}
	if info.Size() > 16384 {
		return "", fmt.Errorf("secret file too large")
	}
	raw, err := os.ReadFile(name)
	if err != nil {
		return "", fmt.Errorf("secret file unavailable")
	}
	value := strings.TrimRight(string(raw), "\r\n")
	if value == "" {
		return "", fmt.Errorf("secret file is empty")
	}
	return value, nil
}
