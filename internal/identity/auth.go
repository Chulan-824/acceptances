package identity

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/database"
	"github.com/Chulan-824/acceptances/internal/database/queries"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/jackc/pgx/v5"
)

type Principal struct {
	ID        string
	Owner     bool
	ProjectID string
	Scopes    []string
	Epoch     int64
	CSRF      string
}
type Auth struct{ Store *database.Store }

func secret() string {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		panic("system random source unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}
func csrf(secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte("acceptances-session-csrf-v1"))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func (a *Auth) Authenticate(r *http.Request) (Principal, error) {
	if header := r.Header.Get("Authorization"); header != "" {
		if !strings.HasPrefix(header, "Bearer acp_") {
			return Principal{}, protocol.Failure("AUTH_REQUIRED", "", "invalid authentication")
		}
		return a.token(r.Context(), strings.TrimPrefix(header, "Bearer acp_"))
	}
	cookie, err := r.Cookie("acceptances_session")
	if err != nil {
		return Principal{}, protocol.Failure("AUTH_REQUIRED", "", "login required")
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 || !protocol.ValidID(parts[0]) {
		return Principal{}, protocol.Failure("AUTH_REQUIRED", "", "invalid authentication")
	}
	p := Principal{ID: parts[0], Owner: true, CSRF: csrf(parts[1])}
	var hash string
	err = a.Store.Pool.QueryRow(r.Context(), `SELECT s.secret_hash,s.auth_epoch FROM sessions s JOIN installation_control c ON c.id=1 WHERE s.id=$1 AND s.revoked_at IS NULL AND s.auth_epoch=c.auth_epoch AND s.expires_at>now() AND s.last_interaction_at>now()-interval '24 hours'`, p.ID).Scan(&hash, &p.Epoch)
	if err != nil || subtle.ConstantTimeCompare([]byte(hash), []byte(protocol.Digest([]byte(parts[1])))) != 1 {
		return Principal{}, protocol.Failure("AUTH_EXPIRED", "", "session expired or invalid")
	}
	return p, nil
}
func (a *Auth) token(ctx context.Context, value string) (Principal, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 || !protocol.ValidID(parts[0]) {
		return Principal{}, protocol.Failure("AUTH_REQUIRED", "", "invalid authentication")
	}
	p := Principal{ID: parts[0]}
	var hash string
	err := a.Store.Pool.QueryRow(ctx, `SELECT t.secret_hash,t.project_id::text,t.scopes,t.auth_epoch FROM api_tokens t JOIN installation_control c ON c.id=1 WHERE t.id=$1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now()) AND t.auth_epoch=c.auth_epoch`, p.ID).Scan(&hash, &p.ProjectID, &p.Scopes, &p.Epoch)
	if err != nil || subtle.ConstantTimeCompare([]byte(hash), []byte(protocol.Digest([]byte(parts[1])))) != 1 {
		return Principal{}, protocol.Failure("AUTH_EXPIRED", "", "token expired or invalid")
	}
	return p, nil
}
func (p Principal) Require(project, scope string) error {
	if p.Owner {
		return nil
	}
	if project == "" || p.ProjectID != project {
		return protocol.Failure("FORBIDDEN", "", "project access denied")
	}
	for _, s := range p.Scopes {
		if s == scope {
			return nil
		}
	}
	return protocol.Failure("FORBIDDEN", "", "required scope missing: "+scope)
}
func (p Principal) CheckCSRF(r *http.Request) error {
	if !p.Owner {
		return nil
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(p.CSRF)) != 1 {
		return protocol.Failure("CSRF_REJECTED", "", "CSRF token missing or invalid")
	}
	return nil
}

// BeginWrite serializes the maintenance barrier, then locks and rechecks the credential.
func (a *Auth) BeginWrite(ctx context.Context, p Principal) (pgx.Tx, error) {
	tx, err := a.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			tx.Rollback(ctx)
		}
	}()
	var mode string
	var epoch int64
	control, err := queries.New(tx).LockControlShared(ctx)
	if err != nil {
		return nil, err
	}
	mode, epoch = control.Mode, control.AuthEpoch
	if mode != "normal" {
		return nil, protocol.Failure("MAINTENANCE", "", "writes unavailable during maintenance")
	}
	if epoch != p.Epoch {
		return nil, protocol.Failure("AUTH_EXPIRED", "", "authorization epoch expired")
	}
	var active bool
	if p.Owner {
		err = tx.QueryRow(ctx, `SELECT revoked_at IS NULL AND expires_at>now() AND last_interaction_at>now()-interval '24 hours' AND auth_epoch=$2 FROM sessions WHERE id=$1 FOR SHARE`, p.ID, epoch).Scan(&active)
	} else {
		err = tx.QueryRow(ctx, `SELECT revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND auth_epoch=$2 FROM api_tokens WHERE id=$1 FOR SHARE`, p.ID, epoch).Scan(&active)
	}
	if err != nil || !active {
		return nil, protocol.Failure("AUTH_EXPIRED", "", "credential revoked or expired")
	}
	ok = true
	return tx, nil
}
func (a *Auth) Login(ctx context.Context, username, password string) (string, string, error) {
	var hash string
	err := a.Store.Pool.QueryRow(ctx, "SELECT password_hash FROM owners WHERE id=1 AND username=$1", username).Scan(&hash)
	if err != nil {
		hash = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}
	valid := VerifyPassword(password, hash)
	if err != nil || !valid {
		return "", "", protocol.Failure("AUTH_REQUIRED", "", "username or password invalid")
	}
	tx, err := a.Store.Pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)
	var mode string
	if err = tx.QueryRow(ctx, "SELECT mode FROM installation_control WHERE id=1 FOR SHARE").Scan(&mode); err != nil {
		return "", "", err
	}
	if mode != "normal" {
		return "", "", protocol.Failure("MAINTENANCE", "", "login unavailable during maintenance")
	}
	var currentHash string
	if err = tx.QueryRow(ctx, "SELECT password_hash FROM owners WHERE id=1 AND username=$1 FOR SHARE", username).Scan(&currentHash); err != nil || currentHash != hash {
		return "", "", protocol.Failure("AUTH_REQUIRED", "", "credentials changed during login")
	}
	id, sec := protocol.NewID(), secret()
	csrfToken := csrf(sec)
	tag, err := tx.Exec(ctx, `INSERT INTO sessions(id,owner_id,secret_hash,csrf_hash,auth_epoch,expires_at) SELECT $1,1,$2,$3,auth_epoch,now()+interval '7 days' FROM installation_control WHERE id=1 AND mode='normal'`, id, protocol.Digest([]byte(sec)), protocol.Digest([]byte(csrfToken)))
	if err != nil {
		return "", "", err
	}
	if tag.RowsAffected() != 1 {
		return "", "", protocol.Failure("MAINTENANCE", "", "session not created")
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return id + "." + sec, csrfToken, nil
}
func (a *Auth) InitOwner(ctx context.Context, username, password string) error {
	if len(strings.TrimSpace(username)) == 0 || len(username) > 128 {
		return protocol.Failure("INVALID_ARGUMENT", "", "username required")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := a.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM installation_control WHERE id=1 FOR UPDATE"); err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM owners)").Scan(&exists); err != nil {
		return err
	}
	if exists {
		return protocol.Failure("ID_CONTENT_CONFLICT", "", "owner already initialized")
	}
	if _, err = tx.Exec(ctx, "INSERT INTO owners(id,username,password_hash) VALUES(1,$1,$2)", username, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (a *Auth) ResetPassword(ctx context.Context, password string, revokeTokens bool) error {
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := a.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM installation_control WHERE id=1 FOR UPDATE"); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "UPDATE owners SET password_hash=$1,credential_version=credential_version+1 WHERE id=1", hash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return protocol.Failure("RESOURCE_NOT_FOUND", "", "owner not initialized")
	}
	if _, err = tx.Exec(ctx, "UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE installation_control SET auth_epoch=auth_epoch+1 WHERE id=1"); err != nil {
		return err
	}
	if !revokeTokens {
		if _, err = tx.Exec(ctx, "UPDATE api_tokens SET auth_epoch=(SELECT auth_epoch FROM installation_control WHERE id=1),version=version+1 WHERE revoked_at IS NULL"); err != nil {
			return err
		}
	}
	if revokeTokens {
		if _, err = tx.Exec(ctx, "UPDATE api_tokens SET revoked_at=now(),version=version+1 WHERE revoked_at IS NULL"); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func NewToken(id string) string { return "acp_" + id + "." + secret() }
func TokenHash(value string) string {
	_, sec, _ := strings.Cut(value, ".")
	return protocol.Digest([]byte(sec))
}
func SetCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{Name: "acceptances_session", Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: int((7 * 24 * time.Hour).Seconds())})
}
