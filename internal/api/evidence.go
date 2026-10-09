package api

import (
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
	root, e := os.OpenRoot(filepath.Join(s.dir, "evidence", v.ID))
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
