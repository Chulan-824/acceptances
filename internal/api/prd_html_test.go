package api_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func TestPRDHTMLArchiveHasIsolatedStaticPreviewAndPreservesOriginal(t *testing.T) {
	f := newPRDFixture(t)
	task, claim := prdStart(t, f, "html-attachment")
	m, files := prdTestBundle(t, "7", "Prototype attachment")
	original := []byte(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://external.invalid"><style>.card{color:red}</style></head><body><div class="card">Prototype content</div><script>parent.compromised=true;fetch('https://external.invalid')</script><img src="https://external.invalid/image" onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(1)">Open</a><iframe src="https://external.invalid"></iframe><svg onload="alert(1)"></svg><form action="https://external.invalid"><button formaction="https://external.invalid">Submit</button></form></body></html>`)
	source := prd.SourceDocument{DocumentID: m.DocumentID, RevisionID: m.RevisionID, Content: `<title>PRD fixture</title><source token="HTMLToken123" name="prototype.html" mime="text/html"/>`}
	files["source.json"], _ = json.Marshal(source)
	m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
	files["resource-001.html"] = original
	m.Files = append(m.Files, prd.DescribeFile("resource-001.html", "html", "text/html", original))
	m.Resources = []prd.Resource{{Reference: "resource-1", ResourceID: "HTMLToken123", Kind: "html", Name: "prototype.html", Filename: "resource-001.html", Status: "saved", FetchedAt: time.Now().UTC().Format(time.RFC3339Nano)}}
	prdUpload(t, f, task, claim, m, files, 200)
	private := "/api/v1/prd-imports/" + task.ID + "/files/resource-001.html"
	prdJSON(t, f.app, f.bob, "GET", private+"?preview=1", nil, nil, 404, nil)
	preview := prdJSON(t, f.app, f.alice, "GET", private+"?preview=1", nil, nil, 200, nil)
	if !strings.Contains(preview.Header().Get("Content-Type"), "text/html") || !strings.Contains(preview.Header().Get("Content-Security-Policy"), "sandbox;") || !strings.Contains(preview.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatal("HTML preview is missing response isolation")
	}
	for _, forbidden := range []string{"<script", "<iframe", "<svg", "<form", "http-equiv=\"refresh\"", "javascript:", "onclick", "onerror", "formaction", "https://external.invalid"} {
		if strings.Contains(preview.Body.String(), forbidden) {
			t.Fatalf("active HTML was exposed in the preview: %s", forbidden)
		}
	}
	if !strings.Contains(preview.Body.String(), "Prototype content") || !strings.Contains(preview.Body.String(), ".card{color:red}") {
		t.Fatal("safe static content was discarded")
	}
	snapshot := prdConfirm(t, f, task, "", false, 201)
	shared := "/api/v1/prd-snapshots/" + snapshot.ID + "/files/resource-001.html"
	raw := prdJSON(t, f.app, f.bob, "GET", shared, nil, nil, 200, nil)
	if raw.Body.String() != string(original) || !strings.HasPrefix(raw.Header().Get("Content-Disposition"), "attachment") || raw.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatal("original HTML was changed or served as executable content")
	}
	sharedPreview := prdJSON(t, f.app, f.bob, "GET", shared+"?preview=1", nil, nil, 200, nil)
	if sharedPreview.Body.String() != preview.Body.String() {
		t.Fatal("confirmed preview changed the archived attachment")
	}
}
