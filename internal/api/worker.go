package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/reviews"
	"github.com/jackc/pgx/v5"
)

type job struct {
	ID, Project, Revision, Run, Campaign, Owner string
	Kind                                        string
	Generation, Fence                           int64
	Principal                                   identity.Principal
	Report, Manifest                            map[string]any
	ReportSHA, ManifestSHA                      string
}

func (s *Server) Work(ctx context.Context) {
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() { defer workers.Done(); s.workLoop(ctx) }()
	}
	workers.Wait()
}
func (s *Server) workLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastCleanup := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(lastCleanup) > time.Minute {
				s.housekeeping(ctx)
				lastCleanup = time.Now()
			}
			j, err := s.claim(ctx)
			if err != nil || j == nil {
				s.refreshPending(ctx)
				continue
			}
			attemptCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
			if strings.HasPrefix(j.Kind, "evaluation/") {
				err = s.evaluateJob(attemptCtx, j)
			} else {
				err = s.seal(attemptCtx, j)
			}
			cancel()
			if err != nil {
				s.fail(ctx, j, err)
			}
		}
	}
}
func (s *Server) claim(ctx context.Context) (*job, error) {
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var mode string
	if err = tx.QueryRow(ctx, "SELECT mode FROM installation_control WHERE id=1 FOR SHARE").Scan(&mode); err != nil || mode != "normal" {
		return nil, err
	}
	j := &job{Owner: protocol.NewID()}
	err = tx.QueryRow(ctx, `UPDATE jobs SET state='running',lease_owner=$1,lease_until=now()+interval '60 seconds',fence=fence+1,attempt_count=attempt_count+1 WHERE id=(SELECT id FROM jobs WHERE (state='pending' OR (state='running' AND lease_until<now())) AND next_attempt_at<=now() AND deadline_at>now() AND attempt_count<5 ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id::text,project_id::text,revision_id::text,generation,fence,kind`, j.Owner).Scan(&j.ID, &j.Project, &j.Revision, &j.Generation, &j.Fence, &j.Kind)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return j, nil
}
func (s *Server) seal(ctx context.Context, j *job) error {
	workCtx, stop := s.jobContext(ctx, j)
	defer stop()
	var reportRaw, manifestRaw []byte
	var reportObject, manifestObject string
	err := s.Store.Pool.QueryRow(workCtx, `SELECT rev.run_id::text,run.campaign_id::text,rev.report,rev.manifest,rev.report_sha256,rev.manifest_sha256,rev.auth_id::text,rev.auth_owner,rev.auth_epoch,rev.report_asset_id::text,rev.manifest_asset_id::text FROM report_revisions rev JOIN runs run ON run.project_id=rev.project_id AND run.id=rev.run_id WHERE rev.project_id=$1 AND rev.id=$2 AND rev.generation=$3 AND (rev.phase='verifying' OR (rev.phase='failed' AND rev.retryable))`, j.Project, j.Revision, j.Generation).Scan(&j.Run, &j.Campaign, &reportRaw, &manifestRaw, &j.ReportSHA, &j.ManifestSHA, &j.Principal.ID, &j.Principal.Owner, &j.Principal.Epoch, &reportObject, &manifestObject)
	if err != nil {
		return err
	}
	j.Principal.ProjectID = j.Project
	j.Report, err = decodeMap(reportRaw)
	if err != nil {
		return err
	}
	j.Manifest, err = decodeMap(manifestRaw)
	if err != nil {
		return err
	}
	tx, err := s.Auth.BeginWrite(workCtx, j.Principal)
	if err != nil {
		return err
	}
	tx.Rollback(workCtx)
	for _, id := range []string{reportObject, manifestObject} {
		if err = s.verifyObject(workCtx, j.Project, id); err != nil {
			return err
		}
	}
	for _, v := range list(j.Manifest["documents"]) {
		var objectID string
		if err = s.Store.Pool.QueryRow(workCtx, "SELECT raw_asset_id::text FROM immutable_documents WHERE project_id=$1 AND document_id=$2", j.Project, text(object(v), "id")).Scan(&objectID); err != nil {
			return err
		}
		if err = s.verifyObject(workCtx, j.Project, objectID); err != nil {
			return err
		}
	}
	assets := map[string]string{}
	assetSeal := []any{}
	rows, err := s.Store.Pool.Query(workCtx, "SELECT asset_id::text,selected_object_id::text,kind,relative_path,size,sha256 FROM revision_assets WHERE project_id=$1 AND revision_id=$2 AND upload_generation=$3 AND verification_state='verified' ORDER BY relative_path", j.Project, j.Revision, j.Generation)
	if err != nil {
		return err
	}
	type entry struct {
		ID, Object, Kind, Path, SHA string
		Size                        int64
	}
	entries := []entry{}
	for rows.Next() {
		var a entry
		if err = rows.Scan(&a.ID, &a.Object, &a.Kind, &a.Path, &a.Size, &a.SHA); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(entries) != len(list(j.Manifest["assets"])) {
		return protocol.Failure("ASSET_INCOMPLETE", "", "verified asset set incomplete")
	}
	for _, a := range entries {
		if err = s.verifyObject(workCtx, j.Project, a.Object); err != nil {
			return err
		}
		assets[a.ID] = a.Kind
		assetSeal = append(assetSeal, map[string]any{"id": a.ID, "path": a.Path, "size": a.Size, "sha256": a.SHA})
	}
	planID := text(object(j.Report["planRef"]), "id")
	targetID := text(object(j.Report["targetRef"]), "id")
	var planRaw, targetRaw []byte
	if err = s.Store.Pool.QueryRow(workCtx, "SELECT projection FROM immutable_documents WHERE project_id=$1 AND document_id=$2", j.Project, planID).Scan(&planRaw); err != nil {
		return err
	}
	if err = s.Store.Pool.QueryRow(workCtx, "SELECT projection FROM immutable_documents WHERE project_id=$1 AND document_id=$2", j.Project, targetID).Scan(&targetRaw); err != nil {
		return err
	}
	plan, err := decodeMap(planRaw)
	if err != nil {
		return err
	}
	target, err := decodeMap(targetRaw)
	if err != nil {
		return err
	}
	checks := map[string][]any{}
	requirements := map[string][]any{}
	for _, v := range list(plan["items"]) {
		item := object(v)
		c, e := object(item["caseRef"]), object(item["executionRef"])
		var raw []byte
		if err = s.Store.Pool.QueryRow(workCtx, "SELECT check_items FROM case_versions WHERE project_id=$1 AND case_id=$2 AND version_id=$3", j.Project, text(c, "id"), text(c, "versionId")).Scan(&raw); err != nil {
			return err
		}
		var checkItems []any
		json.Unmarshal(raw, &checkItems)
		checks[text(item, "id")] = checkItems
		var reqRaw []byte
		if err = s.Store.Pool.QueryRow(workCtx, "SELECT evidence_requirements FROM execution_versions WHERE project_id=$1 AND execution_id=$2 AND version_id=$3", j.Project, text(e, "id"), text(e, "versionId")).Scan(&reqRaw); err != nil {
			return err
		}
		var req []any
		json.Unmarshal(reqRaw, &req)
		requirements[text(item, "id")] = req
	}
	evaluation := reviews.Evaluate(j.Project, j.Revision, j.Run, j.ReportSHA, j.ManifestSHA, j.Report, plan, target, checks, requirements, assets)
	evaluationRaw, err := protocol.Canonical(evaluation)
	if err != nil {
		return err
	}
	if _, err = protocol.ValidateDocument("evaluation", evaluationRaw); err != nil {
		return err
	}
	evaluationSHA := protocol.Digest(evaluationRaw)
	candidate, err := s.Storage.Put(workCtx, j.Project, bytes.NewReader(evaluationRaw), int64(len(evaluationRaw)), evaluationSHA)
	if err != nil {
		return err
	}
	body := map[string]any{"encodingVersion": protocol.EncodingVersion, "projectId": j.Project, "runId": j.Run, "revisionId": j.Revision, "reportSha256": j.ReportSHA, "manifestSha256": j.ManifestSHA, "documentRefs": j.Manifest["documents"], "assets": assetSeal, "rulesetVersion": protocol.RulesetVersion, "initialEvaluationSha256": evaluationSHA}
	sealRaw, err := protocol.Canonical(body)
	if err != nil {
		return err
	}
	tx, err = s.Auth.BeginWrite(workCtx, j.Principal)
	if err != nil {
		return err
	}
	defer tx.Rollback(workCtx)
	var ignored string
	if err = tx.QueryRow(workCtx, "SELECT id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", j.Project, j.Campaign).Scan(&ignored); err != nil {
		return err
	}
	var phase string
	var generation int64
	if err = tx.QueryRow(workCtx, "SELECT phase,generation FROM report_revisions WHERE project_id=$1 AND id=$2 FOR UPDATE", j.Project, j.Revision).Scan(&phase, &generation); err != nil {
		return err
	}
	if (phase != "verifying" && phase != "failed") || generation != j.Generation {
		return protocol.Failure("REVISION_FROZEN", "", "revision generation changed")
	}
	var valid bool
	if err = tx.QueryRow(workCtx, "SELECT state='running' AND lease_owner=$2 AND fence=$3 AND lease_until>now() AND deadline_at>now() FROM jobs WHERE id=$1 FOR UPDATE", j.ID, j.Owner, j.Fence).Scan(&valid); err != nil || !valid {
		return protocol.Failure("REVISION_FROZEN", "", "job lease lost")
	}
	if err = s.validateResults((&http.Request{}).WithContext(workCtx), tx, protocol.Document{ProjectID: j.Project, Value: j.Report}, planID); err != nil {
		return err
	}
	if err = s.Storage.Select(workCtx, tx, candidate); err != nil {
		return err
	}
	if _, err = tx.Exec(workCtx, "INSERT INTO evaluations(project_id,id,revision_id,ruleset_version,input_digest,sha256,raw_asset_id,initial,projection) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)", j.Project, text(evaluation, "id"), j.Revision, protocol.RulesetVersion, protocol.Digest([]byte(j.ReportSHA+j.ManifestSHA)), evaluationSHA, candidate.ID, evaluationRaw); err != nil {
		return err
	}
	if _, err = tx.Exec(workCtx, "INSERT INTO immutable_documents(project_id,document_id,kind,raw_asset_id,sha256,schema_version,projection) VALUES($1,$2,'evaluation',$3,$4,$5,$6)", j.Project, text(evaluation, "id"), candidate.ID, evaluationSHA, protocol.SchemaVersion, evaluationRaw); err != nil {
		return err
	}
	for _, v := range list(j.Report["results"]) {
		result := object(v)
		if _, err = tx.Exec(workCtx, "INSERT INTO case_results(project_id,revision_id,result_id,run_id,plan_item_id,projection) VALUES($1,$2,$3,$4,$5,$6)", j.Project, j.Revision, text(result, "id"), j.Run, text(result, "planItemId"), rawJSON(result)); err != nil {
			return err
		}
		for _, a := range list(result["attempts"]) {
			attempt := object(a)
			if _, err = tx.Exec(workCtx, "INSERT INTO attempts(project_id,revision_id,result_id,id,ordinal,outcome,projection) VALUES($1,$2,$3,$4,$5,$6,$7)", j.Project, j.Revision, text(result, "id"), text(attempt, "id"), integer(attempt["ordinal"]), text(attempt, "outcome"), rawJSON(attempt)); err != nil {
				return err
			}
		}
		for _, p := range list(result["supersedes"]) {
			ref := object(p)
			if _, err = tx.Exec(workCtx, "INSERT INTO result_predecessors(project_id,revision_id,result_id,previous_run_id,previous_revision_id,previous_result_id) VALUES($1,$2,$3,$4,$5,$6)", j.Project, j.Revision, text(result, "id"), text(ref, "runId"), text(ref, "revisionId"), text(ref, "resultId")); err != nil {
				return err
			}
		}
	}
	if _, err = tx.Exec(workCtx, "UPDATE report_revisions SET phase='sealed',seal_digest=$3,sealed_at=now(),updated_at=now() WHERE project_id=$1 AND id=$2", j.Project, j.Revision, protocol.Digest(sealRaw)); err != nil {
		return err
	}
	if _, err = tx.Exec(workCtx, "UPDATE runs SET source_projection=COALESCE(source_projection,$3),observed_projection=COALESCE(observed_projection,$4),started_at=COALESCE(started_at,$5::timestamptz),ended_at=COALESCE(ended_at,$6::timestamptz) WHERE project_id=$1 AND id=$2", j.Project, j.Run, rawJSON(j.Report["sourceSnapshots"]), rawJSON(j.Report["observedBuild"]), text(j.Report, "startedAt"), text(j.Report, "endedAt")); err != nil {
		return err
	}
	if _, err = tx.Exec(workCtx, "UPDATE jobs SET state='complete',lease_until=NULL WHERE id=$1 AND fence=$2", j.ID, j.Fence); err != nil {
		return err
	}
	if _, err = tx.Exec(workCtx, "UPDATE campaigns SET basis_version=basis_version+1,current_snapshot_id=NULL WHERE project_id=$1 AND id=$2", j.Project, j.Campaign); err != nil {
		return err
	}
	return tx.Commit(workCtx)
}
func decodeMap(raw []byte) (map[string]any, error) {
	v, err := protocol.Decode(raw)
	if err != nil {
		return nil, err
	}
	return object(v), nil
}
func (s *Server) verifyObject(ctx context.Context, project, id string) error {
	f, o, err := s.Storage.Read(ctx, project, id)
	if err != nil {
		return err
	}
	defer f.Close()
	n, sha, err := protocol.HashFile(f, o.Size)
	if err != nil || n != o.Size || sha != o.SHA256 {
		return protocol.Failure("DIGEST_MISMATCH", "", "final stored object integrity invalid")
	}
	return nil
}
func (s *Server) fail(ctx context.Context, j *job, cause error) {
	code := "STORAGE_UNAVAILABLE"
	if e, ok := cause.(*protocol.Error); ok {
		code = e.Code
	}
	retryable := code == "STORAGE_UNAVAILABLE" || code == "MAINTENANCE"
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE jobs SET state=CASE WHEN $5 AND attempt_count<5 AND deadline_at>now() THEN 'pending' ELSE 'failed' END,lease_until=NULL,next_attempt_at=now()+make_interval(secs => LEAST(300,5*(1<<LEAST(attempt_count-1,6))) * (0.8+random()*0.4)),last_error=$4 WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND state='running'`, j.ID, j.Owner, j.Fence, code, retryable)
	if err != nil || tag.RowsAffected() != 1 {
		return
	}
	if _, err = tx.Exec(ctx, "UPDATE report_revisions SET phase='failed',resume_phase='verifying',failure_code=$3,retryable=$4 WHERE project_id=$1 AND id=$2 AND phase IN('verifying','failed')", j.Project, j.Revision, code, retryable || code == "AUTH_REQUIRED" || code == "AUTH_EXPIRED"); err != nil {
		return
	}
	tx.Commit(ctx)
}
