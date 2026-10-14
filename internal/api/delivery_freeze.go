package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func deliveryFailure(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]string{"code": code, "message": message})
}

func (s *Server) deliveryPreparation(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prep, err := s.prepareDelivery(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	respond(w, 200, prep)
}

func (s *Server) freezeDelivery(w http.ResponseWriter, r *http.Request) {
	var input FreezeDeliveryInput
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.RequestID) == "" || len(input.RequestID) > 200 || input.Token == "" {
		deliveryFailure(w, 400, "FREEZE_INPUT_REQUIRED", "冻结需要提交标识和最新审核 token。")
		return
	}
	for key, reason := range input.ExceptionReasons {
		input.ExceptionReasons[key] = strings.TrimSpace(reason)
	}
	hashInput := input
	hashInput.RequestID = ""
	canonical, err := json.Marshal(struct {
		RunID string
		Input FreezeDeliveryInput
	}{r.PathValue("id"), hashInput})
	if err != nil {
		fail(w, 400, "INVALID_INPUT")
		return
	}
	requestHash := digestBytes(canonical)
	s.mu.Lock()
	defer s.mu.Unlock()
	var existingID, existingHash string
	err = s.db.QueryRowContext(r.Context(), "SELECT delivery_id,request_hash FROM delivery_requests WHERE request_id=?", input.RequestID).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			deliveryFailure(w, 409, "FREEZE_REQUEST_CONFLICT", "同一冻结提交标识不能用于不同内容。")
			return
		}
		s.respondDelivery(w, r, existingID, 200)
		return
	}
	if err != sql.ErrNoRows {
		fail(w, 500, "READ_FAILED")
		return
	}
	prep, err := s.prepareDelivery(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "RUN_NOT_FOUND")
		return
	}
	if input.Token != prep.Token {
		deliveryFailure(w, 409, "STALE_DELIVERY_CONFIRMATION", "验证记录、人审或附件已变化，请刷新后重新确认。")
		return
	}
	if !prep.Eligible {
		respond(w, 409, map[string]any{"code": "DELIVERY_NOT_READY", "message": "尚不满足冻结条件。", "issues": prep.Issues})
		return
	}
	if !input.MapConfirmed || !input.MaterialsConfirmed || !input.SensitiveInfoReviewed {
		deliveryFailure(w, 400, "DELIVERY_CONFIRMATION_REQUIRED", "请明确确认地图范围、说明内容及敏感信息检查。")
		return
	}
	for checkID := range input.ExceptionReasons {
		if _, exists := prep.ExceptionReasons[checkID]; !exists {
			deliveryFailure(w, 400, "INVALID_EXCEPTION_CHECK", "接受理由只能关联本轮原始未通过的检查项。")
			return
		}
	}
	for checkID, previous := range prep.ExceptionReasons {
		reason := input.ExceptionReasons[checkID]
		if reason == "" {
			reason = previous
		}
		if reason == "" || isBulkAcceptanceBody(reason) {
			deliveryFailure(w, 400, "EXCEPTION_REASON_REQUIRED", "原始未通过项 "+checkID+" 必须有具体接受理由。")
			return
		}
		prep.ExceptionReasons[checkID] = reason
	}
	payload := DeliveryPayload{
		SchemaVersion: 1, Project: prep.Project, Campaign: prep.Campaign, Run: prep.Run,
		Manifest: *prep.Manifest, Map: *prep.Map, Materials: *prep.Materials,
		Files: prep.Files, ExceptionReasons: prep.ExceptionReasons,
		MapConfirmed: true, MaterialsConfirmed: true, SensitiveInfoReviewed: true,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	contentHash := digestBytes(raw)
	err = s.db.QueryRowContext(r.Context(), "SELECT id FROM delivery_snapshots WHERE source_run_id=? AND content_hash=? AND status='valid'", prep.Run.ID, contentHash).Scan(&existingID)
	if err == nil {
		if _, err = s.db.ExecContext(r.Context(), "INSERT INTO delivery_requests VALUES(?,?,?)", input.RequestID, requestHash, existingID); err != nil {
			fail(w, 500, "SAVE_FAILED")
			return
		}
		s.respondDelivery(w, r, existingID, 200)
		return
	}
	if err != sql.ErrNoRows {
		fail(w, 500, "READ_FAILED")
		return
	}
	stage, err := os.MkdirTemp(s.dir, ".delivery-")
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer os.RemoveAll(stage)
	if err = s.copyDeliveryEvidence(prep.Run.ID, stage, prep.Files); err != nil {
		deliveryFailure(w, 500, "DELIVERY_EVIDENCE_SAVE_FAILED", "交付证据保存失败或发生变化，未创建快照。")
		return
	}
	key, createdAt := id(), now()
	target := filepath.Join(s.dir, "deliveries", key)
	if err = os.Rename(stage, target); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	committed := false
	defer func() {
		if !committed {
			os.RemoveAll(target)
		}
	}()
	if err = syncDirectory(filepath.Dir(target)); err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	defer tx.Rollback()
	var version int
	err = tx.QueryRowContext(r.Context(), "SELECT COALESCE(MAX(version),0)+1 FROM delivery_snapshots WHERE campaign_id=?", prep.Campaign.ID).Scan(&version)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO delivery_snapshots(id,project_id,campaign_id,source_run_id,version,request_id,request_hash,payload,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, key, prep.Project.ID, prep.Campaign.ID, prep.Run.ID, version, input.RequestID, requestHash, string(raw), contentHash, createdAt)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO delivery_requests VALUES(?,?,?)", input.RequestID, requestHash, key)
	}
	if err == nil {
		err = transitionDeliveries(r.Context(), tx, "campaign_id=? AND id<>? AND status='valid'", []any{prep.Campaign.ID, key}, "superseded", "已由新的明确冻结交付替代。", key, createdAt)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), "INSERT INTO delivery_events VALUES(?,?,?,?,?,?)", id(), key, "frozen", "人工确认交付范围、说明素材及审核结论。", prep.Run.ID, createdAt)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 500, "SAVE_FAILED")
		return
	}
	committed = true
	s.respondDelivery(w, r, key, 201)
}
