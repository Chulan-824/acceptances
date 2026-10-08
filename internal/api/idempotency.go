package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/jackc/pgx/v5"
)

type requestBytesKey struct{}

func rememberBody(r *http.Request, raw []byte) {
	*r = *r.WithContext(context.WithValue(r.Context(), requestBytesKey{}, append([]byte(nil), raw...)))
}
func requestDigest(r *http.Request) string {
	raw, _ := r.Context().Value(requestBytesKey{}).([]byte)
	value := map[string]any{"method": r.Method, "path": r.URL.Path, "contentType": r.Header.Get("Content-Type"), "ifMatch": r.Header.Get("If-Match"), "bodySHA256": protocol.Digest(raw)}
	b, _ := protocol.Canonical(value)
	return protocol.Digest(b)
}
func idempotency(r *http.Request, tx pgx.Tx, project string) (json.RawMessage, int, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 256 || strings.ContainsAny(key, "\r\n\x00") {
		return nil, 0, protocol.Failure("INVALID_ARGUMENT", "", "Idempotency-Key required, at most 256 bytes")
	}
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", project+"|"+r.Method+"|"+r.URL.Path+"|"+key); err != nil {
		return nil, 0, err
	}
	var raw json.RawMessage
	var status int
	var hash string
	err := tx.QueryRow(r.Context(), "SELECT request_digest,response_resource,status FROM idempotency_records WHERE project_id=$1 AND operation=$2 AND resource_key=$3 AND key=$4", project, r.Method, r.URL.Path, key).Scan(&hash, &raw, &status)
	if err == pgx.ErrNoRows {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	if hash != requestDigest(r) {
		return nil, 0, protocol.Failure("IDEMPOTENCY_CONFLICT", "", "same key used with different request bytes or preconditions")
	}
	return raw, status, nil
}
func rememberResponse(r *http.Request, tx pgx.Tx, project string, status int, value any) error {
	_, err := tx.Exec(r.Context(), "INSERT INTO idempotency_records(project_id,operation,resource_key,key,request_digest,response_resource,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", project, r.Method, r.URL.Path, r.Header.Get("Idempotency-Key"), requestDigest(r), rawJSON(value), status)
	return err
}
func replay(w http.ResponseWriter, r *http.Request, tx pgx.Tx, project string) (bool, error) {
	value, status, err := idempotency(r, tx, project)
	if err != nil {
		return false, err
	}
	if value != nil {
		reply(w, status, value)
		return true, nil
	}
	return false, nil
}
