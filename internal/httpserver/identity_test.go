package httpserver

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/Chulan-824/acceptances/internal/buildinfo"
)

func TestCapabilitiesBuildIdentity(t *testing.T) {
	response := httptest.NewRecorder()
	New(nil, nil).ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/capabilities", nil))
	var body struct {
		Commit string         `json:"commit"`
		Build  buildinfo.Info `json:"build"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := buildinfo.Current()
	if response.Code != 200 || body.Commit != want.Commit || body.Build.Commit != want.Commit || body.Build.SourceDigest != want.SourceDigest || body.Build.Version != want.Version {
		t.Fatalf("capabilities = %s", response.Body.String())
	}
}
