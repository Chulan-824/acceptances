package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/model"
)

type savedSession struct {
	User      model.User `json:"user"`
	Token     string     `json:"token"`
	ExpiresAt time.Time  `json:"expiresAt"`
}

func (c *client) loadSession() error {
	path, err := configPath("sessions", c.base)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var session savedSession
	if err = json.Unmarshal(raw, &session); err != nil {
		return fmt.Errorf("read saved session: %w", err)
	}
	if time.Now().Before(session.ExpiresAt) {
		c.token = session.Token
	}
	return nil
}

func authCommand(command, base, username string, passwordStdin bool, input io.Reader) (any, error) {
	if base == "" {
		base = "http://127.0.0.1:8765"
	}
	base = strings.TrimRight(base, "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, fmt.Errorf("invalid service URL")
	}
	if parsed.Scheme != "https" && parsed.Hostname() != "localhost" && !net.ParseIP(parsed.Hostname()).IsLoopback() {
		return nil, fmt.Errorf("remote login requires an HTTPS service URL")
	}
	c := client{base: base}
	if command == "login" {
		if username == "" || !passwordStdin {
			return nil, fmt.Errorf("login requires --username <name> --password-stdin [--url <server>]; register in the Web app first")
		}
		raw, err := io.ReadAll(io.LimitReader(input, 4097))
		if err != nil {
			return nil, err
		}
		if len(raw) > 4096 {
			return nil, fmt.Errorf("password input is too long")
		}
		password := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
		payload, _ := json.Marshal(map[string]string{"username": username, "password": password, "client": "cli"})
		response, err := c.request("POST", "/auth/login", bytes.NewReader(payload), "application/json")
		if err != nil {
			return nil, err
		}
		var session savedSession
		if err = json.Unmarshal(response, &session); err != nil {
			return nil, err
		}
		if session.Token == "" || session.User.ID == "" || session.ExpiresAt.IsZero() {
			return nil, fmt.Errorf("invalid login response")
		}
		path, err := configPath("sessions", base)
		if err != nil {
			return nil, err
		}
		if err = saveJSON(path, session); err != nil {
			return nil, err
		}
		return map[string]any{"user": session.User, "expiresAt": session.ExpiresAt}, nil
	}
	if err = c.loadSession(); err != nil {
		return nil, err
	}
	if command == "whoami" {
		return c.request("GET", "/auth/me", nil, "")
	}
	if c.token != "" {
		if _, err = c.request("POST", "/auth/logout", nil, ""); err != nil {
			return nil, err
		}
	}
	path, err := configPath("sessions", base)
	if err != nil {
		return nil, err
	}
	if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return map[string]bool{"loggedOut": true}, nil
}
