package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/service"
	"github.com/gin-gonic/gin"
)

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func WriteError(w http.ResponseWriter, status int, code string) {
	WriteJSON(w, status, map[string]string{"code": code, "message": strings.ReplaceAll(strings.ToLower(code), "_", " ")})
}

func campaignError(c *gin.Context, err error) {
	status, code := http.StatusInternalServerError, "READ_FAILED"
	switch {
	case errors.Is(err, service.ErrProjectNotFound):
		status, code = http.StatusNotFound, "PROJECT_NOT_FOUND"
	case errors.Is(err, model.ErrCampaignNotFound):
		status, code = http.StatusNotFound, "CAMPAIGN_NOT_FOUND"
	case errors.Is(err, service.ErrTitleRequired):
		status, code = http.StatusBadRequest, "TITLE_REQUIRED"
	case errors.Is(err, service.ErrDescriptionRequired):
		status, code = http.StatusBadRequest, "DESCRIPTION_REQUIRED"
	case errors.Is(err, service.ErrSaveFailed):
		code = "SAVE_FAILED"
	}
	if status == http.StatusInternalServerError {
		slog.ErrorContext(c.Request.Context(), "campaign request failed", "method", c.Request.Method, "path", c.Request.URL.Path, "error", err)
	}
	WriteError(c.Writer, status, code)
}
