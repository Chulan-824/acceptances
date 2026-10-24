package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func (s *Server) document(key string) (BusinessDocument, error) {
	var document BusinessDocument
	var rawGuide string
	err := s.db.QueryRow("SELECT kind,guide,id,delivery_id,version,request_id,template_version,status,attempts,error,content_hash,created_at,completed_at FROM business_documents WHERE id=?", key).Scan(
		&document.Kind, &rawGuide, &document.ID, &document.DeliveryID, &document.Version, &document.RequestID, &document.TemplateVersion, &document.Status, &document.Attempts, &document.Error, &document.SHA256, &document.CreatedAt, &document.CompletedAt)
	if err == nil && rawGuide != "" {
		err = json.Unmarshal([]byte(rawGuide), &document.Guide)
	}
	return document, err
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	document, err := s.document(r.PathValue("id"))
	s.mu.Unlock()
	if err != nil {
		lookupFailure(w, r, err, "DOCUMENT_NOT_FOUND")
		return
	}
	respond(w, 200, document)
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.delivery(r.PathValue("id")); err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	kind := DocumentKind(r.URL.Query().Get("kind"))
	if kind != "" && kind != TestReportDocument && kind != BusinessGuideDocument {
		deliveryFailure(w, 400, "DOCUMENT_KIND_INVALID", "未知的文档类型。")
		return
	}
	rows, err := s.db.QueryContext(r.Context(), "SELECT id FROM business_documents WHERE delivery_id=? AND (?='' OR kind=?) ORDER BY created_at DESC,version DESC", r.PathValue("id"), kind, kind)
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			fail(w, 500, "READ_FAILED")
			return
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	items := []BusinessDocument{}
	for _, key := range keys {
		document, err := s.document(key)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		items = append(items, document)
	}
	respond(w, 200, map[string]any{"items": items})
}

func (s *Server) documentHTML(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	document, err := s.document(r.PathValue("id"))
	s.mu.Unlock()
	if err != nil {
		lookupFailure(w, r, err, "DOCUMENT_NOT_FOUND")
		return
	}
	if document.Status != "succeeded" {
		deliveryFailure(w, 409, "DOCUMENT_NOT_READY", "说明尚未生成成功，没有可预览或下载的成品。")
		return
	}
	root, err := s.openFiles(r.Context(), fileOwner{"documents", document.ID})
	if err != nil {
		fail(w, 500, "DOCUMENT_FILE_UNAVAILABLE")
		return
	}
	defer root.Close()
	opened, err := root.Open("business.html")
	if err != nil {
		fail(w, 500, "DOCUMENT_FILE_UNAVAILABLE")
		return
	}
	defer opened.Close()
	file, ok := opened.(readSeekFile)
	if !ok {
		fail(w, 500, "READ_FAILED")
		return
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 500, "DOCUMENT_FILE_UNAVAILABLE")
		return
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil || hex.EncodeToString(hash.Sum(nil)) != document.SHA256 {
		fail(w, 500, "DOCUMENT_INTEGRITY_FAILED")
		return
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		fail(w, 500, "READ_FAILED")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	if r.URL.Query().Get("download") == "1" {
		filename := fmt.Sprintf("test-report-v%d.html", document.Version)
		if document.Kind == BusinessGuideDocument {
			filename = fmt.Sprintf("business-guide-v%d.html", document.Version)
		}
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	}
	http.ServeContent(w, r, "business.html", info.ModTime(), file)
}
