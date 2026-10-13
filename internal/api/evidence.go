package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) evidence(w http.ResponseWriter, r *http.Request) {
	v, e := s.run(r.PathValue("id"))
	if e != nil {
		lookupFailure(w, r, e, "RUN_NOT_FOUND")
		return
	}
	name := r.PathValue("filename")
	found := false
	for _, item := range v.Report.Evidence {
		if item.Path == name {
			found = true
			break
		}
	}
	if !found || !validName(name) {
		fail(w, 404, "EVIDENCE_NOT_FOUND")
		return
	}
	serveEvidenceFile(w, r, filepath.Join(s.dir, "evidence", v.ID), name)
}

func serveEvidenceFile(w http.ResponseWriter, r *http.Request, directory, name string) {
	serveVerifiedEvidence(w, r, directory, name, nil)
}

func serveVerifiedEvidence(w http.ResponseWriter, r *http.Request, directory, name string, expected *ArchivedFile) {
	if !validName(name) {
		fail(w, 404, "EVIDENCE_NOT_FOUND")
		return
	}
	root, e := os.OpenRoot(directory)
	if e != nil {
		fail(w, 404, "EVIDENCE_NOT_FOUND")
		return
	}
	defer root.Close()
	file, e := root.Open(name)
	if e != nil {
		fail(w, 404, "EVIDENCE_NOT_FOUND")
		return
	}
	defer file.Close()
	info, e := file.Stat()
	if e != nil || !info.Mode().IsRegular() {
		fail(w, 404, "EVIDENCE_NOT_FOUND")
		return
	}
	if expected != nil {
		hash := sha256.New()
		size, err := io.Copy(hash, file)
		if err != nil || size != expected.Size || hex.EncodeToString(hash.Sum(nil)) != expected.SHA256 {
			fail(w, 409, "EVIDENCE_INTEGRITY_FAILED")
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			fail(w, 500, "READ_FAILED")
			return
		}
	}
	kind := "application/octet-stream"
	disposition := "attachment"
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		kind = "image/png"
		disposition = "inline"
	case ".jpg", ".jpeg":
		kind = "image/jpeg"
		disposition = "inline"
	case ".gif":
		kind = "image/gif"
		disposition = "inline"
	case ".webp":
		kind = "image/webp"
		disposition = "inline"
	case ".mp4":
		kind = "video/mp4"
		disposition = "inline"
	case ".webm":
		kind = "video/webm"
		disposition = "inline"
	case ".txt", ".log", ".json", ".csv":
		kind = "text/plain; charset=utf-8"
		disposition = "inline"
	}
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	http.ServeContent(w, r, name, info.ModTime(), file)
}
