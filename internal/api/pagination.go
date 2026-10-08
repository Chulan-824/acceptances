package api

import (
	"encoding/base64"
	"encoding/json"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"time"
)

type Cursor struct {
	Time  time.Time `json:"time"`
	ID    string    `json:"id"`
	Scope string    `json:"scope"`
}

func encodeCursor(c Cursor, scope string) string {
	c.Scope = scope
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}
func decodeCursor(raw, scope string) (Cursor, error) {
	if raw == "" {
		return Cursor{Time: time.Unix(0, 0), ID: "00000000-0000-0000-0000-000000000000", Scope: scope}, nil
	}
	var c Cursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(b) > 1024 {
		return c, protocol.Failure("INVALID_ARGUMENT", "/cursor", "invalid cursor")
	}
	if json.Unmarshal(b, &c) != nil || c.Scope != scope || !protocol.ValidID(c.ID) {
		return c, protocol.Failure("INVALID_ARGUMENT", "/cursor", "cursor does not match query")
	}
	return c, nil
}
