package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/Chulan-824/acceptances/internal/service"
)

// PRD reuses the archive's staging, sealing, deduplication and MVCC reader.
func (s *Server) stagePRDFiles(ctx context.Context, files map[string][]byte) ([]service.PRDStoredFile, func(), error) {
	if !s.databaseFiles() {
		return nil, nil, errors.New("PRD import requires MySQL file storage")
	}
	batch, err := s.beginFileBatch(ctx)
	if err != nil {
		return nil, nil, err
	}
	refs := make([]service.PRDStoredFile, 0, len(files))
	for name, data := range files {
		file, err := batch.put(name, bytes.NewReader(data))
		if err != nil {
			batch.Close()
			return nil, nil, err
		}
		refs = append(refs, service.PRDStoredFile{Name: name, BlobID: file.blobID, ModifiedAt: file.modified})
	}
	return refs, batch.Close, nil
}

func (s *Server) servePRDFile(w http.ResponseWriter, r *http.Request, id string, file prd.File) {
	if file.Role == "html" && r.URL.Query().Get("preview") == "1" {
		root, err := s.openFiles(r.Context(), fileOwner{"prd-imports", id})
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		defer root.Close()
		opened, err := root.Open(file.Name)
		if err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
		defer opened.Close()
		data, err := io.ReadAll(io.LimitReader(opened, prd.MaxResourceBytes+1))
		if err != nil || prd.DescribeFile(file.Name, file.Role, file.ContentType, data) != file {
			fail(w, 409, "EVIDENCE_INTEGRITY_FAILED")
			return
		}
		preview, err := prd.HTMLPreview(data)
		if err != nil {
			fail(w, 422, "HTML_PREVIEW_UNAVAILABLE")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", prd.HTMLPreviewPolicy)
		w.Write(preview)
		return
	}
	s.serveOwnedEvidence(w, r, fileOwner{"prd-imports", id}, file.Name, &ArchivedFile{Path: file.Name, Size: file.Size, SHA256: file.SHA256})
}
