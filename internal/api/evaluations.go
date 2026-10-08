package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/reviews"
	"github.com/jackc/pgx/v5"
)

func (s *Server) selectResult(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		PlanItemID string         `json:"planItemId"`
		ResultRef  map[string]any `json:"resultRef"`
		Reason     string         `json:"reason"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if strings.TrimSpace(v.Reason) == "" {
		return protocol.Failure("INVALID_ARGUMENT", "/reason", "selection reason required")
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, r.PathValue("projectId")); err != nil || hit {
		return err
	}
	project, campaign := r.PathValue("projectId"), r.PathValue("campaignId")
	var basis, review int64
	var id *string
	if err = tx.QueryRow(r.Context(), "SELECT basis_version,review_version,current_snapshot_id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&basis, &review, &id); err != nil {
		return err
	}
	if err = precondition(r, reviewETag(basis, review)); err != nil {
		return err
	}
	if id == nil {
		return protocol.Failure("BASIS_PENDING", "", "snapshot pending")
	}
	var raw []byte
	if err = tx.QueryRow(r.Context(), "SELECT projection FROM acceptance_snapshots WHERE project_id=$1 AND id=$2", project, *id).Scan(&raw); err != nil {
		return err
	}
	snapshot, _ := decodeMap(raw)
	candidates := []reviews.Candidate{}
	found := false
	for _, item := range list(snapshot["items"]) {
		m := object(item)
		if text(m, "planItemId") != v.PlanItemID {
			continue
		}
		if text(m, "selectionStatus") != "conflict" {
			return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "only conflicting current leaves may be selected")
		}
		for _, ref := range list(m["candidateRefs"]) {
			a := object(ref)
			b1, _ := protocol.Canonical(a)
			b2, _ := protocol.Canonical(v.ResultRef)
			if bytes.Equal(b1, b2) {
				found = true
			}
			candidates = append(candidates, reviews.Candidate{RunID: text(a, "runId"), RevisionID: text(a, "revisionId"), ResultID: text(a, "resultId")})
		}
	}
	if !found {
		return protocol.Failure("REFERENCE_INVALID", "/resultRef", "selected result is not a current conflict leaf")
	}
	selectionID := protocol.NewID()
	if _, err = tx.Exec(r.Context(), "INSERT INTO campaign_selections(project_id,id,campaign_id,plan_item_id,result_ref,candidate_digest,reason,actor_owner_id,basis_version) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)", project, selectionID, campaign, v.PlanItemID, rawJSON(v.ResultRef), reviews.CandidateDigest(candidates), v.Reason, basis+1); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "UPDATE campaigns SET basis_version=basis_version+1,current_snapshot_id=NULL WHERE project_id=$1 AND id=$2", project, campaign); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 201, map[string]any{"id": selectionID}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, map[string]any{"id": selectionID})
	return nil
}
func (s *Server) adoptEvaluations(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		EvaluationIDs []string `json:"evaluationIds"`
		Reason        string   `json:"reason"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if len(v.EvaluationIDs) == 0 || strings.TrimSpace(v.Reason) == "" {
		return protocol.Failure("INVALID_ARGUMENT", "", "evaluations and reason required")
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, r.PathValue("projectId")); err != nil || hit {
		return err
	}
	project, campaign := r.PathValue("projectId"), r.PathValue("campaignId")
	var basis, review int64
	if err = tx.QueryRow(r.Context(), "SELECT basis_version,review_version FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&basis, &review); err != nil {
		return err
	}
	if err = precondition(r, reviewETag(basis, review)); err != nil {
		return err
	}
	for _, id := range v.EvaluationIDs {
		var compatible bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM evaluations e JOIN report_revisions rev ON rev.project_id=e.project_id AND rev.id=e.revision_id JOIN runs run ON run.project_id=rev.project_id AND run.id=rev.run_id JOIN campaigns c ON c.project_id=run.project_id AND c.id=run.campaign_id WHERE e.project_id=$1 AND e.id=$2 AND run.campaign_id=$3 AND run.target_id=c.current_target_id AND rev.phase='sealed' AND e.ruleset_version=$4)`, project, id, campaign, protocol.RulesetVersion).Scan(&compatible); err != nil {
			return err
		}
		if !compatible {
			return protocol.Failure("REFERENCE_INVALID", "/evaluationIds", "evaluation is not compatible with current campaign target")
		}
		if _, err = tx.Exec(r.Context(), "INSERT INTO evaluation_adoptions(project_id,id,campaign_id,evaluation_id,reason,basis_version) VALUES($1,$2,$3,$4,$5,$6)", project, protocol.NewID(), campaign, id, v.Reason, basis+1); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(r.Context(), "UPDATE campaigns SET basis_version=basis_version+1,current_snapshot_id=NULL WHERE project_id=$1 AND id=$2", project, campaign); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 201, map[string]any{"basisVersion": strconv.FormatInt(basis+1, 10)}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, map[string]any{"basisVersion": strconv.FormatInt(basis+1, 10)})
	return nil
}
func (s *Server) reevaluate(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		RulesetVersion string `json:"rulesetVersion"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if v.RulesetVersion != protocol.RulesetVersion {
		return protocol.Failure("UNSUPPORTED_VERSION", "/rulesetVersion", "unsupported ruleset")
	}
	project, rev := r.PathValue("projectId"), r.PathValue("revisionId")
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, project); err != nil || hit {
		return err
	}
	var generation int64
	if err = tx.QueryRow(r.Context(), "SELECT generation FROM report_revisions WHERE project_id=$1 AND id=$2 AND run_id=$3 AND phase='sealed' FOR SHARE", project, rev, r.PathValue("runId")).Scan(&generation); err != nil {
		return err
	}
	id := protocol.NewID()
	if _, err = tx.Exec(r.Context(), `INSERT INTO jobs(id,project_id,revision_id,generation,kind,requested_evaluation_id,auth_id,auth_owner,auth_epoch,ruleset_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, protocol.NewID(), project, rev, generation, "evaluation/"+id, id, p.ID, p.Owner, p.Epoch, v.RulesetVersion); err != nil {
		return err
	}
	response := map[string]any{"id": id, "phase": "verifying", "statusUrl": "/api/v1/projects/" + project + "/runs/" + r.PathValue("runId") + "/revisions/" + rev + "/evaluations/" + id}
	if err = rememberResponse(r, tx, project, 202, response); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 202, response)
	return nil
}
func (s *Server) getEvaluation(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var raw json.RawMessage
	err := s.Store.Pool.QueryRow(r.Context(), `SELECT e.projection FROM evaluations e JOIN report_revisions rev ON rev.project_id=e.project_id AND rev.id=e.revision_id WHERE e.project_id=$1 AND e.id=$2 AND e.revision_id=$3 AND rev.run_id=$4`, r.PathValue("projectId"), r.PathValue("evaluationId"), r.PathValue("revisionId"), r.PathValue("runId")).Scan(&raw)
	if err == pgx.ErrNoRows {
		var state string
		var code *string
		err = s.Store.Pool.QueryRow(r.Context(), `SELECT j.state,j.last_error FROM jobs j JOIN report_revisions rev ON rev.project_id=j.project_id AND rev.id=j.revision_id WHERE j.project_id=$1 AND j.requested_evaluation_id=$2 AND j.revision_id=$3 AND rev.run_id=$4`, r.PathValue("projectId"), r.PathValue("evaluationId"), r.PathValue("revisionId"), r.PathValue("runId")).Scan(&state, &code)
		if err != nil {
			return err
		}
		phase := "verifying"
		status := 202
		if state == "failed" {
			phase = "failed"
			status = 200
		}
		reply(w, status, map[string]any{"id": r.PathValue("evaluationId"), "phase": phase, "failureCode": code})
		return nil
	}
	if err != nil {
		return err
	}
	reply(w, 200, raw)
	return nil
}
