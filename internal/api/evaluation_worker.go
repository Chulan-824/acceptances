package api

import (
	"bytes"
	"context"
	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"time"
)

func (s *Server) jobContext(ctx context.Context, j *job) (context.Context, func()) {
	work, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-work.Done():
				return
			case <-tick.C:
				tag, err := s.Store.Pool.Exec(work, "UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND state='running' AND lease_until>now() AND deadline_at>now()", j.ID, j.Owner, j.Fence)
				if err != nil || tag.RowsAffected() != 1 {
					cancel()
					return
				}
			}
		}
	}()
	return work, func() { cancel(); <-done }
}

func (s *Server) evaluateJob(ctx context.Context, j *job) error {
	ctx, stop := s.jobContext(ctx, j)
	defer stop()
	var id, ruleset string
	var raw []byte
	p := identity.Principal{ProjectID: j.Project}
	if err := s.Store.Pool.QueryRow(ctx, `SELECT requested_evaluation_id::text,auth_id::text,auth_owner,auth_epoch,ruleset_version FROM jobs WHERE id=$1`, j.ID).Scan(&id, &p.ID, &p.Owner, &p.Epoch, &ruleset); err != nil {
		return err
	}
	if ruleset != protocol.RulesetVersion {
		return protocol.Failure("UNSUPPORTED_VERSION", "", "unsupported reevaluation ruleset")
	}
	tx, err := s.Auth.BeginWrite(ctx, p)
	if err != nil {
		return err
	}
	tx.Rollback(ctx)
	if err = s.Store.Pool.QueryRow(ctx, "SELECT projection FROM evaluations WHERE project_id=$1 AND revision_id=$2 AND initial", j.Project, j.Revision).Scan(&raw); err != nil {
		return err
	}
	evaluation, err := decodeMap(raw)
	if err != nil {
		return err
	}
	evaluation["id"] = id
	evaluation["evaluatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := map[string]any{"items": []any{map[string]any{"resultRef": map[string]any{"revisionId": j.Revision}}}}
	if !s.snapshotIntegrity(ctx, j.Project, snapshot) {
		for _, v := range list(evaluation["results"]) {
			result := object(v)
			result["eligible"] = false
			evaluation["diagnostics"] = append(list(evaluation["diagnostics"]), map[string]any{"code": "INTEGRITY_INVALID", "resourceId": text(result, "resultId"), "message": "registered evidence integrity invalid"})
		}
	}
	raw, err = protocol.Canonical(evaluation)
	if err != nil {
		return err
	}
	if _, err = protocol.ValidateDocument("evaluation", raw); err != nil {
		return err
	}
	candidate, err := s.Storage.Put(ctx, j.Project, bytes.NewReader(raw), int64(len(raw)), protocol.Digest(raw))
	if err != nil {
		return err
	}
	tx, err = s.Auth.BeginWrite(ctx, p)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var valid bool
	if err = tx.QueryRow(ctx, "SELECT state='running' AND lease_owner=$2 AND fence=$3 AND lease_until>now() AND deadline_at>now() FROM jobs WHERE id=$1 FOR UPDATE", j.ID, j.Owner, j.Fence).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return protocol.Failure("REVISION_FROZEN", "", "evaluation job lease lost")
	}
	if err = s.Storage.Select(ctx, tx, candidate); err != nil {
		return err
	}
	inputRaw, err := protocol.Canonical(map[string]any{"revisionRef": evaluation["revisionRef"], "rulesetVersion": ruleset})
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO evaluations(project_id,id,revision_id,ruleset_version,input_digest,sha256,raw_asset_id,initial,projection) VALUES($1,$2,$3,$4,$5,$6,$7,false,$8)", j.Project, id, j.Revision, ruleset, protocol.Digest(inputRaw), candidate.SHA256, candidate.ID, raw); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO immutable_documents(project_id,document_id,kind,raw_asset_id,sha256,schema_version,projection) VALUES($1,$2,'evaluation',$3,$4,$5,$6)", j.Project, id, candidate.ID, candidate.SHA256, protocol.SchemaVersion, raw); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE jobs SET state='complete',lease_until=NULL WHERE id=$1 AND fence=$2", j.ID, j.Fence); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
