package api

import "context"

func (s *Server) housekeeping(ctx context.Context) {
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var mode string
	if err = tx.QueryRow(ctx, "SELECT mode FROM installation_control WHERE id=1 FOR SHARE").Scan(&mode); err != nil || mode != "normal" {
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE jobs SET state='failed',last_error='DEADLINE_EXCEEDED',lease_until=NULL,fence=fence+1 WHERE state IN('pending','running') AND deadline_at<=now()`); err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE report_revisions r SET phase='failed',failure_code='DEADLINE_EXCEEDED',retryable=true,resume_phase='verifying' WHERE phase='verifying' AND EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=r.project_id AND j.revision_id=r.id AND j.generation=r.generation AND j.state='failed' AND j.last_error='DEADLINE_EXCEEDED')`); err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE report_revisions r SET phase='expired',failure_code='DRAFT_EXPIRED',retryable=false WHERE phase IN('draft','uploading','failed') AND updated_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=r.project_id AND j.revision_id=r.id AND (j.state='pending' OR (j.state='running' AND j.lease_until>now()))) AND NOT EXISTS(SELECT 1 FROM revision_assets a WHERE a.project_id=r.project_id AND a.revision_id=r.id AND a.upload_deadline>now())`); err != nil {
		return
	}
	if err = tx.Commit(ctx); err != nil {
		return
	}
	s.Storage.Collect(ctx)
}
