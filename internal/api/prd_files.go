package api

import (
	"bytes"
	"context"
	"errors"
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
	s.serveOwnedEvidence(w, r, fileOwner{"prd-imports", id}, file.Name, &ArchivedFile{Path: file.Name, Size: file.Size, SHA256: file.SHA256})
}
