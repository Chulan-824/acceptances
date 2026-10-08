package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/reviews"
	"github.com/jackc/pgx/v5"
)

func (s *Server) registerReviews(mux *http.ServeMux) {
	base := "/api/v1/projects/{projectId}/campaigns/{campaignId}"
	s.route(mux, "GET "+base+"/snapshot", "results:read", s.getSnapshot)
	s.route(mux, "GET "+base+"/snapshots/{snapshotId}", "results:read", s.getSnapshot)
	s.route(mux, "GET "+base+"/reviews", "feedback:read", s.getReviews)
	s.route(mux, "POST "+base+"/reviews", "OWNER", s.createReview)
	s.route(mux, "GET "+base+"/gate", "results:read", s.gate)
	s.route(mux, "POST "+base+"/selections", "OWNER", s.selectResult)
	s.route(mux, "POST "+base+"/evaluation-adoptions", "OWNER", s.adoptEvaluations)
	revision := "/api/v1/projects/{projectId}/runs/{runId}/revisions/{revisionId}"
	s.route(mux, "POST "+revision+"/evaluations", "runs:write", s.reevaluate)
	s.route(mux, "GET "+revision+"/evaluations/{evaluationId}", "results:read", s.getEvaluation)
}
func reviewETag(basis, review int64) string {
	return `"basis-` + strconv.FormatInt(basis, 10) + `-review-` + strconv.FormatInt(review, 10) + `"`
}
func (s *Server) refreshPending(ctx context.Context) {
	rows, err := s.Store.Pool.Query(ctx, "SELECT project_id::text,id::text FROM campaigns WHERE current_snapshot_id IS NULL AND current_plan_id IS NOT NULL AND current_target_id IS NOT NULL ORDER BY created_at LIMIT 16")
	if err != nil {
		return
	}
	type ref struct{ p, c string }
	refs := []ref{}
	for rows.Next() {
		var r ref
		if rows.Scan(&r.p, &r.c) == nil {
			refs = append(refs, r)
		}
	}
	rows.Close()
	for _, r := range refs {
		s.refreshCampaign(ctx, r.p, r.c)
	}
}
func (s *Server) coverageInputs(ctx context.Context, project, campaign string) (map[string]any, map[string]any, []reviews.Candidate, []reviews.Selection, []any, int64, error) {
	var planRaw, targetRaw []byte
	var planSHA, targetSHA string
	var basis int64
	err := s.Store.Pool.QueryRow(ctx, `SELECT pd.projection,pd.sha256,td.projection,td.sha256,c.basis_version FROM campaigns c JOIN immutable_documents pd ON pd.project_id=c.project_id AND pd.document_id=c.current_plan_id JOIN immutable_documents td ON td.project_id=c.project_id AND td.document_id=c.current_target_id WHERE c.project_id=$1 AND c.id=$2`, project, campaign).Scan(&planRaw, &planSHA, &targetRaw, &targetSHA, &basis)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	plan, err := decodeMap(planRaw)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	target, err := decodeMap(targetRaw)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	plan["documentSha256"] = planSHA
	target["documentSha256"] = targetSHA
	rows, err := s.Store.Pool.Query(ctx, `SELECT cr.run_id::text,cr.revision_id::text,cr.result_id::text,cr.plan_item_id::text,run.target_id::text,rev.replaces_revision_id::text,rev.report,cr.projection,e.id::text,e.sha256,e.projection,rev.integrity_invalid,rev.manifest FROM case_results cr JOIN report_revisions rev ON rev.project_id=cr.project_id AND rev.id=cr.revision_id JOIN runs run ON run.project_id=cr.project_id AND run.id=cr.run_id JOIN LATERAL (SELECT ev.* FROM evaluations ev WHERE ev.project_id=cr.project_id AND ev.revision_id=cr.revision_id AND (ev.initial OR EXISTS(SELECT 1 FROM evaluation_adoptions a WHERE a.project_id=ev.project_id AND a.campaign_id=$2 AND a.evaluation_id=ev.id)) ORDER BY COALESCE((SELECT max(a.basis_version) FROM evaluation_adoptions a WHERE a.project_id=ev.project_id AND a.campaign_id=$2 AND a.evaluation_id=ev.id),0) DESC,ev.initial DESC LIMIT 1) e ON true WHERE cr.project_id=$1 AND run.campaign_id=$2 AND rev.phase='sealed' AND NOT EXISTS(SELECT 1 FROM report_revisions replacement WHERE replacement.project_id=rev.project_id AND replacement.run_id=rev.run_id AND replacement.replaces_revision_id=rev.id AND replacement.phase='sealed')`, project, campaign)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	candidates := []reviews.Candidate{}
	for rows.Next() {
		var c reviews.Candidate
		var rr, result, eval, manifestRaw []byte
		if err = rows.Scan(&c.RunID, &c.RevisionID, &c.ResultID, &c.PlanItemID, &c.TargetID, &c.Replaces, &rr, &result, &c.EvaluationID, &c.EvaluationSHA, &eval, &c.IntegrityInvalid, &manifestRaw); err != nil {
			rows.Close()
			return nil, nil, nil, nil, nil, 0, err
		}
		c.Report, _ = decodeMap(rr)
		c.Result, _ = decodeMap(result)
		c.Evaluation, _ = decodeMap(eval)
		manifest, _ := decodeMap(manifestRaw)
		c.AssetKinds = map[string]string{}
		for _, v := range list(manifest["assets"]) {
			asset := object(v)
			c.AssetKinds[text(asset, "id")] = text(asset, "kind")
		}
		candidates = append(candidates, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	rows, err = s.Store.Pool.Query(ctx, "SELECT id::text,plan_item_id::text,candidate_digest,result_ref FROM campaign_selections WHERE project_id=$1 AND campaign_id=$2 ORDER BY basis_version,id", project, campaign)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	selections := []reviews.Selection{}
	for rows.Next() {
		var sel reviews.Selection
		var raw []byte
		if err = rows.Scan(&sel.ID, &sel.ItemID, &sel.Digest, &raw); err != nil {
			rows.Close()
			return nil, nil, nil, nil, nil, 0, err
		}
		sel.ResultRef, _ = decodeMap(raw)
		selections = append(selections, sel)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	adopted := []any{}
	rows, err = s.Store.Pool.Query(ctx, "SELECT e.id::text,e.sha256,e.ruleset_version FROM evaluation_adoptions a JOIN evaluations e ON e.project_id=a.project_id AND e.id=a.evaluation_id WHERE a.project_id=$1 AND a.campaign_id=$2 ORDER BY e.id", project, campaign)
	if err != nil {
		return nil, nil, nil, nil, nil, 0, err
	}
	for rows.Next() {
		var id, sha, ruleset string
		if err = rows.Scan(&id, &sha, &ruleset); err != nil {
			rows.Close()
			return nil, nil, nil, nil, nil, 0, err
		}
		adopted = append(adopted, map[string]any{"id": id, "sha256": sha, "rulesetVersion": ruleset})
	}
	err = rows.Err()
	rows.Close()
	return plan, target, candidates, selections, adopted, basis, err
}
func (s *Server) refreshCampaign(ctx context.Context, project, campaign string) error {
	plan, target, candidates, selections, adopted, basis, err := s.coverageInputs(ctx, project, campaign)
	if err != nil {
		return err
	}
	snapshot := reviews.Snapshot(project, campaign, plan, target, candidates, selections, adopted)
	raw, err := protocol.Canonical(snapshot)
	if err != nil {
		return err
	}
	if _, err = protocol.ValidateDocument("snapshot", raw); err != nil {
		return err
	}
	sha := protocol.Digest(raw)
	candidate, err := s.Storage.Put(ctx, project, bytes.NewReader(raw), int64(len(raw)), sha)
	if err != nil {
		return err
	}
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var mode string
	if err = tx.QueryRow(ctx, "SELECT mode FROM installation_control WHERE id=1 FOR SHARE").Scan(&mode); err != nil || mode != "normal" {
		return protocol.Failure("MAINTENANCE", "", "snapshot update unavailable")
	}
	var current int64
	if err = tx.QueryRow(ctx, "SELECT basis_version FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&current); err != nil {
		return err
	}
	if current != basis {
		return protocol.Failure("BASIS_PENDING", "", "campaign basis changed during snapshot computation")
	}
	id := protocol.NewID()
	var existing string
	err = tx.QueryRow(ctx, "SELECT id::text FROM acceptance_snapshots WHERE project_id=$1 AND campaign_id=$2 AND sha256=$3", project, campaign, sha).Scan(&existing)
	if err == nil {
		id = existing
	} else if err == pgx.ErrNoRows {
		if err = s.Storage.Select(ctx, tx, candidate); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO acceptance_snapshots(project_id,id,campaign_id,basis_version,sha256,raw_asset_id,plan_id,target_id,readiness,projection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", project, id, campaign, basis, sha, candidate.ID, text(plan, "id"), text(target, "id"), text(snapshot, "readiness"), raw); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO immutable_documents(project_id,document_id,kind,raw_asset_id,sha256,schema_version,projection) VALUES($1,$2,'acceptance_snapshot',$3,$4,$5,$6)", project, id, candidate.ID, sha, protocol.SchemaVersion, raw); err != nil {
			return err
		}
		for _, v := range list(snapshot["items"]) {
			item := object(v)
			if _, err = tx.Exec(ctx, "INSERT INTO snapshot_items(project_id,snapshot_id,plan_item_id,result_ref,evaluation_ref,eligibility,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7)", project, id, text(item, "planItemId"), rawJSON(item["resultRef"]), rawJSON(item["evaluationRef"]), item["eligibility"], rawJSON(item["codes"])); err != nil {
				return err
			}
		}
	} else {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE campaigns SET current_snapshot_id=$3 WHERE project_id=$1 AND id=$2 AND basis_version=$4", project, campaign, id, basis); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Server) getSnapshot(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	project, campaign := r.PathValue("projectId"), r.PathValue("campaignId")
	var current *string
	var basis, review int64
	if err := s.Store.Pool.QueryRow(r.Context(), "SELECT current_snapshot_id::text,basis_version,review_version FROM campaigns WHERE project_id=$1 AND id=$2", project, campaign).Scan(&current, &basis, &review); err != nil {
		return err
	}
	id := r.PathValue("snapshotId")
	if id == "" {
		if current == nil {
			reply(w, 202, map[string]any{"basisPending": true})
			return nil
		}
		id = *current
	}
	var raw json.RawMessage
	var sha string
	if err := s.Store.Pool.QueryRow(r.Context(), "SELECT projection,sha256 FROM acceptance_snapshots WHERE project_id=$1 AND campaign_id=$2 AND id=$3", project, campaign, id).Scan(&raw, &sha); err != nil {
		return err
	}
	if current != nil && id == *current {
		snapshot, _ := decodeMap(raw)
		if !s.snapshotIntegrity(r.Context(), project, snapshot) {
			reply(w, 202, map[string]any{"basisPending": true, "integrityInvalid": true})
			return nil
		}
	}
	w.Header().Set("ETag", reviewETag(basis, review))
	reply(w, 200, map[string]any{"id": id, "sha256": sha, "basisVersion": strconv.FormatInt(basis, 10), "reviewVersion": strconv.FormatInt(review, 10), "current": current != nil && id == *current, "snapshot": raw})
	return nil
}
func (s *Server) getReviews(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	project, campaign := r.PathValue("projectId"), r.PathValue("campaignId")
	after := int64(0)
	cursor := r.URL.Query().Get("cursor")
	if cursor != "" {
		parts := strings.Split(cursor, "/")
		if len(parts) != 3 || parts[0] != project || parts[1] != campaign {
			return protocol.Failure("INVALID_ARGUMENT", "/cursor", "feedback cursor mismatch")
		}
		var err error
		after, err = strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return protocol.Failure("INVALID_ARGUMENT", "/cursor", "invalid feedback cursor")
		}
	}
	rows, err := s.Store.Pool.Query(r.Context(), `SELECT jsonb_build_object('id',id,'snapshotId',snapshot_id,'action',action,'itemId',item_id,'reason',reason,'riskItems',risk_items,'resolvesEventIds',resolves_event_ids,'createdAt',created_at,'seq',seq::text),seq FROM review_events WHERE project_id=$1 AND campaign_id=$2 AND seq>$3 ORDER BY seq LIMIT 51`, project, campaign, after)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []json.RawMessage{}
	var last int64
	var next any
	for rows.Next() {
		var raw json.RawMessage
		var seq int64
		if err = rows.Scan(&raw, &seq); err != nil {
			return err
		}
		if len(items) == 50 {
			next = project + "/" + campaign + "/" + strconv.FormatInt(last, 10)
			break
		}
		items = append(items, raw)
		last = seq
	}
	if err = rows.Err(); err != nil {
		return err
	}
	reply(w, 200, map[string]any{"items": items, "nextCursor": next})
	return nil
}

type reviewInput struct {
	ID         string  `json:"id"`
	SnapshotID string  `json:"snapshotId"`
	Action     string  `json:"action"`
	ItemID     *string `json:"itemId,omitempty"`
	Reason     string  `json:"reason,omitempty"`
	RiskItems  []struct {
		ItemID string `json:"itemId"`
		Reason string `json:"reason"`
	} `json:"riskItems,omitempty"`
	Resolves []string `json:"resolvesEventIds,omitempty"`
}

func (s *Server) createReview(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v reviewInput
	if err := decode(w, r, &v); err != nil {
		return err
	}
	for _, id := range []string{v.ID, v.SnapshotID} {
		if err := validID(id); err != nil {
			return err
		}
	}
	actions := map[string]bool{"comment": true, "reject_item": true, "resolve_rejection": true, "accept": true, "reject": true, "accept_risk": true, "withdraw": true}
	if !actions[v.Action] {
		return protocol.Failure("INVALID_ARGUMENT", "/action", "unknown human action")
	}
	if v.Action != "comment" && v.Action != "accept" && strings.TrimSpace(v.Reason) == "" {
		return protocol.Failure("INVALID_ARGUMENT", "/reason", "human decision reason required")
	}
	if v.Action == "accept" || v.Action == "accept_risk" {
		var raw []byte
		if err := s.Store.Pool.QueryRow(r.Context(), "SELECT projection FROM acceptance_snapshots WHERE project_id=$1 AND campaign_id=$2 AND id=$3", r.PathValue("projectId"), r.PathValue("campaignId"), v.SnapshotID).Scan(&raw); err != nil {
			return err
		}
		snapshot, _ := decodeMap(raw)
		if !s.snapshotIntegrity(r.Context(), r.PathValue("projectId"), snapshot) {
			return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "evidence integrity invalid; refresh basis before review")
		}
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
	var current *string
	var basis, review int64
	if err = tx.QueryRow(r.Context(), "SELECT current_snapshot_id::text,basis_version,review_version FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&current, &basis, &review); err != nil {
		return err
	}
	var existing []byte
	err = tx.QueryRow(r.Context(), "SELECT jsonb_build_object('snapshotId',snapshot_id,'action',action,'itemId',item_id,'reason',COALESCE(reason,''),'riskItems',risk_items,'resolvesEventIds',resolves_event_ids) FROM review_events WHERE project_id=$1 AND id=$2 AND campaign_id=$3", project, v.ID, campaign).Scan(&existing)
	if err == nil {
		var old map[string]any
		json.Unmarshal(existing, &old)
		expected, _ := decodeMap(rawJSON(map[string]any{"snapshotId": v.SnapshotID, "action": v.Action, "itemId": v.ItemID, "reason": v.Reason, "riskItems": v.RiskItems, "resolvesEventIds": v.Resolves}))
		if !sameValue(old, expected) {
			return protocol.Failure("ID_CONTENT_CONFLICT", "", "review ID has another decision")
		}
		reply(w, 200, map[string]any{"id": v.ID})
		return nil
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if v.Action != "comment" {
		if err = precondition(r, reviewETag(basis, review)); err != nil {
			return err
		}
		if current == nil || *current != v.SnapshotID {
			return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "review snapshot is no longer current")
		}
	}
	var raw []byte
	if err = tx.QueryRow(r.Context(), "SELECT projection FROM acceptance_snapshots WHERE project_id=$1 AND campaign_id=$2 AND id=$3", project, campaign, v.SnapshotID).Scan(&raw); err != nil {
		return err
	}
	snapshot, _ := decodeMap(raw)
	items := map[string]map[string]any{}
	for _, item := range list(snapshot["items"]) {
		m := object(item)
		items[text(m, "planItemId")] = m
	}
	if v.Action == "reject_item" && (v.ItemID == nil || items[*v.ItemID] == nil) {
		return protocol.Failure("INVALID_ARGUMENT", "/itemId", "valid plan item required")
	}
	unresolved, err := unresolvedRejections(r.Context(), tx, project, campaign)
	if err != nil {
		return err
	}
	resolved := map[string]bool{}
	for _, id := range v.Resolves {
		if _, ok := unresolved[id]; !ok {
			return protocol.Failure("REFERENCE_INVALID", "/resolvesEventIds", "rejection already resolved or unavailable")
		}
		resolved[id] = true
	}
	if v.Action == "resolve_rejection" {
		if len(resolved) == 0 {
			return protocol.Failure("INVALID_ARGUMENT", "", "explicit rejection references required")
		}
		for id := range resolved {
			item := unresolved[id]
			if item != nil && (v.ItemID == nil || *item != *v.ItemID) {
				return protocol.Failure("REFERENCE_INVALID", "", "rejection item mismatch")
			}
		}
	}
	if v.Action == "accept" {
		if text(snapshot, "readiness") != "ready" {
			return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "required verification is not ready")
		}
		if len(unresolved) > 0 {
			return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "rejections require explicit human resolution")
		}
	}
	if v.Action == "accept_risk" {
		risks := map[string]bool{}
		for _, risk := range v.RiskItems {
			if items[risk.ItemID] == nil || strings.TrimSpace(risk.Reason) == "" {
				return protocol.Failure("INVALID_ARGUMENT", "/riskItems", "every risk needs a plan item and reason")
			}
			risks[risk.ItemID] = true
		}
		for id, item := range items {
			if item["required"] == true && item["eligibility"] != true && !risks[id] {
				return protocol.Failure("INVALID_ARGUMENT", "/riskItems", "every unmet required item needs a risk reason")
			}
		}
		for id, item := range unresolved {
			if resolved[id] {
				continue
			}
			if item == nil || !risks[*item] {
				return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "unresolved rejection lacks risk reason")
			}
		}
	}
	if v.RiskItems == nil {
		v.RiskItems = []struct {
			ItemID string `json:"itemId"`
			Reason string `json:"reason"`
		}{}
	}
	if v.Resolves == nil {
		v.Resolves = []string{}
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO review_events(project_id,id,campaign_id,snapshot_id,seq,actor_owner_id,action,item_id,reason,risk_items,resolves_event_ids) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)", project, v.ID, campaign, v.SnapshotID, review+1, v.Action, v.ItemID, v.Reason, rawJSON(v.RiskItems), v.Resolves); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "UPDATE campaigns SET review_version=review_version+1 WHERE project_id=$1 AND id=$2", project, campaign); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 201, map[string]any{"id": v.ID, "action": v.Action, "snapshotId": v.SnapshotID}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	w.Header().Set("ETag", reviewETag(basis, review+1))
	reply(w, 201, map[string]any{"id": v.ID, "action": v.Action, "snapshotId": v.SnapshotID})
	return nil
}

type rejectionReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func unresolvedRejections(ctx context.Context, tx rejectionReader, project, campaign string) (map[string]*string, error) {
	rows, err := tx.Query(ctx, `SELECT e.id::text,e.item_id::text FROM review_events e WHERE e.project_id=$1 AND e.campaign_id=$2 AND e.action IN('reject','reject_item') AND NOT EXISTS(SELECT 1 FROM review_events resolution WHERE resolution.project_id=e.project_id AND resolution.campaign_id=e.campaign_id AND resolution.action IN('resolve_rejection','accept_risk') AND e.id=ANY(resolution.resolves_event_ids))`, project, campaign)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*string{}
	for rows.Next() {
		var id string
		var item *string
		if err = rows.Scan(&id, &item); err != nil {
			return nil, err
		}
		out[id] = item
	}
	return out, rows.Err()
}
func (s *Server) gate(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	mode := r.URL.Query().Get("mode")
	allow := r.URL.Query().Get("allowRisk") == "true"
	if mode != "ready" && mode != "accepted" || mode == "ready" && allow {
		return protocol.Failure("INVALID_ARGUMENT", "/mode", "invalid gate mode or allowRisk combination")
	}
	if mode == "accepted" {
		if err := p.Require(r.PathValue("projectId"), "feedback:read"); err != nil {
			return err
		}
	}
	project, campaign := r.PathValue("projectId"), r.PathValue("campaignId")
	var id *string
	var basis, review int64
	if err := s.Store.Pool.QueryRow(r.Context(), "SELECT current_snapshot_id::text,basis_version,review_version FROM campaigns WHERE project_id=$1 AND id=$2", project, campaign).Scan(&id, &basis, &review); err != nil {
		return err
	}
	reasons := []protocol.Diagnostic{}
	satisfied := false
	if id == nil {
		reasons = append(reasons, protocol.Diagnostic{Code: "BASIS_PENDING", Message: "current snapshot is being computed"})
	} else {
		var raw []byte
		if err := s.Store.Pool.QueryRow(r.Context(), "SELECT projection FROM acceptance_snapshots WHERE project_id=$1 AND id=$2", project, *id).Scan(&raw); err != nil {
			return err
		}
		snapshot, _ := decodeMap(raw)
		integrity := s.snapshotIntegrity(r.Context(), project, snapshot)
		satisfied = integrity && text(snapshot, "readiness") == "ready"
		for _, v := range list(snapshot["items"]) {
			item := object(v)
			if item["required"] == true && item["eligibility"] != true {
				for _, v := range list(item["codes"]) {
					code, _ := v.(string)
					reasons = append(reasons, protocol.Diagnostic{Code: code, ResourceID: text(item, "planItemId"), Message: code})
				}
			}
		}
		if mode == "accepted" {
			var action string
			err := s.Store.Pool.QueryRow(r.Context(), "SELECT action FROM review_events WHERE project_id=$1 AND campaign_id=$2 AND snapshot_id=$3 AND action IN('accept','accept_risk','reject','withdraw') ORDER BY seq DESC LIMIT 1", project, campaign, *id).Scan(&action)
			if err == pgx.ErrNoRows {
				satisfied = false
				reasons = append(reasons, protocol.Diagnostic{Code: "REVIEW_REQUIRED", Message: "current snapshot has no decision"})
			} else if err != nil {
				return err
			} else {
				satisfied = integrity && ((action == "accept" && satisfied) || (action == "accept_risk" && allow))
				if !satisfied {
					reasons = append(reasons, protocol.Diagnostic{Code: "REVIEW_REQUIRED", Message: "current human decision does not satisfy gate"})
				}
			}
		}
	}
	if mode == "accepted" && satisfied {
		unresolved, err := unresolvedRejections(r.Context(), s.Store.Pool, project, campaign)
		if err != nil {
			return err
		}
		if len(unresolved) > 0 {
			satisfied = false
			reasons = append(reasons, protocol.Diagnostic{Code: "REJECTION_UNRESOLVED", Message: "human rejection requires explicit resolution"})
		}
	}
	var finalID *string
	var finalBasis, finalReview int64
	if err := s.Store.Pool.QueryRow(r.Context(), "SELECT current_snapshot_id::text,basis_version,review_version FROM campaigns WHERE project_id=$1 AND id=$2", project, campaign).Scan(&finalID, &finalBasis, &finalReview); err != nil {
		return err
	}
	if basis != finalBasis || review != finalReview || (id == nil) != (finalID == nil) || (id != nil && finalID != nil && *id != *finalID) {
		satisfied = false
		id = finalID
		basis = finalBasis
		review = finalReview
		reasons = append(reasons, protocol.Diagnostic{Code: "BASIS_PENDING", Message: "basis changed during gate query; retry against current snapshot"})
	}
	reply(w, 200, map[string]any{"satisfied": satisfied, "snapshotId": id, "basisVersion": strconv.FormatInt(basis, 10), "reviewVersion": strconv.FormatInt(review, 10), "reasons": reasons})
	return nil
}
