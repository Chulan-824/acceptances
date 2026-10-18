package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
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
	snapshot := DeliverySnapshot{ID: id(), RequestID: input.RequestID, CreatedAt: now(), SHA256: contentHash, Payload: payload}
	if err = s.publishDeliverySnapshot(r.Context(), snapshot, requestHash, string(raw)); err != nil {
		slog.ErrorContext(r.Context(), "publish delivery snapshot failed", "deliveryId", snapshot.ID, "error", err)
		if errors.Is(err, errDeliveryEvidenceSave) {
			deliveryFailure(w, 500, "DELIVERY_EVIDENCE_SAVE_FAILED", "交付证据保存失败或发生变化，未创建快照。")
		} else {
			fail(w, 500, "SAVE_FAILED")
		}
		return
	}
	s.respondDelivery(w, r, snapshot.ID, 201)
}

func (s *Server) persistDeliverySnapshot(ctx context.Context, snapshot DeliverySnapshot, requestHash, raw string) error {
	return s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
		var version int
		err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM delivery_snapshots WHERE campaign_id=?", snapshot.Payload.Campaign.ID).Scan(&version)
		if err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO delivery_snapshots(id,project_id,campaign_id,source_run_id,version,request_id,request_hash,payload,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, snapshot.ID, snapshot.Payload.Project.ID, snapshot.Payload.Campaign.ID, snapshot.Payload.Run.ID, version, snapshot.RequestID, requestHash, raw, snapshot.SHA256, snapshot.CreatedAt)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO delivery_requests VALUES(?,?,?)", snapshot.RequestID, requestHash, snapshot.ID)
		}
		if err == nil {
			err = transitionDeliveries(ctx, tx, "campaign_id=? AND id<>? AND status='valid'", []any{snapshot.Payload.Campaign.ID, snapshot.ID}, "superseded", "已由新的明确冻结交付替代。", snapshot.ID, snapshot.CreatedAt)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, "INSERT INTO delivery_events VALUES(?,?,?,?,?,?)", id(), snapshot.ID, "frozen", "人工确认交付范围、说明素材及审核结论。", snapshot.Payload.Run.ID, snapshot.CreatedAt)
		}
		return err
	})
}
