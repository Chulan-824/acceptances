package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Chulan-824/acceptances/internal/identity"
	"github.com/Chulan-824/acceptances/internal/protocol"
	"github.com/jackc/pgx/v5"
)

func text(m map[string]any, k string) string { v, _ := m[k].(string); return v }
func object(v any) map[string]any            { m, _ := v.(map[string]any); return m }
func list(v any) []any                       { a, _ := v.([]any); return a }
func rawJSON(v any) []byte                   { b, _ := json.Marshal(v); return b }
func (s *Server) registerDefinitions(mux *http.ServeMux) {
	s.route(mux, "PUT /api/v1/projects/{projectId}/definitions/{documentId}", "definitions:write", s.importDocument)
	s.route(mux, "POST /api/v1/projects/{projectId}/campaigns", "campaigns:write", s.createCampaign)
	s.route(mux, "GET /api/v1/projects/{projectId}/campaigns", "results:read", s.listCampaigns)
	s.route(mux, "GET /api/v1/projects/{projectId}/campaigns/{campaignId}", "results:read", s.getCampaign)
	s.route(mux, "PATCH /api/v1/projects/{projectId}/campaigns/{campaignId}/basis", "campaigns:write", s.changeBasis)
	for _, path := range []string{"plans/{planId}", "targets/{targetId}"} {
		s.route(mux, "PUT /api/v1/projects/{projectId}/campaigns/{campaignId}/"+path, "campaigns:write", s.importDocument)
		s.route(mux, "GET /api/v1/projects/{projectId}/campaigns/{campaignId}/"+path, "results:read", s.getDocument)
	}
	s.route(mux, "GET /api/v1/projects/{projectId}/documents/{documentId}/content", "evidence:read", s.documentContent)
	s.route(mux, "HEAD /api/v1/projects/{projectId}/documents/{documentId}/content", "evidence:read", s.documentContent)
}
func (s *Server) importDocument(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	project := r.PathValue("projectId")
	if err := validID(project); err != nil {
		return err
	}
	kind, id := "definitions", r.PathValue("documentId")
	if r.PathValue("planId") != "" {
		kind, id = "plan", r.PathValue("planId")
	}
	if r.PathValue("targetId") != "" {
		kind, id = "target", r.PathValue("targetId")
	}
	if err := validID(id); err != nil {
		return err
	}
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return protocol.Failure("INVALID_ARGUMENT", "", "application/json required")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, protocol.DocumentLimit))
	if err != nil {
		return protocol.Failure("LIMIT_EXCEEDED", "", "document too large")
	}
	doc, err := protocol.ParseDocument(kind, raw)
	if err != nil {
		return err
	}
	if doc.ID != id || doc.ProjectID != project {
		return protocol.Failure("REFERENCE_INVALID", "", "path/document identity mismatch")
	}
	var previous string
	err = s.Store.Pool.QueryRow(r.Context(), "SELECT sha256 FROM immutable_documents WHERE project_id=$1 AND document_id=$2", project, id).Scan(&previous)
	if err == nil {
		if previous != doc.SHA256 {
			return protocol.Failure("ID_CONTENT_CONFLICT", "", "document ID already has different raw bytes")
		}
		reply(w, 200, map[string]any{"id": id, "sha256": previous})
		return nil
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if err = s.Storage.Register(r.Context()); err != nil {
		return err
	}
	candidate, err := s.Storage.Put(r.Context(), project, bytes.NewReader(raw), int64(len(raw)), doc.SHA256)
	if err != nil {
		return err
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", project+"/document/"+id); err != nil {
		return err
	}
	err = tx.QueryRow(r.Context(), "SELECT sha256 FROM immutable_documents WHERE project_id=$1 AND document_id=$2", project, id).Scan(&previous)
	if err == nil {
		if previous != doc.SHA256 {
			return protocol.Failure("ID_CONTENT_CONFLICT", "", "document ID already has different raw bytes")
		}
		reply(w, 200, map[string]any{"id": id, "sha256": previous})
		return nil
	}
	if err != pgx.ErrNoRows {
		return err
	}
	campaign := r.PathValue("campaignId")
	if campaign != "" {
		var ignored string
		if err = tx.QueryRow(r.Context(), "SELECT id::text FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", project, campaign).Scan(&ignored); err != nil {
			return err
		}
	}
	var repo any
	if kind == "definitions" {
		repo = text(doc.Value, "repositoryId")
	}
	if err = s.Storage.Select(r.Context(), tx, candidate); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO immutable_documents(project_id,document_id,kind,raw_asset_id,sha256,schema_version,source_repository_id,projection) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, project, id, kind, candidate.ID, doc.SHA256, protocol.SchemaVersion, repo, rawJSON(doc.Value)); err != nil {
		return err
	}
	switch kind {
	case "definitions":
		err = s.insertDefinitions(r, tx, doc)
	case "target":
		err = s.insertTarget(r, tx, doc)
	case "plan":
		err = s.insertPlan(r, tx, doc)
	}
	if err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	reply(w, 201, map[string]any{"id": id, "sha256": doc.SHA256})
	return nil
}
func (s *Server) insertDefinitions(r *http.Request, tx pgx.Tx, d protocol.Document) error {
	ctx, project := r.Context(), d.ProjectID
	repo := text(d.Value, "repositoryId")
	for _, v := range list(d.Value["cases"]) {
		c := object(v)
		id := text(c, "id")
		var origin any
		if c["originCampaignId"] != nil {
			origin = c["originCampaignId"]
		}
		_, err := tx.Exec(ctx, "INSERT INTO cases(project_id,id,owner_repository_id,origin_campaign_id) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,id) DO NOTHING", project, id, repo, origin)
		if err != nil {
			return err
		}
		var owner string
		if err = tx.QueryRow(ctx, "SELECT owner_repository_id::text FROM cases WHERE project_id=$1 AND id=$2", project, id).Scan(&owner); err != nil {
			return err
		}
		if owner != repo {
			return protocol.Failure("REFERENCE_INVALID", "/cases", "case maintained by another repository")
		}
		if _, err = tx.Exec(ctx, "INSERT INTO case_versions(project_id,case_id,version_id,document_id,title,check_items,projection) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", project, id, text(c, "versionId"), d.ID, text(c, "title"), rawJSON(c["checkItems"]), rawJSON(c)); err != nil {
			return err
		}
		var stored []byte
		if err = tx.QueryRow(ctx, "SELECT projection FROM case_versions WHERE project_id=$1 AND case_id=$2 AND version_id=$3", project, id, text(c, "versionId")).Scan(&stored); err != nil {
			return err
		}
		previous, _ := decodeMap(stored)
		if !sameValue(previous, c) {
			return protocol.Failure("ID_CONTENT_CONFLICT", "/cases", "case version content is immutable")
		}
	}
	for _, v := range list(d.Value["executionDefinitions"]) {
		e := object(v)
		c := object(e["caseRef"])
		if _, err := tx.Exec(ctx, "INSERT INTO execution_definitions(project_id,id,case_id) VALUES($1,$2,$3) ON CONFLICT(project_id,id) DO NOTHING", project, text(e, "id"), text(c, "id")); err != nil {
			return err
		}
		var actual string
		if err := tx.QueryRow(ctx, "SELECT case_id::text FROM execution_definitions WHERE project_id=$1 AND id=$2", project, text(e, "id")).Scan(&actual); err != nil {
			return err
		}
		if actual != text(c, "id") {
			return protocol.Failure("REFERENCE_INVALID", "/executionDefinitions", "execution identity cannot change case")
		}
		if _, err := tx.Exec(ctx, "INSERT INTO execution_versions(project_id,execution_id,version_id,case_id,case_version_id,document_id,evidence_requirements,projection) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING", project, text(e, "id"), text(e, "versionId"), text(c, "id"), text(c, "versionId"), d.ID, rawJSON(e["evidenceRequirements"]), rawJSON(e)); err != nil {
			return err
		}
		var stored []byte
		if err := tx.QueryRow(ctx, "SELECT projection FROM execution_versions WHERE project_id=$1 AND execution_id=$2 AND version_id=$3", project, text(e, "id"), text(e, "versionId")).Scan(&stored); err != nil {
			return err
		}
		previous, _ := decodeMap(stored)
		if !sameValue(previous, e) {
			return protocol.Failure("ID_CONTENT_CONFLICT", "/executionDefinitions", "execution version content is immutable")
		}
	}
	for _, v := range list(d.Value["moduleTags"]) {
		m := object(v)
		if _, err := tx.Exec(ctx, "INSERT INTO module_tags(project_id,id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,id) DO UPDATE SET name=EXCLUDED.name", project, text(m, "id"), text(m, "name")); err != nil {
			return err
		}
	}
	for _, v := range list(d.Value["suites"]) {
		suite := object(v)
		if _, err := tx.Exec(ctx, "INSERT INTO suites(project_id,id,title) VALUES($1,$2,$3) ON CONFLICT(project_id,id) DO UPDATE SET title=EXCLUDED.title", project, text(suite, "id"), text(suite, "title")); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "DELETE FROM suite_cases WHERE project_id=$1 AND suite_id=$2", project, text(suite, "id")); err != nil {
			return err
		}
		for _, id := range list(suite["caseIds"]) {
			if _, err := tx.Exec(ctx, "INSERT INTO suite_cases(project_id,suite_id,case_id) VALUES($1,$2,$3)", project, text(suite, "id"), id); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "DELETE FROM suite_modules WHERE project_id=$1 AND suite_id=$2", project, text(suite, "id")); err != nil {
			return err
		}
		for _, id := range list(suite["moduleIds"]) {
			var found bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM module_tags WHERE project_id=$1 AND id=$2)", project, id).Scan(&found); err != nil {
				return err
			}
			if !found {
				return protocol.Failure("REFERENCE_INVALID", "/suites/moduleIds", "module missing")
			}
			if _, err := tx.Exec(ctx, "INSERT INTO suite_modules(project_id,suite_id,module_id) VALUES($1,$2,$3)", project, text(suite, "id"), id); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Server) insertTarget(r *http.Request, tx pgx.Tx, d protocol.Document) error {
	for _, v := range list(d.Value["repositories"]) {
		repo := object(v)
		var exists bool
		if err := tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM repositories WHERE project_id=$1 AND id=$2)", d.ProjectID, text(repo, "repositoryId")).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return protocol.Failure("REFERENCE_INVALID", "/repositories", "repository missing")
		}
	}
	_, err := tx.Exec(r.Context(), "INSERT INTO targets(project_id,id,campaign_id,document_id,repositories) VALUES($1,$2,$3,$2,$4)", d.ProjectID, d.ID, r.PathValue("campaignId"), rawJSON(d.Value["repositories"]))
	return err
}
func (s *Server) insertPlan(r *http.Request, tx pgx.Tx, d protocol.Document) error {
	project, campaign := d.ProjectID, r.PathValue("campaignId")
	if text(d.Value, "campaignId") != campaign {
		return protocol.Failure("REFERENCE_INVALID", "/campaignId", "plan belongs to another campaign")
	}
	var previous map[string]any
	if d.Value["previousPlanId"] != nil {
		var raw []byte
		if err := tx.QueryRow(r.Context(), "SELECT doc.projection FROM plans p JOIN immutable_documents doc ON doc.project_id=p.project_id AND doc.document_id=p.document_id WHERE p.project_id=$1 AND p.campaign_id=$2 AND p.id=$3", project, campaign, d.Value["previousPlanId"]).Scan(&raw); err != nil {
			return err
		}
		json.Unmarshal(raw, &previous)
	}
	oldItems := map[string]map[string]any{}
	for _, v := range list(previous["items"]) {
		oldItems[text(object(v), "id")] = object(v)
	}
	if _, err := tx.Exec(r.Context(), "INSERT INTO plans(project_id,id,campaign_id,document_id,previous_plan_id,change_reason) VALUES($1,$2,$3,$2,$4,$5)", project, d.ID, campaign, d.Value["previousPlanId"], text(d.Value, "changeReason")); err != nil {
		return err
	}
	for _, v := range list(d.Value["items"]) {
		item := object(v)
		caseRef, executionRef := object(item["caseRef"]), object(item["executionRef"])
		for _, ref := range []map[string]any{caseRef, executionRef} {
			var actual string
			if err := tx.QueryRow(r.Context(), "SELECT sha256 FROM immutable_documents WHERE project_id=$1 AND document_id=$2 AND kind='definitions'", project, text(ref, "documentId")).Scan(&actual); err != nil {
				return err
			}
			if actual != text(ref, "sha256") {
				return protocol.Failure("REFERENCE_INVALID", "/items", "definition digest mismatch")
			}
		}
		var caseDoc string
		if err := tx.QueryRow(r.Context(), "SELECT document_id::text FROM case_versions WHERE project_id=$1 AND case_id=$2 AND version_id=$3", project, text(caseRef, "id"), text(caseRef, "versionId")).Scan(&caseDoc); err != nil {
			return err
		}
		if caseDoc != text(caseRef, "documentId") {
			return protocol.Failure("REFERENCE_INVALID", "/items/caseRef", "case document mismatch")
		}
		var executionDoc, cid, cv string
		var requirements []byte
		if err := tx.QueryRow(r.Context(), "SELECT document_id::text,case_id::text,case_version_id::text,evidence_requirements FROM execution_versions WHERE project_id=$1 AND execution_id=$2 AND version_id=$3", project, text(executionRef, "id"), text(executionRef, "versionId")).Scan(&executionDoc, &cid, &cv, &requirements); err != nil {
			return err
		}
		if executionDoc != text(executionRef, "documentId") || cid != text(caseRef, "id") || cv != text(caseRef, "versionId") {
			return protocol.Failure("REFERENCE_INVALID", "/items/executionRef", "execution/case mismatch")
		}
		var base []any
		json.Unmarshal(requirements, &base)
		if err := checkEvidenceRequirements(base, list(item["evidenceRequirements"])); err != nil {
			return err
		}
		if old := oldItems[text(item, "id")]; old != nil && old["required"] == true && item["required"] == false && strings.TrimSpace(text(item, "changeReason")) == "" {
			return protocol.Failure("SCHEMA_INVALID", "/items/changeReason", "required downgrade needs an item reason")
		}
		if _, err := tx.Exec(r.Context(), "INSERT INTO plan_items(project_id,plan_id,item_id,case_id,case_version_id,execution_id,execution_version_id,required,environment,evidence_requirements,projection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", project, d.ID, text(item, "id"), cid, cv, text(executionRef, "id"), text(executionRef, "versionId"), item["required"], rawJSON(item["environmentRequirements"]), rawJSON(item["evidenceRequirements"]), rawJSON(item)); err != nil {
			return err
		}
	}
	return nil
}
func checkEvidenceRequirements(base, plan []any) error {
	byID := map[string]map[string]any{}
	for _, v := range plan {
		m := object(v)
		id := text(m, "checkItemId")
		if byID[id] != nil {
			return protocol.Failure("SCHEMA_INVALID", "/evidenceRequirements", "duplicate evidence requirement")
		}
		byID[id] = m
	}
	for _, v := range base {
		b := object(v)
		p := byID[text(b, "checkItemId")]
		if p == nil {
			continue
		}
		bn, _ := b["minCount"].(float64)
		pn, _ := p["minCount"].(json.Number)
		pv, _ := pn.Float64()
		if pv < bn {
			return protocol.Failure("SCHEMA_INVALID", "/evidenceRequirements", "plan cannot lower execution evidence count")
		}
		kinds := map[string]bool{}
		for _, kind := range list(b["allowedKinds"]) {
			kinds[kind.(string)] = true
		}
		for _, kind := range list(p["allowedKinds"]) {
			if !kinds[kind.(string)] {
				return protocol.Failure("SCHEMA_INVALID", "/evidenceRequirements", "plan cannot broaden allowed evidence kinds")
			}
		}
	}
	return nil
}
func (s *Server) createCampaign(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		ID           string            `json:"id"`
		Title        string            `json:"title"`
		ExternalRefs map[string]string `json:"externalRefs"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if err := validID(v.ID); err != nil {
		return err
	}
	if strings.TrimSpace(v.Title) == "" {
		return protocol.Failure("INVALID_ARGUMENT", "/title", "campaign title required")
	}
	if v.ExternalRefs == nil {
		v.ExternalRefs = map[string]string{}
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, r.PathValue("projectId")); err != nil || hit {
		return err
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO campaigns(project_id,id,title,external_refs) VALUES($1,$2,$3,$4)", r.PathValue("projectId"), v.ID, v.Title, rawJSON(v.ExternalRefs)); err != nil {
		return err
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
func (s *Server) getCampaign(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var raw json.RawMessage
	var version int64
	err := s.Store.Pool.QueryRow(r.Context(), `SELECT jsonb_build_object('id',id,'title',title,'planId',current_plan_id,'targetId',current_target_id,'snapshotId',current_snapshot_id,'basisVersion',basis_version::text,'reviewVersion',review_version::text),basis_version FROM campaigns WHERE project_id=$1 AND id=$2`, r.PathValue("projectId"), r.PathValue("campaignId")).Scan(&raw, &version)
	if err != nil {
		return err
	}
	w.Header().Set("ETag", basisETag(version))
	reply(w, 200, raw)
	return nil
}
func basisETag(version int64) string { return `"basis-` + strconv.FormatInt(version, 10) + `"` }
func precondition(r *http.Request, want string) error {
	actual := r.Header.Get("If-Match")
	if actual == "" {
		return protocol.Failure("VERSION_PRECONDITION_REQUIRED", "", "If-Match required")
	}
	if actual != want {
		return protocol.Failure("VERSION_PRECONDITION_FAILED", "", "basis changed; refresh before resubmitting")
	}
	return nil
}
func (s *Server) changeBasis(w http.ResponseWriter, r *http.Request, p identity.Principal) error {
	var v struct {
		PlanID   string `json:"planId"`
		TargetID string `json:"targetId"`
		Reason   string `json:"reason"`
	}
	if err := decode(w, r, &v); err != nil {
		return err
	}
	if err := validID(v.PlanID); err != nil {
		return err
	}
	if err := validID(v.TargetID); err != nil {
		return err
	}
	if strings.TrimSpace(v.Reason) == "" {
		return protocol.Failure("INVALID_ARGUMENT", "/reason", "basis change reason required")
	}
	tx, err := s.Auth.BeginWrite(r.Context(), p)
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if hit, err := replay(w, r, tx, r.PathValue("projectId")); err != nil || hit {
		return err
	}
	var version int64
	if err = tx.QueryRow(r.Context(), "SELECT basis_version FROM campaigns WHERE project_id=$1 AND id=$2 FOR UPDATE", r.PathValue("projectId"), r.PathValue("campaignId")).Scan(&version); err != nil {
		return err
	}
	if err = precondition(r, basisETag(version)); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "UPDATE campaigns SET current_plan_id=$3,current_target_id=$4,current_snapshot_id=NULL,basis_version=basis_version+1 WHERE project_id=$1 AND id=$2", r.PathValue("projectId"), r.PathValue("campaignId"), v.PlanID, v.TargetID); err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO campaign_basis_events(id,project_id,campaign_id,plan_id,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)", protocol.NewID(), r.PathValue("projectId"), r.PathValue("campaignId"), v.PlanID, v.TargetID, v.Reason); err != nil {
		return err
	}
	if err = rememberResponse(r, tx, r.PathValue("projectId"), 200, map[string]any{"planId": v.PlanID, "targetId": v.TargetID, "basisVersion": strconv.FormatInt(version+1, 10)}); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	w.Header().Set("ETag", basisETag(version+1))
	reply(w, 200, map[string]any{"planId": v.PlanID, "targetId": v.TargetID, "basisVersion": strconv.FormatInt(version+1, 10)})
	return nil
}
func (s *Server) getDocument(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	kind, id := "plan", r.PathValue("planId")
	table := "plans"
	if id == "" {
		kind, id, table = "target", r.PathValue("targetId"), "targets"
	}
	var raw json.RawMessage
	err := s.Store.Pool.QueryRow(r.Context(), "SELECT d.projection FROM "+table+" t JOIN immutable_documents d ON d.project_id=t.project_id AND d.document_id=t.document_id WHERE t.project_id=$1 AND t.campaign_id=$2 AND t.id=$3 AND d.kind=$4", r.PathValue("projectId"), r.PathValue("campaignId"), id, kind).Scan(&raw)
	if err != nil {
		return err
	}
	reply(w, 200, raw)
	return nil
}
func (s *Server) documentContent(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	var objectID string
	if err := s.Store.Pool.QueryRow(r.Context(), "SELECT raw_asset_id::text FROM immutable_documents WHERE project_id=$1 AND document_id=$2", r.PathValue("projectId"), r.PathValue("documentId")).Scan(&objectID); err != nil {
		return err
	}
	file, o, err := s.Storage.Read(r.Context(), r.PathValue("projectId"), objectID)
	if err != nil {
		return err
	}
	defer file.Close()
	size, hash, err := protocol.HashFile(file, o.Size)
	if err != nil || size != o.Size || hash != o.SHA256 {
		return protocol.Failure("DIGEST_MISMATCH", "", "registered document integrity invalid")
	}
	file.Seek(0, 0)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="document.json"`)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "document.json", time.Time{}, file)
	return nil
}
func (s *Server) listCampaigns(w http.ResponseWriter, r *http.Request, _ identity.Principal) error {
	project := r.PathValue("projectId")
	cursor, err := decodeCursor(r.URL.Query().Get("cursor"), "campaigns/"+project)
	if err != nil {
		return err
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 200 {
			return protocol.Failure("INVALID_ARGUMENT", "/limit", "limit must be 1..200")
		}
	}
	rows, err := s.Store.Pool.Query(r.Context(), "SELECT jsonb_build_object('id',id,'title',title,'planId',current_plan_id,'targetId',current_target_id,'snapshotId',current_snapshot_id),created_at,id::text FROM campaigns WHERE project_id=$1 AND (created_at,id)>($2,$3::uuid) ORDER BY created_at,id LIMIT $4", project, cursor.Time, cursor.ID, limit+1)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []json.RawMessage{}
	var last Cursor
	var next any
	for rows.Next() {
		var raw json.RawMessage
		var t time.Time
		var id string
		if err = rows.Scan(&raw, &t, &id); err != nil {
			return err
		}
		if len(items) == limit {
			next = encodeCursor(last, "campaigns/"+project)
			break
		}
		items = append(items, raw)
		last = Cursor{Time: t, ID: id}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	reply(w, 200, map[string]any{"items": items, "nextCursor": next})
	return nil
}

func integer(v any) int64 {
	switch n := v.(type) {
	case json.Number:
		f, _ := n.Float64()
		return int64(f)
	case float64:
		return int64(n)
	case int64:
		return n
	}
	return 0
}

func sameValue(a, b any) bool {
	x, err := protocol.Canonical(a)
	if err != nil {
		return false
	}
	y, err := protocol.Canonical(b)
	return err == nil && bytes.Equal(x, y)
}
