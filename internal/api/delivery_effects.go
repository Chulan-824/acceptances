package api

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
)

// Effect transitions never rewrite frozen payloads. They share the transaction
// with the judgment/void/delete that removed the basis for current acceptance.
func transitionDeliveries(ctx context.Context, tx *sql.Tx, where string, args []any, kind, reason, reference, at string) error {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM delivery_snapshots WHERE "+where, args...)
	if err != nil {
		return err
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, key := range keys {
		if kind == "superseded" {
			_, err = tx.ExecContext(ctx, "UPDATE delivery_snapshots SET status=?,successor_id=? WHERE id=?", kind, reference, key)
		} else {
			_, err = tx.ExecContext(ctx, "UPDATE delivery_snapshots SET status=? WHERE id=?", kind, key)
		}
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO delivery_events VALUES(?,?,?,?,?,?)", id(), key, kind, reason, reference, at); err != nil {
			return err
		}
	}
	return nil
}

func invalidateRunDeliveries(ctx context.Context, tx *sql.Tx, runID, reason, reference string) error {
	return transitionDeliveries(ctx, tx, "source_run_id=? AND status IN ('valid','superseded')", []any{runID}, "invalidated", reason, reference, now())
}

func (s *Server) revokeDelivery(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Reason string `json:"reason"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if input.Reason == "" {
		deliveryFailure(w, 400, "REASON_REQUIRED", "撤销交付必须填写原因。")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, err := s.delivery(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	if snapshot.Status == "revoked" {
		respond(w, 200, snapshot)
		return
	}
	if snapshot.Status != "valid" && snapshot.Status != "superseded" {
		deliveryFailure(w, 409, "DELIVERY_ALREADY_INACTIVE", "该交付已失效，无需重复撤销。")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	err = transitionDeliveries(r.Context(), tx, "id=?", []any{snapshot.ID}, "revoked", input.Reason, "", now())
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	s.respondDelivery(w, r, snapshot.ID, 200)
}
