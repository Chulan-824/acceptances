package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/Chulan-824/acceptances/internal/storage"
	"github.com/jackc/pgx/v5"
)

func (s *Server) registerPublication(mux *http.ServeMux) {
	base := "/api/v1/projects/{projectId}/runs/{runId}"
	revision := base + "/revisions/{revisionId}"
	s.route(mux, "POST /api/v1/projects/{projectId}/runs", "runs:write", s.createRun)
	s.route(mux, "GET "+base, "results:read", s.getRun)
	s.route(mux, "POST "+base+"/revisions", "runs:write", s.createRevision)
	s.route(mux, "PATCH "+revision, "runs:write", s.createRevision)
	s.route(mux, "GET "+revision, "results:read", s.getRevision)
	s.route(mux, "PUT "+revision+"/assets/{assetId}/content", "evidence:write", s.uploadAsset)
	s.route(mux, "POST "+revision+"/finalize", "runs:write", s.finalize)
	s.route(mux, "POST "+revision+"/resume", "runs:write", s.resume)
	s.route(mux, "GET /api/v1/projects/{projectId}/revisions/{revisionId}/assets/{assetId}/content", "evidence:read", s.assetContent)
	s.route(mux, "HEAD /api/v1/projects/{projectId}/revisions/{revisionId}/assets/{assetId}/content", "evidence:read", s.assetContent)
}
func (s *Server) createRun(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		ID         string         `json:"id"`
		CampaignID string         `json:"campaignId"`
		PlanID     string         `json:"planId"`
		TargetID   string         `json:"targetId"`
		Producer   map[string]any `json:"producer"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	for _, id := range []string{v.ID, v.CampaignID, v.PlanID, v.TargetID} {
		if err := validID(id); err != nil {
			return err
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
	project := r.PathValue("projectId")
	var ignored string
	if err = tx.QueryRow(r.Context(), "SELECT id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, v.CampaignID).Scan(&ignored); err != nil {
		return err
	}
	tag, err := tx.Exec(r.Context(), `INSERT INTO runs(project_id,id,campaign_id,plan_id,target_id,producer) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,id) DO NOTHING`, project, v.ID, v.CampaignID, v.PlanID, v.TargetID, rawJSON(v.Producer))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var campaign, plan, target string
		var producer []byte
		if err = tx.QueryRow(r.Context(), "SELECT campaign_id::text,plan_id::text,target_id::text,producer FROM runs WHERE project_id=$1 AND id=$2", project, v.ID).Scan(&campaign, &plan, &target, &producer); err != nil {
			return err
		}
		var existing any
		json.Unmarshal(producer, &existing)
		a, _ := protocol.Canonical(existing)
		b, _ := protocol.Canonical(v.Producer)
		if campaign != v.CampaignID || plan != v.PlanID || target != v.TargetID || !bytes.Equal(a, b) {
			return protocol.Failure("ID_CONTENT_CONFLICT", "", "Run ID has different execution identity")
		}
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 201, v); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, v)
	return nil
}
func (s *Server) createRevision(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var input protocol.RevisionInput
	if err := decodeRevision(w, r, &input); err != nil {
		return err
	}
	if err := validID(input.ID); err != nil {
		return err
	}
	if id := r.PathValue("revisionId"); id != "" && id != input.ID {
		return protocol.Failure("REFERENCE_INVALID", "/id", "revision path mismatch")
	}
	raw, err := base64.StdEncoding.DecodeString(input.ReportBase64)
	if err != nil {
		return protocol.Failure("INVALID_JSON", "/reportBase64", "invalid base64")
	}
	manifestRaw, err := base64.StdEncoding.DecodeString(input.ManifestBase64)
	if err != nil {
		return protocol.Failure("INVALID_JSON", "/manifestBase64", "invalid base64")
	}
	doc, err := protocol.ParseDocument("report", raw)
	if err != nil {
		return err
	}
	manifest, err := protocol.ParseManifest(manifestRaw)
	if err != nil {
		return err
	}
	project, run := r.PathValue("projectId"), r.PathValue("runId")
	if doc.ID != input.ID || doc.ProjectID != project || text(doc.Value, "runId") != run || manifest.ID != input.ID || manifest.RunID != run || manifest.ProjectID != project {
		return protocol.Failure("REFERENCE_INVALID", "", "report/manifest identity mismatch")
	}
	if manifest.Report.SHA256 != doc.SHA256 || manifest.Report.Size != int64(len(raw)) {
		return protocol.Failure("DIGEST_MISMATCH", "/report", "report raw digest mismatch")
	}
	assets := map[string]bool{}
	for _, a := range manifest.Assets {
		assets[a.ID] = true
	}
	bundle := &protocol.Bundle{Report: doc, Manifest: manifest, Documents: map[string]protocol.Document{}}
	if err = protocol.ValidateBundleReferences(bundle, assets); err != nil {
		return err
	}
	if err = s.Storage.Register(r.Context()); err != nil {
		return err
	}
	reportObject, err := s.Storage.Put(r.Context(), project, bytes.NewReader(raw), int64(len(raw)), doc.SHA256)
	if err != nil {
		return err
	}
	manifestObject, err := s.Storage.Put(r.Context(), project, bytes.NewReader(manifestRaw), int64(len(manifestRaw)), protocol.Digest(manifestRaw))
	if err != nil {
		return err
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	cached, cachedStatus, err := idempotency(r, tx, project)
	if err != nil {
		return err
	}
	if cached != nil {
		return s.revisionReply(w, r, input.ID, cachedStatus)
	}
	if r.Method == "POST" {
		var hash, mhash string
		err = tx.QueryRow(r.Context(), "SELECT report_sha256,manifest_sha256 FROM report_revisions WHERE project_id=$1 AND run_id=$2 AND id=$3", project, run, input.ID).Scan(&hash, &mhash)
		if err == nil {
			if hash != doc.SHA256 || mhash != protocol.Digest(manifestRaw) {
				return protocol.Failure("ID_CONTENT_CONFLICT", "", "revision ID has different raw bytes")
			}
			if err = rememberResponse(r, tx, project, 200, map[string]any{"id": input.ID}); err != nil {
				return err
			}
			if err = tx.Commit(r.Context()); err != nil {
				return err
			}
			return s.revisionReply(w, r, input.ID)
		}
		if err != pgx.ErrNoRows {
			return err
		}
	}

	var campaign, plan, target string
	if err = tx.QueryRow(r.Context(), "SELECT campaign_id::text,plan_id::text,target_id::text FROM runs WHERE project_id=$1 AND id=$2", project, run).Scan(&campaign, &plan, &target); err != nil {
		return err
	}
	if campaign != text(doc.Value, "campaignId") || plan != text(object(doc.Value["planRef"]), "id") || target != text(object(doc.Value["targetRef"]), "id") {
		return protocol.Failure("REFERENCE_INVALID", "", "report identity differs from Run")
	}
	var ignored string
	if err = tx.QueryRow(r.Context(), "SELECT id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&ignored); err != nil {
		return err
	}
	for _, ref := range []map[string]any{object(doc.Value["planRef"]), object(doc.Value["targetRef"])} {
		var sha string
		if err = tx.QueryRow(r.Context(), "SELECT sha256 FROM immutable_documents WHERE project_id=$1 AND document_id=$2", project, text(ref, "id")).Scan(&sha); err != nil {
			return err
		}
		if sha != text(ref, "sha256") {
			return protocol.Failure("REFERENCE_INVALID", "", "report document digest mismatch")
		}
	}
	for _, ref := range manifest.Documents {
		var sha, kind string
		if err = tx.QueryRow(r.Context(), "SELECT sha256,kind FROM immutable_documents WHERE project_id=$1 AND document_id=$2", project, ref.ID).Scan(&sha, &kind); err != nil {
			return err
		}
		if sha != ref.SHA256 || kind != ref.Kind {
			return protocol.Failure("REFERENCE_INVALID", "", "manifest document reference mismatch")
		}
	}
	if err = s.validateResults(r, tx, doc, plan); err != nil {
		return err
	}
	generation := int64(1)
	if r.Method == "PATCH" {
		var phase string
		var version int64
		if err = tx.QueryRow(r.Context(), "SELECT phase,generation,draft_version FROM report_revisions WHERE project_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE", project, run, input.ID).Scan(&phase, &generation, &version); err != nil {
			return err
		}
		if phase == "sealed" || phase == "verifying" || phase == "expired" {
			return protocol.Failure("REVISION_FROZEN", "", "revision frozen")
		}
		if err = precondition(r, revisionETag(version)); err != nil {
			return err
		}
		var uploadsActive bool
		if err = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM revision_assets WHERE project_id=$1 AND revision_id=$2 AND upload_deadline>now())", project, input.ID).Scan(&uploadsActive); err != nil {
			return err
		}
		if uploadsActive {
			return protocol.Failure("ID_CONTENT_CONFLICT", "", "draft has an active upload")
		}
		generation++
		if _, err = tx.Exec(r.Context(), "DELETE FROM revision_assets WHERE project_id=$1 AND revision_id=$2", project, input.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(r.Context(), `UPDATE report_revisions SET report_asset_id=$4,manifest_asset_id=$5,report_sha256=$6,manifest_sha256=$7,report=$8,manifest=$9,generation=$10,replaces_revision_id=$11,reason=$12,draft_version=draft_version+1,phase='draft',updated_at=now() WHERE project_id=$1 AND run_id=$2 AND id=$3`, project, run, input.ID, reportObject.ID, manifestObject.ID, doc.SHA256, manifestObject.SHA256, rawJSON(doc.Value), rawJSON(manifest), generation, doc.Value["replacesRevisionId"], text(doc.Value, "correctionReason")); err != nil {
			return err
		}
	} else {
		if _, err = tx.Exec(r.Context(), `INSERT INTO report_revisions(project_id,run_id,id,replaces_revision_id,reason,phase,auth_id,auth_owner,auth_epoch,location_id,report_asset_id,manifest_asset_id,report_sha256,manifest_sha256,report,manifest) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, project, run, input.ID, doc.Value["replacesRevisionId"], text(doc.Value, "correctionReason"), p.ID, p.Owner, p.Epoch, s.Storage.LocationID, reportObject.ID, manifestObject.ID, doc.SHA256, manifestObject.SHA256, rawJSON(doc.Value), rawJSON(manifest)); err != nil {
			return err
		}
	}
	if err = s.Storage.Select(r.Context(), tx, reportObject); err != nil {
		return err
	}
	if err = s.Storage.Select(r.Context(), tx, manifestObject); err != nil {
		return err
	}
	for _, a := range manifest.Assets {
		if _, err = tx.Exec(r.Context(), `INSERT INTO revision_assets(project_id,revision_id,asset_id,relative_path,size,sha256,media_type,kind,upload_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, project, input.ID, a.ID, a.Path, a.Size, a.SHA256, a.MediaType, a.Kind, generation); err != nil {
			return err
		}
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	if err = rememberResponse(r, tx, project, status, map[string]any{"id": input.ID}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	return s.revisionReply(w, r, input.ID, status)
}
func decodeRevision(w http.ResponseWriter, r *http.Request, input *protocol.RevisionInput) error {
	if r.Header.Get("Content-Type") != "application/json" {
		return protocol.Failure("INVALID_ARGUMENT", "", "application/json required")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		return protocol.Failure("LIMIT_EXCEEDED", "", "revision envelope too large")
	}
	if _, err = protocol.Decode(raw); err != nil {
		return err
	}
	rememberBody(r, raw)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(input) != nil {
		return protocol.Failure("SCHEMA_INVALID", "", "revision envelope invalid")
	}
	return nil
}
func revisionETag(version int64) string { return `"draft-` + strconv.FormatInt(version, 10) + `"` }
func (s *Server) validateResults(r *http.Request, tx pgx.Tx, doc protocol.Document, plan string) error {
	for _, v := range list(doc.Value["results"]) {
		result := object(v)
		var cid, cv, eid, ev string
		if err := tx.QueryRow(r.Context(), "SELECT case_id::text,case_version_id::text,execution_id::text,execution_version_id::text FROM plan_items WHERE project_id=$1 AND plan_id=$2 AND item_id=$3", doc.ProjectID, plan, text(result, "planItemId")).Scan(&cid, &cv, &eid, &ev); err != nil {
			return err
		}
		c, e := object(result["caseRef"]), object(result["executionRef"])
		if cid != text(c, "id") || cv != text(c, "versionId") || eid != text(e, "id") || ev != text(e, "versionId") {
			return protocol.Failure("REFERENCE_INVALID", "/results", "result differs from declared plan")
		}
		var checkRaw []byte
		if err := tx.QueryRow(r.Context(), "SELECT check_items FROM case_versions WHERE project_id=$1 AND case_id=$2 AND version_id=$3", doc.ProjectID, cid, cv).Scan(&checkRaw); err != nil {
			return err
		}
		var checkItems []any
		if err := json.Unmarshal(checkRaw, &checkItems); err != nil {
			return err
		}
		checkIDs := map[string]bool{}
		for _, v := range checkItems {
			checkIDs[text(object(v), "id")] = true
		}
		for _, v := range list(result["attempts"]) {
			for _, v := range list(object(v)["observations"]) {
				if !checkIDs[text(object(v), "checkItemId")] {
					return protocol.Failure("REFERENCE_INVALID", "/results/attempts/observations", "observation check item is not in the case version")
				}
			}
		}
		for _, v := range list(result["supersedes"]) {
			ref := object(v)
			var campaign, phase string
			if err := tx.QueryRow(r.Context(), `SELECT run.campaign_id::text,rev.phase FROM case_results cr JOIN runs run ON run.project_id=cr.project_id AND run.id=cr.run_id JOIN report_revisions rev ON rev.project_id=cr.project_id AND rev.id=cr.revision_id WHERE cr.project_id=$1 AND cr.run_id=$2 AND cr.revision_id=$3 AND cr.result_id=$4`, doc.ProjectID, text(ref, "runId"), text(ref, "revisionId"), text(ref, "resultId")).Scan(&campaign, &phase); err != nil {
				return err
			}
			if campaign != text(doc.Value, "campaignId") || phase != "sealed" || text(ref, "runId") == text(doc.Value, "runId") {
				return protocol.Failure("REFERENCE_INVALID", "/supersedes", "predecessor must be another sealed Run in this campaign")
			}
			var cycle bool
			if err := tx.QueryRow(r.Context(), `WITH RECURSIVE predecessors(run_id) AS (SELECT $2::uuid UNION SELECT p.previous_run_id FROM result_predecessors p JOIN case_results cr ON cr.project_id=p.project_id AND cr.revision_id=p.revision_id AND cr.result_id=p.result_id JOIN predecessors previous ON previous.run_id=cr.run_id WHERE p.project_id=$1) SELECT EXISTS(SELECT 1 FROM predecessors WHERE run_id=$3::uuid)`, doc.ProjectID, text(ref, "runId"), text(doc.Value, "runId")).Scan(&cycle); err != nil {
				return err
			}
			if cycle {
				return protocol.Failure("REFERENCE_INVALID", "/supersedes", "execution predecessor cycle is not permitted")
			}

		}
	}
	if previous := doc.Value["replacesRevisionId"]; previous != nil {
		var raw []byte
		var phase string
		if err := tx.QueryRow(r.Context(), "SELECT report,phase FROM report_revisions WHERE project_id=$1 AND run_id=$2 AND id=$3", doc.ProjectID, text(doc.Value, "runId"), previous).Scan(&raw, &phase); err != nil {
			return err
		}
		if phase != "sealed" {
			return protocol.Failure("REFERENCE_INVALID", "/replacesRevisionId", "correction must reference sealed report")
		}
		var old map[string]any
		json.Unmarshal(raw, &old)
		attempts := map[string]bool{}
		for _, v := range list(old["results"]) {
			for _, a := range list(object(v)["attempts"]) {
				attempts[text(object(a), "id")] = true
			}
		}
		for _, v := range list(doc.Value["results"]) {
			for _, a := range list(object(v)["attempts"]) {
				if !attempts[text(object(a), "id")] {
					return protocol.Failure("REFERENCE_INVALID", "/attempts", "new execution requires a new Run")
				}
			}
		}
	}
	return nil
}
func (s *Server) getRevision(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	return s.revisionReply(w, r, r.PathValue("revisionId"))
}
func (s *Server) revisionReply(w http.ResponseWriter, r *http.Request, id string, statuses ...int) error {
	var raw json.RawMessage
	var version int64
	err := s.Store.Pool.QueryRow(r.Context(), `SELECT jsonb_build_object('id',id,'runId',run_id,'phase',phase,'generation',generation::text,'sealDigest',seal_digest,'failureCode',failure_code,'retryable',retryable,'report',CASE WHEN phase='sealed' THEN report ELSE NULL END,'missingAssets',COALESCE((SELECT jsonb_agg(asset_id) FROM revision_assets a WHERE a.project_id=rev.project_id AND a.revision_id=rev.id AND verification_state<>'verified'),'[]'::jsonb)),draft_version FROM report_revisions rev WHERE project_id=$1 AND run_id=$2 AND id=$3`, r.PathValue("projectId"), r.PathValue("runId"), id).Scan(&raw, &version)
	if err != nil {
		return err
	}
	w.Header().Set("ETag", revisionETag(version))
	status := 200
	if len(statuses) > 0 {
		status = statuses[0]
	}
	reply(w, status, raw)
	return nil
}
func (s *Server) getRun(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var raw json.RawMessage
	err := s.Store.Pool.QueryRow(r.Context(), `SELECT jsonb_build_object('id',id,'campaignId',campaign_id,'planId',plan_id,'targetId',target_id,'revisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'phase',phase,'replacesRevisionId',replaces_revision_id)) FROM report_revisions rev WHERE rev.project_id=run.project_id AND rev.run_id=run.id),'[]'::jsonb)) FROM runs run WHERE project_id=$1 AND id=$2`, r.PathValue("projectId"), r.PathValue("runId")).Scan(&raw)
	if err != nil {
		return err
	}
	reply(w, 200, raw)
	return nil
}
func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request, p identity.Principal) (resultErr error) {
	controller := http.NewResponseController(w)
	end := time.Now().Add(30 * time.Minute)
	r.Body = &uploadBody{ReadCloser: r.Body, controller: controller, end: end}
	controller.SetReadDeadline(time.Now().Add(120 * time.Second))
	defer controller.SetReadDeadline(time.Time{})
	generation, err := strconv.ParseInt(r.Header.Get("X-Upload-Generation"), 10, 64)
	if err != nil || generation < 1 {
		return protocol.Failure("INVALID_ARGUMENT", "", "upload generation required")
	}
	project, rev, asset := r.PathValue("projectId"), r.PathValue("revisionId"), r.PathValue("assetId")
	upload := protocol.NewID()
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	var phase string
	var actual int64
	if err = tx.QueryRow(r.Context(), "SELECT phase,generation FROM report_revisions WHERE project_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE", project, r.PathValue("runId"), rev).Scan(&phase, &actual); err != nil {
		return err
	}
	if (phase != "draft" && phase != "uploading") || actual != generation {
		return protocol.Failure("REVISION_FROZEN", "", "revision phase or generation changed")
	}
	var size int64
	var sha, state string
	var active bool
	if err = tx.QueryRow(r.Context(), "SELECT size,sha256,verification_state,COALESCE(upload_deadline>now(),false) FROM revision_assets WHERE project_id=$1 AND revision_id=$2 AND asset_id=$3 FOR UPDATE", project, rev, asset).Scan(&size, &sha, &state, &active); err != nil {
		return err
	}
	if active {
		return protocol.Failure("ID_CONTENT_CONFLICT", "", "asset upload already active")
	}
	if state == "verified" {
		reply(w, 200, map[string]any{"verified": true})
		return nil
	}
	if _, err = tx.Exec(r.Context(), "UPDATE revision_assets SET upload_owner=$4,upload_deadline=now()+interval '30 minutes' WHERE project_id=$1 AND revision_id=$2 AND asset_id=$3", project, rev, asset, upload); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "UPDATE report_revisions SET phase='uploading',updated_at=now() WHERE project_id=$1 AND id=$2", project, rev); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		if resultErr != nil {
			code := "STORAGE_UNAVAILABLE"
			var failure *protocol.Error
			if errors.As(resultErr, &failure) {
				code = failure.Code
			}
			s.Store.Pool.Exec(cleanup, `UPDATE report_revisions r SET phase='failed',resume_phase='uploading',failure_code=$4,retryable=true WHERE project_id=$1 AND id=$2 AND generation=$3 AND phase='uploading' AND EXISTS(SELECT 1 FROM revision_assets a WHERE a.project_id=r.project_id AND a.revision_id=r.id AND a.asset_id=$5 AND a.upload_owner=$6)`, project, rev, generation, code, asset, upload)
		}
		s.Store.Pool.Exec(cleanup, "UPDATE revision_assets SET upload_owner=NULL,upload_deadline=NULL WHERE project_id=$1 AND revision_id=$2 AND asset_id=$3 AND upload_owner=$4", project, rev, asset, upload)
	}()
	candidate, err := s.Storage.Put(r.Context(), project, r.Body, size, sha, storage.Owner{RevisionID: rev, Generation: generation, Kind: "asset", ID: asset, LeaseID: upload})
	if err != nil {
		return err
	}
	tx, err = s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if err = tx.QueryRow(r.Context(), "SELECT phase,generation FROM report_revisions WHERE project_id=$1 AND id=$2 FOR UPDATE", project, rev).Scan(&phase, &actual); err != nil {
		return err
	}
	if generation != actual || (phase != "draft" && phase != "uploading") {
		return protocol.Failure("REVISION_FROZEN", "", "revision changed during upload")
	}
	if err = s.Storage.Select(r.Context(), tx, candidate); err != nil {
		return err
	}
	tag, err := tx.Exec(r.Context(), "UPDATE revision_assets SET selected_object_id=$4,verification_state='verified',upload_owner=NULL,upload_deadline=NULL WHERE project_id=$1 AND revision_id=$2 AND asset_id=$3 AND upload_owner=$5 AND upload_generation=$6", project, rev, asset, candidate.ID, upload, generation)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return protocol.Failure("REVISION_FROZEN", "", "upload lease lost")
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 200, map[string]any{"verified": true})
	return nil
}
func (s *Server) finalize(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		Generation string `json:"generation"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	generation, err := strconv.ParseInt(v.Generation, 10, 64)
	if err != nil {
		return protocol.Failure("INVALID_ARGUMENT", "/generation", "generation must be decimal string")
	}
	return s.enqueue(w, r, p, generation, false)
}
func (s *Server) resume(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var body struct{}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	return s.enqueue(w, r, p, 0, true)
}
func (s *Server) enqueue(w http.ResponseWriter, r *http.Request, p identity.Principal, generation int64, resume bool) error {
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	project, rev := r.PathValue("projectId"), r.PathValue("revisionId")
	if hit, err := replay(w, r, tx, project); err != nil || hit {
		return err
	}
	var phase string
	var actual, version int64
	if err = tx.QueryRow(r.Context(), "SELECT phase,generation,draft_version FROM report_revisions WHERE project_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE", project, r.PathValue("runId"), rev).Scan(&phase, &actual, &version); err != nil {
		return err
	}
	if phase == "sealed" {
		return s.revisionReply(w, r, rev)
	}
	if phase == "expired" {
		return protocol.Failure("REVISION_FROZEN", "", "expired revision requires a new revision ID")
	}
	if resume {
		if err = precondition(r, revisionETag(version)); err != nil {
			return err
		}
		generation = actual
	}
	if actual != generation {
		return protocol.Failure("REVIEW_BASIS_CONFLICT", "", "generation mismatch")
	}
	if phase == "verifying" && !resume {
		reply(w, 202, map[string]any{"phase": phase, "statusUrl": r.URL.Path[:len(r.URL.Path)-len("/finalize")]})
		return nil
	}
	var missing int
	if err = tx.QueryRow(r.Context(), "SELECT count(*) FROM revision_assets WHERE project_id=$1 AND revision_id=$2 AND verification_state<>'verified'", project, rev).Scan(&missing); err != nil {
		return err
	}
	if missing > 0 {
		if resume {
			if _, err = tx.Exec(r.Context(), "UPDATE report_revisions SET phase='uploading',auth_id=$3,auth_owner=$4,auth_epoch=$5 WHERE project_id=$1 AND id=$2", project, rev, p.ID, p.Owner, p.Epoch); err != nil {
				return err
			}
			if err = rememberResponse(r, tx, project, 200, map[string]any{"phase": "uploading", "generation": strconv.FormatInt(actual, 10)}); err != nil {
				return err
			}
			if err = tx.Commit(r.Context()); err != nil {
				return err
			}
			return s.revisionReply(w, r, rev)
		}
		return protocol.Failure("ASSET_INCOMPLETE", "", "declared assets missing")
	}
	if _, err = tx.Exec(r.Context(), "UPDATE report_revisions SET phase='verifying',auth_id=$3,auth_owner=$4,auth_epoch=$5,failure_code=NULL,retryable=false,updated_at=now() WHERE project_id=$1 AND id=$2", project, rev, p.ID, p.Owner, p.Epoch); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO jobs(id,project_id,revision_id,generation) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,revision_id,generation,kind) DO UPDATE SET state='pending',attempt_count=0,next_attempt_at=now(),deadline_at=now()+interval '30 minutes' WHERE jobs.state<>'running' OR jobs.lease_until<now()`, protocol.NewID(), project, rev, generation); err != nil {
		return err
	}
	response := map[string]any{"phase": "verifying", "statusUrl": "/api/v1/projects/" + project + "/runs/" + r.PathValue("runId") + "/revisions/" + rev}
	if err = rememberResponse(r, tx, project, 202, response); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 202, response)
	return nil
}
func (s *Server) assetContent(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var objectID, kind string
	if err := s.Store.Pool.QueryRow(r.Context(), `SELECT a.selected_object_id::text,a.kind FROM revision_assets a JOIN report_revisions rev ON rev.project_id=a.project_id AND rev.id=a.revision_id WHERE a.project_id=$1 AND a.revision_id=$2 AND a.asset_id=$3 AND rev.phase='sealed'`, r.PathValue("projectId"), r.PathValue("revisionId"), r.PathValue("assetId")).Scan(&objectID, &kind); err != nil {
		return err
	}
	file, o, err := s.Storage.Read(r.Context(), r.PathValue("projectId"), objectID)
	if err != nil {
		s.invalidateIntegrity(r.Context(), r.PathValue("projectId"), r.PathValue("revisionId"))
		return err
	}
	defer file.Close()
	n, sha, err := protocol.HashFile(file, o.Size)
	if err != nil || n != o.Size || sha != o.SHA256 {
		s.invalidateIntegrity(r.Context(), r.PathValue("projectId"), r.PathValue("revisionId"))
		return protocol.Failure("DIGEST_MISMATCH", "", "registered asset integrity invalid")
	}
	file.Seek(0, 0)
	head := make([]byte, 512)
	count, _ := file.Read(head)
	mime := http.DetectContentType(head[:count])
	file.Seek(0, 0)
	disposition := "attachment"
	if safeInline(mime, kind) {
		disposition = "inline"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", disposition+`; filename="evidence"`)
	w.Header().Set("Cache-Control", "private, no-store")
	if value := r.Header.Get("Range"); bytes.Count([]byte(value), []byte{','}) > 0 {
		w.Header().Set("Content-Range", "bytes */"+strconv.FormatInt(o.Size, 10))
		w.WriteHeader(416)
		return nil
	}
	http.ServeContent(w, r, "evidence", time.Time{}, file)
	return nil
}
func safeInline(mime, kind string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return kind == "image"
	case "audio/mpeg", "audio/wave", "audio/ogg":
		return kind == "audio"
	case "video/mp4", "video/webm":
		return kind == "video"
	case "text/plain; charset=utf-8", "application/json":
		return kind == "text" || kind == "json"
	}
	return false
}

type uploadBody struct {
	io.ReadCloser
	controller *http.ResponseController
	end        time.Time
}

func (b *uploadBody) Read(p []byte) (int, error) {
	deadline := time.Now().Add(120 * time.Second)
	if deadline.After(b.end) {
		deadline = b.end
	}
	b.controller.SetReadDeadline(deadline)
	return b.ReadCloser.Read(p)
}
