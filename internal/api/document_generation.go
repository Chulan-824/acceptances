package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type documentProblem struct{ code, message string }

func (p documentProblem) Error() string { return p.message }

func (s *Server) generateDocument(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RequestID string         `json:"requestId"`
		Kind      DocumentKind   `json:"kind"`
		Guide     *BusinessGuide `json:"guide,omitempty"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.RequestID) == "" || len(input.RequestID) > 200 {
		deliveryFailure(w, 400, "DOCUMENT_REQUEST_REQUIRED", "生成说明需要提交标识。")
		return
	}
	if input.Kind == "" {
		input.Kind = TestReportDocument
	}
	if input.Kind != TestReportDocument && input.Kind != BusinessGuideDocument || input.Kind == TestReportDocument && input.Guide != nil {
		deliveryFailure(w, 400, "DOCUMENT_KIND_INVALID", "文档类型须为 business_guide 或 test_report；测试报告不接受指南素材。")
		return
	}
	s.startDocument(w, r, r.PathValue("id"), input.RequestID, "", input.Kind, input.Guide)
}

func (s *Server) retryDocument(w http.ResponseWriter, r *http.Request) {
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	s.startDocument(w, r, "", "", r.PathValue("id"), "", nil)
}

func (s *Server) startDocument(w http.ResponseWriter, r *http.Request, deliveryID, requestID, retryID string, kind DocumentKind, guide *BusinessGuide) {
	s.mu.Lock()
	document, snapshot, render, err := s.prepareDocument(r.Context(), deliveryID, requestID, retryID, kind, guide)
	s.mu.Unlock()
	if err != nil {
		var problem documentProblem
		if errors.As(err, &problem) {
			deliveryFailure(w, 409, problem.code, problem.message)
		} else {
			lookupFailure(w, r, err, "DOCUMENT_OR_DELIVERY_NOT_FOUND")
		}
		return
	}
	if !render {
		respond(w, 200, document)
		return
	}
	if err = s.publishBusinessDocument(r.Context(), snapshot, document); err != nil {
		s.mu.Lock()
		_, saveErr := s.db.ExecContext(context.Background(), "UPDATE business_documents SET status='failed',error=?,completed_at=? WHERE id=? AND status='generating'", "生成失败："+err.Error(), now(), document.ID)
		document, readErr := s.document(document.ID)
		s.mu.Unlock()
		if saveErr != nil || readErr != nil {
			fail(w, 500, "DOCUMENT_STATE_SAVE_FAILED")
			return
		}
		respond(w, 200, document)
		return
	}
	s.mu.Lock()
	document, err = s.document(document.ID)
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	respond(w, 201, document)
}

func (s *Server) prepareDocument(ctx context.Context, deliveryID, requestID, retryID string, kind DocumentKind, guide *BusinessGuide) (BusinessDocument, DeliverySnapshot, bool, error) {
	var document BusinessDocument
	var snapshot DeliverySnapshot
	var err error
	if retryID != "" {
		document, err = s.document(retryID)
		if err != nil {
			return document, snapshot, false, err
		}
		deliveryID, requestID, kind = document.DeliveryID, document.RequestID, document.Kind
	} else {
		var key string
		err = s.db.QueryRowContext(ctx, "SELECT id FROM business_documents WHERE request_id=?", requestID).Scan(&key)
		if err == nil {
			document, err = s.document(key)
			if err != nil {
				return document, snapshot, false, err
			}
			if document.DeliveryID != deliveryID || document.Kind != kind {
				return document, snapshot, false, documentProblem{"DOCUMENT_REQUEST_CONFLICT", "同一文档提交标识不能用于其他交付或文档类型。"}
			}
		} else if err != sql.ErrNoRows {
			return document, snapshot, false, err
		}
	}
	if document.ID != "" && guide != nil {
		incoming, _ := json.Marshal(guide)
		saved, _ := json.Marshal(document.Guide)
		if string(incoming) != string(saved) {
			return document, snapshot, false, documentProblem{"DOCUMENT_REQUEST_CONFLICT", "同一提交标识的指南内容不能改变，请创建新版本。"}
		}
	}
	if document.Status == "succeeded" {
		return document, snapshot, false, nil
	}
	if document.Status == "generating" {
		return document, snapshot, false, documentProblem{"DOCUMENT_GENERATING", "说明正在生成，请刷新状态，不要重复创建版本。"}
	}
	snapshot, err = s.delivery(deliveryID)
	if err != nil {
		return document, snapshot, false, err
	}
	if snapshot.Status != "valid" {
		return document, snapshot, false, documentProblem{"DELIVERY_INACTIVE", "交付已失效、撤销或被替代，只能查看已有历史说明。"}
	}
	var generating int
	if err = s.db.QueryRowContext(ctx, "SELECT count(*) FROM business_documents WHERE delivery_id=? AND kind=? AND status='generating'", deliveryID, kind).Scan(&generating); err != nil {
		return document, snapshot, false, err
	}
	if generating != 0 {
		return document, snapshot, false, documentProblem{"DOCUMENT_GENERATING", "已有说明正在生成，请等待或刷新状态。"}
	}
	if document.ID != "" && document.TemplateVersion != kind.templateVersion() {
		return document, snapshot, false, documentProblem{"DOCUMENT_TEMPLATE_CHANGED", "该失败版本的模板已不受支持，请创建新说明版本。"}
	}
	if document.ID != "" {
		if err = s.artifacts.prepareDocumentRetry(document.ID); err != nil {
			return document, snapshot, false, err
		}
	}
	var rawGuide string
	if document.ID == "" && kind == BusinessGuideDocument {
		if guide == nil {
			source, err := s.businessGuideMaterials(deliveryID)
			if err != nil {
				return document, snapshot, false, err
			}
			guide = &source
		}
		if err := validateBusinessGuide(*guide, snapshot); err != nil {
			return document, snapshot, false, documentProblem{"GUIDE_MATERIALS_INVALID", err.Error()}
		}
		raw, err := json.Marshal(guide)
		if err != nil {
			return document, snapshot, false, err
		}
		rawGuide = string(raw)
	}
	err = s.deliveryTransaction(ctx, func(tx *sql.Tx) error {
		if document.ID == "" {
			document = BusinessDocument{Kind: kind, Guide: guide, ID: id(), DeliveryID: deliveryID, RequestID: requestID, TemplateVersion: kind.templateVersion(), Status: "generating", Attempts: 1, CreatedAt: now()}
			err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM business_documents WHERE delivery_id=? AND kind=?", deliveryID, kind).Scan(&document.Version)
			if err == nil {
				_, err = tx.ExecContext(ctx, `INSERT INTO business_documents(id,delivery_id,kind,guide,version,request_id,template_version,status,created_at) VALUES(?,?,?,?,?,?,?,'generating',?)`, document.ID, document.DeliveryID, document.Kind, rawGuide, document.Version, document.RequestID, document.TemplateVersion, document.CreatedAt)
			}
		} else {
			document.Status, document.Error, document.CompletedAt = "generating", "", ""
			document.Attempts++
			_, err = tx.ExecContext(ctx, "UPDATE business_documents SET status='generating',attempts=attempts+1,error='',completed_at='' WHERE id=? AND status='failed'", document.ID)
		}
		return err
	})
	return document, snapshot, err == nil, err
}

func (s *Server) checkDocumentDelivery(ctx context.Context, deliveryID string) error {
	var state string
	if err := s.db.QueryRowContext(ctx, "SELECT status FROM delivery_snapshots WHERE id=?", deliveryID).Scan(&state); err != nil {
		return err
	}
	if state != "valid" {
		return fmt.Errorf("生成期间交付已失效或被替代")
	}
	return nil
}

func (s *Server) persistBusinessDocument(ctx context.Context, documentID, hash string) error {
	result, err := s.db.ExecContext(ctx, "UPDATE business_documents SET status='succeeded',content_hash=?,completed_at=? WHERE id=? AND status='generating'", hash, now(), documentID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("说明生成状态已变化")
	}
	return nil
}
