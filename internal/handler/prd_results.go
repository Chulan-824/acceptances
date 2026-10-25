package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"

	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/Chulan-824/acceptances/internal/service"
)

func prdProof(r *http.Request) service.PRDProof {
	attempt, err := strconv.Atoi(r.Header.Get("X-Acceptances-Claim-Attempt"))
	if err != nil {
		attempt = 0
	}
	return service.PRDProof{ConnectorToken: r.Header.Get("X-Acceptances-Connector-Token"), ClaimToken: r.Header.Get("X-Acceptances-Claim-Token"), Attempt: attempt}
}

func (h *PRD) result(w http.ResponseWriter, r *http.Request) {
	if !connectorBearer(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, prd.MaxUploadBytes)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		WriteError(w, 400, "INVALID_PRD_RESULT")
		return
	}
	defer func() {
		if err := r.MultipartForm.RemoveAll(); err != nil {
			slog.WarnContext(r.Context(), "remove PRD upload staging files", "error", err)
		}
	}()
	values := r.MultipartForm.Value
	if len(values) != 1 || len(values["manifest"]) != 1 || len(values["manifest"][0]) > prd.MaxManifestBytes || len(r.MultipartForm.File) != 1 {
		WriteError(w, 400, "INVALID_PRD_RESULT")
		return
	}
	var manifest prd.Manifest
	decoder := json.NewDecoder(bytes.NewBufferString(values["manifest"][0]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil || decoder.Decode(new(any)) != io.EOF {
		WriteError(w, 400, "INVALID_PRD_RESULT")
		return
	}
	files := make(map[string][]byte)
	for _, file := range r.MultipartForm.File["file"] {
		_, params, headerErr := mime.ParseMediaType(file.Header.Get("Content-Disposition"))
		if headerErr != nil || params["filename"] != file.Filename {
			WriteError(w, 400, "INVALID_PRD_RESULT")
			return
		}
		if _, duplicate := files[file.Filename]; duplicate || len(files) >= prd.MaxResources+2 {
			WriteError(w, 400, "INVALID_PRD_RESULT")
			return
		}
		opened, err := file.Open()
		if err != nil {
			WriteError(w, 400, "INVALID_PRD_RESULT")
			return
		}
		data, readErr := io.ReadAll(io.LimitReader(opened, prd.MaxResourceBytes+1))
		closeErr := opened.Close()
		if errors.Join(readErr, closeErr) != nil || len(data) > prd.MaxResourceBytes {
			WriteError(w, 400, "INVALID_PRD_RESULT")
			return
		}
		files[file.Filename] = data
	}
	bundle, err := prd.ValidateBundle(manifest, files)
	if err != nil {
		WriteError(w, 400, "INVALID_PRD_RESULT")
		return
	}
	task, err := h.service.Result(r.Context(), r.PathValue("id"), prdProof(r), bundle)
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 200, task)
}

func (h *PRD) failure(w http.ResponseWriter, r *http.Request) {
	if !connectorBearer(w, r) {
		return
	}
	var in struct {
		ErrorCode string `json:"errorCode"`
		Phase     string `json:"phase"`
		Retryable bool   `json:"retryable"`
	}
	if err := DecodeJSON(w, r, &in); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	if err := h.service.Failure(r.Context(), r.PathValue("id"), prdProof(r), in.ErrorCode, in.Phase, in.Retryable); err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 204, nil)
}

func (h *PRD) confirm(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ExpectedCurrentSnapshotID string `json:"expectedCurrentSnapshotId"`
		AcceptPartial             bool   `json:"acceptPartial"`
	}
	if err := DecodeJSON(w, r, &in); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	snapshot, created, err := h.service.Confirm(r.Context(), r.PathValue("id"), in.ExpectedCurrentSnapshotID, in.AcceptPartial)
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	status := 200
	if created {
		status = 201
	}
	WriteJSON(w, status, snapshot)
}

func (h *PRD) importFile(w http.ResponseWriter, r *http.Request) {
	id, file, err := h.service.ImportFile(r.Context(), r.PathValue("id"), r.PathValue("filename"))
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	h.serveFile(w, r, id, file)
}

func (h *PRD) snapshotFile(w http.ResponseWriter, r *http.Request) {
	id, file, err := h.service.SnapshotFile(r.Context(), r.PathValue("id"), r.PathValue("filename"))
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	h.serveFile(w, r, id, file)
}
