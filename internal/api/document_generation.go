package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type documentProblem struct{ code, message string }

func (p documentProblem) Error() string { return p.message }

func (s *Server) generateDocument(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RequestID string `json:"requestId"`
	}
	if !decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.RequestID) == "" || len(input.RequestID) > 200 {
		deliveryFailure(w, 400, "DOCUMENT_REQUEST_REQUIRED", "生成说明需要提交标识。")
		return
	}
	s.startDocument(w, r, r.PathValue("id"), input.RequestID, "")
}

func (s *Server) retryDocument(w http.ResponseWriter, r *http.Request) {
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	s.startDocument(w, r, "", "", r.PathValue("id"))
}

func (s *Server) startDocument(w http.ResponseWriter, r *http.Request, deliveryID, requestID, retryID string) {
	s.mu.Lock()
	document, snapshot, render, err := s.prepareDocument(r.Context(), deliveryID, requestID, retryID)
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
	if err = s.renderAndSaveDocument(r.Context(), snapshot, document); err != nil {
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

func (s *Server) prepareDocument(ctx context.Context, deliveryID, requestID, retryID string) (BusinessDocument, DeliverySnapshot, bool, error) {
	var document BusinessDocument
	var snapshot DeliverySnapshot
	var err error
	if retryID != "" {
		document, err = s.document(retryID)
		if err != nil {
			return document, snapshot, false, err
		}
		deliveryID, requestID = document.DeliveryID, document.RequestID
	} else {
		var key string
		err = s.db.QueryRowContext(ctx, "SELECT id FROM business_documents WHERE request_id=?", requestID).Scan(&key)
		if err == nil {
			document, err = s.document(key)
			if err != nil {
				return document, snapshot, false, err
			}
			if document.DeliveryID != deliveryID {
				return document, snapshot, false, documentProblem{"DOCUMENT_REQUEST_CONFLICT", "同一说明提交标识不能用于其他交付。"}
			}
		} else if err != sql.ErrNoRows {
			return document, snapshot, false, err
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
	if err = s.db.QueryRowContext(ctx, "SELECT count(*) FROM business_documents WHERE delivery_id=? AND status='generating'", deliveryID).Scan(&generating); err != nil {
		return document, snapshot, false, err
	}
	if generating != 0 {
		return document, snapshot, false, documentProblem{"DOCUMENT_GENERATING", "已有说明正在生成，请等待或刷新状态。"}
	}
	if document.ID != "" && document.TemplateVersion != documentTemplateVersion {
		return document, snapshot, false, documentProblem{"DOCUMENT_TEMPLATE_CHANGED", "该失败版本的模板已不受支持，请创建新说明版本。"}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return document, snapshot, false, err
	}
	defer tx.Rollback()
	if document.ID == "" {
		document = BusinessDocument{ID: id(), DeliveryID: deliveryID, RequestID: requestID, TemplateVersion: documentTemplateVersion, Status: "generating", Attempts: 1, CreatedAt: now()}
		err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM business_documents WHERE delivery_id=?", deliveryID).Scan(&document.Version)
		if err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO business_documents(id,delivery_id,version,request_id,template_version,status,created_at) VALUES(?,?,?,?,?,'generating',?)`, document.ID, document.DeliveryID, document.Version, document.RequestID, document.TemplateVersion, document.CreatedAt)
		}
	} else {
		document.Status, document.Error, document.CompletedAt = "generating", "", ""
		document.Attempts++
		_, err = tx.ExecContext(ctx, "UPDATE business_documents SET status='generating',attempts=attempts+1,error='',completed_at='' WHERE id=? AND status='failed'", document.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	return document, snapshot, err == nil, err
}

func (s *Server) renderAndSaveDocument(ctx context.Context, snapshot DeliverySnapshot, document BusinessDocument) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(s.dir, ".document-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	root, err := os.OpenRoot(filepath.Join(s.dir, "deliveries", snapshot.ID, "evidence"))
	if err != nil {
		return fmt.Errorf("冻结证据不可用")
	}
	defer root.Close()
	file, err := os.OpenFile(filepath.Join(stage, "business.html"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	renderErr := renderBusinessDocument(io.MultiWriter(file, hash), root, snapshot, document)
	syncErr, closeErr := file.Sync(), file.Close()
	if renderErr != nil {
		return renderErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err = syncDirectory(stage); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var state string
	if err = s.db.QueryRowContext(ctx, "SELECT status FROM delivery_snapshots WHERE id=?", snapshot.ID).Scan(&state); err != nil {
		return err
	}
	if state != "valid" {
		return fmt.Errorf("生成期间交付已失效或被替代")
	}
	target := filepath.Join(s.dir, "documents", document.ID)
	if err = os.Rename(stage, target); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			os.RemoveAll(target)
		}
	}()
	if err = syncDirectory(filepath.Dir(target)); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, "UPDATE business_documents SET status='succeeded',content_hash=?,completed_at=? WHERE id=? AND status='generating'", hex.EncodeToString(hash.Sum(nil)), now(), document.ID)
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
	committed = true
	return nil
}
