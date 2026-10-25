package api

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "acceptances_session"
const sessionLifetime = 7 * 24 * time.Hour

var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("unknown account timing check"), 12)

type authAttempt struct {
	count int
	until time.Time
}

func publicOrigin() (string, error) {
	value := strings.TrimRight(os.Getenv("ACCEPTANCES_PUBLIC_ORIGIN"), "/")
	if value == "" {
		return "", nil
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", errors.New("ACCEPTANCES_PUBLIC_ORIGIN 必须是完整的 HTTP/HTTPS 源地址")
	}
	if u.Scheme != "https" && !loopbackHost(u.Hostname()) {
		return "", errors.New("远程服务的 ACCEPTANCES_PUBLIC_ORIGIN 必须使用 HTTPS")
	}
	return value, nil
}

func loopbackHost(host string) bool {
	return host == "localhost" || net.ParseIP(host).IsLoopback()
}

func (s *Server) registerAuth(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/register", s.registerUser)
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("GET /api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, model.CurrentUser(r.Context()))
	})
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
}

func (s *Server) allowAuthAttempt(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if s.authAttempts == nil {
		s.authAttempts = make(map[string]authAttempt)
	}
	for key, attempt := range s.authAttempts {
		if time.Now().After(attempt.until) {
			delete(s.authAttempts, key)
		}
	}
	attempt := s.authAttempts[host]
	if attempt.count == 0 {
		attempt.until = time.Now().Add(10 * time.Minute)
	}
	attempt.count++
	s.authAttempts[host] = attempt
	return attempt.count <= 30
}

func (s *Server) authInput(w http.ResponseWriter, r *http.Request) (string, string, bool, bool) {
	if !s.allowAuthAttempt(r) {
		w.Header().Set("Retry-After", "600")
		fail(w, http.StatusTooManyRequests, "AUTH_RATE_LIMITED")
		return "", "", false, false
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "JSON_REQUIRED")
		return "", "", false, false
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Client   string `json:"client"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if !decode(w, r, &in) {
		return "", "", false, false
	}
	if in.Client != "" && in.Client != "cli" {
		fail(w, http.StatusBadRequest, "INVALID_INPUT")
		return "", "", false, false
	}
	return strings.ToLower(strings.TrimSpace(in.Username)), in.Password, in.Client == "cli", true
}

func validUsername(value string) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < 3 || utf8.RuneCountInString(value) > 32 {
		return false
	}
	for _, char := range value {
		if !unicode.IsLetter(char) && !unicode.IsDigit(char) && !strings.ContainsRune("_.-", char) {
			return false
		}
	}
	return true
}

func (s *Server) registerUser(w http.ResponseWriter, r *http.Request) {
	username, password, cli, ok := s.authInput(w, r)
	if !ok {
		return
	}
	if !validUsername(username) || !utf8.ValidString(password) || utf8.RuneCountInString(password) < 7 || len(password) > 72 {
		fail(w, http.StatusBadRequest, "INVALID_CREDENTIALS_FORMAT")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	user := model.User{ID: id(), Username: username}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), "INSERT INTO users(id,username,created_at) VALUES(?,?,?)", user.ID, user.Username, time.Now().UTC())
	if duplicate, ok := errors.AsType[*mysql.MySQLError](err); ok && duplicate.Number == 1062 {
		fail(w, http.StatusConflict, "USERNAME_TAKEN")
		return
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO local_credentials(user_id,password_hash) VALUES(?,?)", user.ID, hash)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	s.startSession(w, r, user, cli, http.StatusCreated)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	username, password, cli, ok := s.authInput(w, r)
	if !ok {
		return
	}
	var user model.User
	var hash []byte
	err := s.db.QueryRowContext(r.Context(), "SELECT u.id,u.username,c.password_hash FROM users u JOIN local_credentials c ON c.user_id=u.id WHERE u.username=?", username).Scan(&user.ID, &user.Username, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "READ_FAILED")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		hash = dummyPasswordHash
	}
	valid := bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	if err != nil || !valid {
		fail(w, http.StatusUnauthorized, "LOGIN_FAILED")
		return
	}
	s.startSession(w, r, user, cli, http.StatusOK)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user model.User, cli bool, status int) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	token := hex.EncodeToString(tokenBytes)
	digest := sha256.Sum256([]byte(token))
	expires := time.Now().UTC().Add(sessionLifetime)
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM user_sessions WHERE expires_at<=?", time.Now().UTC()); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	_, err := s.db.ExecContext(r.Context(), "INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", digest[:], user.ID, expires)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	if cli {
		respond(w, status, map[string]any{"user": user, "token": token, "expiresAt": expires})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(s.publicOrigin, "https://") || r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds())})
	respond(w, status, map[string]any{"user": user})
}

func requestToken(r *http.Request) string {
	if header := r.Header.Get("Authorization"); header != "" {
		value, ok := strings.CutPrefix(header, "Bearer ")
		if ok {
			return value
		}
		return ""
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		return cookie.Value
	}
	return ""
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	token := requestToken(r)
	if len(token) != 64 {
		fail(w, http.StatusUnauthorized, "AUTH_REQUIRED")
		return r, false
	}
	digest := sha256.Sum256([]byte(token))
	var user model.User
	err := s.db.QueryRowContext(r.Context(), "SELECT u.id,u.username FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", digest[:], time.Now().UTC()).Scan(&user.ID, &user.Username)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusUnauthorized, "AUTH_REQUIRED")
		return r, false
	}
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return r, false
	}
	if _, err := r.Cookie(sessionCookie); err == nil && r.Header.Get("Authorization") == "" && r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Origin") == "" {
		fail(w, http.StatusForbidden, "ORIGIN_REQUIRED")
		return r, false
	}
	return r.WithContext(model.WithUser(r.Context(), &user)), true
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	digest := sha256.Sum256([]byte(requestToken(r)))
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM user_sessions WHERE token_hash=?", digest[:]); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: strings.HasPrefix(s.publicOrigin, "https://") || r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}
