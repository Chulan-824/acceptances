package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/Chulan-824/acceptances/internal/prd"
	"github.com/Chulan-824/acceptances/internal/service"
)

type PRD struct {
	service   *service.PRD
	serveFile func(http.ResponseWriter, *http.Request, string, prd.File)
}

func NewPRD(service *service.PRD, serveFile func(http.ResponseWriter, *http.Request, string, prd.File)) *PRD {
	return &PRD{service: service, serveFile: serveFile}
}

func (h *PRD) Register(m *http.ServeMux) {
	m.HandleFunc("POST /api/v1/lark-connectors", h.register)
	m.HandleFunc("GET /api/v1/lark-connectors", h.list)
	m.HandleFunc("DELETE /api/v1/lark-connectors/{id}", h.disconnect)
	m.HandleFunc("POST /api/v1/lark-connectors/{id}/poll", h.poll)
	m.HandleFunc("POST /api/v1/campaigns/{id}/prd-imports", h.createImport)
	m.HandleFunc("GET /api/v1/prd-imports/{id}", h.getImport)
	m.HandleFunc("POST /api/v1/prd-imports/{id}/cancel", h.cancelImport)
	m.HandleFunc("GET /api/v1/campaigns/{id}/prd-snapshots", h.snapshots)
	m.HandleFunc("GET /api/v1/prd-snapshots/{id}", h.snapshot)
	m.HandleFunc("POST /api/v1/prd-imports/{id}/result", h.result)
	m.HandleFunc("POST /api/v1/prd-imports/{id}/failure", h.failure)
	m.HandleFunc("POST /api/v1/prd-imports/{id}/confirm", h.confirm)
	m.HandleFunc("GET /api/v1/prd-imports/{id}/files/{filename}", h.importFile)
	m.HandleFunc("GET /api/v1/prd-snapshots/{id}/files/{filename}", h.snapshotFile)
}

func prdFailure(w http.ResponseWriter, r *http.Request, err error) {
	if typed, ok := errors.AsType[*service.PRDError](err); ok {
		status := http.StatusConflict
		switch typed.Code {
		case "CONNECTOR_NOT_FOUND", "PRD_IMPORT_NOT_FOUND", "PRD_SNAPSHOT_NOT_FOUND", "CAMPAIGN_NOT_FOUND", "PRD_FILE_NOT_FOUND":
			status = http.StatusNotFound
		case "CONNECTOR_PROTOCOL_UNSUPPORTED", "INVALID_INPUT", "INVALID_PRD_URL", "INVALID_PRD_RESULT":
			status = http.StatusBadRequest
		case "CONNECTOR_AUTH_REQUIRED", "PRD_CLAIM_INVALID":
			status = http.StatusForbidden
		}
		WriteError(w, status, typed.Code)
		return
	}
	slog.ErrorContext(r.Context(), "PRD operation failed", "method", r.Method, "path", r.URL.Path, "error", err)
	WriteError(w, 500, "SAVE_FAILED")
}

func connectorBearer(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		WriteError(w, 403, "CONNECTOR_AUTH_REQUIRED")
		return false
	}
	return true
}

func (h *PRD) register(w http.ResponseWriter, r *http.Request) {
	if !connectorBearer(w, r) {
		return
	}
	var input struct {
		Name            string `json:"name"`
		ProtocolVersion int    `json:"protocolVersion"`
		LarkCliVersion  string `json:"larkCliVersion"`
	}
	if err := DecodeJSON(w, r, &input); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	v, err := h.service.RegisterConnector(r.Context(), input.Name, input.ProtocolVersion, input.LarkCliVersion)
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 201, v)
}

func (h *PRD) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Connectors(r.Context())
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 200, map[string]any{"items": items})
}

func (h *PRD) disconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Disconnect(r.Context(), r.PathValue("id")); err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 204, nil)
}

func (h *PRD) createImport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL             string `json:"url"`
		ConnectorID     string `json:"connectorId"`
		ClientRequestID string `json:"clientRequestId"`
	}
	if err := DecodeJSON(w, r, &in); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	v, err := h.service.CreateImport(r.Context(), r.PathValue("id"), in.URL, in.ConnectorID, in.ClientRequestID)
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 202, v)
}

func (h *PRD) getImport(w http.ResponseWriter, r *http.Request) {
	v, err := h.service.GetImport(r.Context(), r.PathValue("id"))
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 200, v)
}

func (h *PRD) cancelImport(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if err := DecodeJSON(w, r, &in); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	if err := h.service.CancelImport(r.Context(), r.PathValue("id")); err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 204, nil)
}

func (h *PRD) poll(w http.ResponseWriter, r *http.Request) {
	if !connectorBearer(w, r) {
		return
	}
	var in struct {
		ImportID   string `json:"importId"`
		Attempt    int    `json:"attempt"`
		ClaimToken string `json:"claimToken"`
	}
	if err := DecodeJSON(w, r, &in); err != nil {
		WriteError(w, 400, "INVALID_INPUT")
		return
	}
	v, err := h.service.Poll(r.Context(), r.PathValue("id"), r.Header.Get("X-Acceptances-Connector-Token"), in.ImportID, in.Attempt, in.ClaimToken)
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	if v == nil {
		WriteJSON(w, 204, nil)
		return
	}
	WriteJSON(w, 200, v)
}

func (h *PRD) snapshots(w http.ResponseWriter, r *http.Request) {
	v, err := h.service.Snapshots(r.Context(), r.PathValue("id"))
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 200, v)
}

func (h *PRD) snapshot(w http.ResponseWriter, r *http.Request) {
	v, err := h.service.Snapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		prdFailure(w, r, err)
		return
	}
	WriteJSON(w, 200, v)
}
