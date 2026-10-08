package storage

import (
	"context"
	"errors"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"os"
)

// Collect removes unreferenced objects and expired draft objects after a grace period.
// Immutable documents, evaluations, snapshots and sealed evidence are protected.
// The deleting tombstone survives crashes and prevents a concurrent Select.
func (l *Local) Collect(ctx context.Context) error {
	tx, err := l.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var mode string
	if err = tx.QueryRow(ctx, "SELECT mode FROM installation_control WHERE id=1 FOR SHARE").Scan(&mode); err != nil {
		return err
	}
	if mode != "normal" {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT id::text,key FROM stored_objects o WHERE location_id=$1 AND (state='deleting' OR (state IN('candidate','verified') AND created_at<now()-interval '7 days'))
 AND NOT EXISTS(SELECT 1 FROM immutable_documents d WHERE d.raw_asset_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM evaluations e WHERE e.raw_asset_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM acceptance_snapshots s WHERE s.raw_asset_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM report_revisions r WHERE (r.report_asset_id=o.id OR r.manifest_asset_id=o.id) AND r.phase<>'expired')
 AND NOT EXISTS(SELECT 1 FROM revision_assets a JOIN report_revisions r ON r.project_id=a.project_id AND r.id=a.revision_id WHERE a.selected_object_id=o.id AND r.phase<>'expired')
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=o.project_id AND j.state='running' AND j.lease_until>now()) AND NOT EXISTS(SELECT 1 FROM revision_assets a WHERE a.project_id=o.project_id AND a.upload_deadline>now()) ORDER BY created_at LIMIT 32 FOR UPDATE SKIP LOCKED`, l.LocationID)
	if err != nil {
		return err
	}
	type candidate struct{ id, key string }
	objects := []candidate{}
	for rows.Next() {
		var o candidate
		if err = rows.Scan(&o.id, &o.key); err != nil {
			rows.Close()
			return err
		}
		objects = append(objects, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, o := range objects {
		if !protocol.ValidID(o.key) || o.key != o.id {
			return protocol.Failure("STORAGE_UNAVAILABLE", "", "invalid service object key")
		}
		if _, err = tx.Exec(ctx, "UPDATE stored_objects SET state='deleting' WHERE id=$1", o.id); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	for _, o := range objects {
		if err = l.Root.Remove(o.key); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
