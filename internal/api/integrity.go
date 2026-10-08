package api

import (
	"context"
)

// InvalidateIntegrity preserves execution facts and forces an explicitly invalid current basis.
func (s *Server) invalidateIntegrity(ctx context.Context, project, revision string) error {
	tx, err := s.Store.Pool.Begin(ctx)
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
	var campaign string
	if err = tx.QueryRow(ctx, "SELECT run.campaign_id::text FROM report_revisions rev JOIN runs run ON run.project_id=rev.project_id AND run.id=rev.run_id WHERE rev.project_id=$1 AND rev.id=$2", project, revision).Scan(&campaign); err != nil {
		return err
	}
	var ignored string
	if err = tx.QueryRow(ctx, "SELECT id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&ignored); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "UPDATE report_revisions SET integrity_invalid=true WHERE project_id=$1 AND id=$2 AND NOT integrity_invalid", project, revision)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		if _, err = tx.Exec(ctx, "UPDATE campaigns SET current_snapshot_id=NULL,basis_version=basis_version+1 WHERE project_id=$1 AND id=$2", project, campaign); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Server) snapshotIntegrity(ctx context.Context, project string, snapshot map[string]any) bool {
	checked := map[string]bool{}
	for _, v := range list(snapshot["items"]) {
		ref := object(object(v)["resultRef"])
		revision := text(ref, "revisionId")
		if revision == "" || checked[revision] {
			continue
		}
		checked[revision] = true
		rows, err := s.Store.Pool.Query(ctx, `SELECT report_asset_id::text FROM report_revisions WHERE project_id=$1 AND id=$2 UNION ALL SELECT manifest_asset_id::text FROM report_revisions WHERE project_id=$1 AND id=$2 UNION ALL SELECT selected_object_id::text FROM revision_assets WHERE project_id=$1 AND revision_id=$2 UNION ALL SELECT raw_asset_id::text FROM evaluations WHERE project_id=$1 AND revision_id=$2 UNION ALL SELECT d.raw_asset_id::text FROM report_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.manifest->'documents') ref JOIN immutable_documents d ON d.project_id=r.project_id AND d.document_id=(ref->>'id')::uuid WHERE r.project_id=$1 AND r.id=$2`, project, revision)
		if err != nil {
			return false
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if rows.Scan(&id) != nil {
				rows.Close()
				return false
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return false
		}
		for _, id := range ids {
			if err = s.verifyObject(ctx, project, id); err != nil {
				s.invalidateIntegrity(ctx, project, revision)
				return false
			}
		}
	}
	return true
}
