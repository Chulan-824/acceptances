package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Chulan-824/acceptances/internal/handler"
	"github.com/Chulan-824/acceptances/internal/model"
	"github.com/Chulan-824/acceptances/internal/service"
)

type failingStore struct {
	err error
}

func (s failingStore) ProjectExists(context.Context, string) (bool, error) { return true, nil }
func (s failingStore) Create(context.Context, model.Campaign) error        { return s.err }
func (s failingStore) List(context.Context, string) ([]model.Campaign, error) {
	return nil, s.err
}
func (s failingStore) Get(context.Context, string) (model.Campaign, error) {
	return model.Campaign{}, s.err
}
func (s failingStore) UpdateDescription(context.Context, string, string) error {
	return s.err
}

func TestCampaignStorageErrorsStayPrivate(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	store := failingStore{err: errors.New("private database details")}
	handler.NewCampaign(service.NewCampaign(store, &sync.Mutex{})).Register(mux)
	for _, tc := range []struct {
		name, method, path, body, want string
	}{
		{"create", "POST", "/api/v1/projects/p/campaigns", `{"title":"Title"}`, "SAVE_FAILED"},
		{"list", "GET", "/api/v1/projects/p/campaigns", "", "READ_FAILED"},
		{"get", "GET", "/api/v1/campaigns/c", "", "READ_FAILED"},
		{"update", "PATCH", "/api/v1/campaigns/c", `{"description":"x"}`, "SAVE_FAILED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
			want := `{"code":"` + tc.want + `","message":"` + strings.ReplaceAll(strings.ToLower(tc.want), "_", " ") + "\"}\n"
			if w.Code != 500 || w.Body.String() != want || w.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("response = %d %s", w.Code, w.Body.String())
			}
		})
	}
}
