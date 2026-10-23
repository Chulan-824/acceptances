package handler

import (
	"net/http"
	"strings"

	"github.com/Chulan-824/acceptances/internal/service"
	"github.com/gin-gonic/gin"
)

type Campaign struct {
	service *service.Campaign
}

func NewCampaign(service *service.Campaign) *Campaign { return &Campaign{service: service} }

// Register hands only these methods and paths to Gin. ServeMux keeps ownership
// of legacy routes, path cleaning and method fallbacks during the migration.
func (h *Campaign) Register(mux *http.ServeMux) {
	router := gin.New()
	router.RedirectTrailingSlash = false
	router.RedirectFixedPath = false
	router.UseEscapedPath = true
	_ = router.SetTrustedProxies(nil)
	matched := make(map[string]gin.HandlerFunc)
	for _, route := range []struct {
		method, path string
		handle       gin.HandlerFunc
	}{
		{http.MethodGet, "/api/v1/projects/{id}/campaigns", h.list},
		{http.MethodPost, "/api/v1/projects/{id}/campaigns", h.create},
		{http.MethodGet, "/api/v1/campaigns/{id}", h.get},
		{http.MethodPatch, "/api/v1/campaigns/{id}", h.updateDescription},
	} {
		pattern := route.method + " " + route.path
		path := strings.ReplaceAll(route.path, "{id}", ":id")
		router.Handle(route.method, path, route.handle)
		if route.method == http.MethodGet {
			router.HEAD(path, route.handle)
		}
		matched[pattern] = route.handle
		mux.Handle(pattern, router)
	}
	// ServeMux also matches escaped literals such as /%63ampaigns/. Gin keeps
	// escaped segments intact, so honor the outer mux's already-selected route.
	router.NoRoute(func(c *gin.Context) {
		if handle := matched[c.Request.Pattern]; handle != nil {
			handle(c)
		}
	})
}

func (h *Campaign) create(c *gin.Context) {
	var input struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := DecodeJSON(c.Writer, c.Request, &input); err != nil {
		// Preserve the existing PROJECT_NOT_FOUND precedence for malformed input.
		if err := h.service.RequireProject(c.Request.Context(), c.Request.PathValue("id")); err != nil {
			campaignError(c, err)
			return
		}
		WriteError(c.Writer, http.StatusBadRequest, "INVALID_INPUT")
		return
	}
	v, err := h.service.Create(c.Request.Context(), c.Request.PathValue("id"), input.Title, input.Description)
	if err != nil {
		campaignError(c, err)
		return
	}
	WriteJSON(c.Writer, http.StatusCreated, v)
}

func (h *Campaign) list(c *gin.Context) {
	items, err := h.service.List(c.Request.Context(), c.Request.PathValue("id"))
	if err != nil {
		campaignError(c, err)
		return
	}
	WriteJSON(c.Writer, http.StatusOK, map[string]any{"items": items})
}

func (h *Campaign) get(c *gin.Context) {
	v, err := h.service.Get(c.Request.Context(), c.Request.PathValue("id"))
	if err != nil {
		campaignError(c, err)
		return
	}
	WriteJSON(c.Writer, http.StatusOK, v)
}

func (h *Campaign) updateDescription(c *gin.Context) {
	var input struct {
		Description *string `json:"description"`
	}
	if err := DecodeJSON(c.Writer, c.Request, &input); err != nil {
		WriteError(c.Writer, http.StatusBadRequest, "INVALID_INPUT")
		return
	}
	v, err := h.service.UpdateDescription(c.Request.Context(), c.Request.PathValue("id"), input.Description)
	if err != nil {
		campaignError(c, err)
		return
	}
	WriteJSON(c.Writer, http.StatusOK, v)
}
