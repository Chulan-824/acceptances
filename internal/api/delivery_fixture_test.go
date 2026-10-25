package api_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

type deliveryFixture struct {
	Report    api.Report
	Manifest  api.DeliveryManifest
	Map       api.VerificationMap
	Materials api.DocumentationMaterials
	Files     map[string]string
}

func deliveryTestSetup(t *testing.T) (*api.Server, string, string, string) {
	t.Helper()
	dir := t.TempDir()
	app, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close() })
	p := request(t, app, "POST", "/api/v1/projects", `{"name":"Synthetic platform fixture"}`, 201)
	pid := p["id"].(string)
	c := request(t, app, "POST", "/api/v1/projects/"+pid+"/campaigns", `{"title":"Fixture delivery","description":"Synthetic data, not business verification"}`, 201)
	return app, pid, c["id"].(string), dir
}

func fixtureDigest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func fixtureJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func newDeliveryFixture(t *testing.T, pid, cid string) deliveryFixture {
	t.Helper()
	clean := false
	sources := []api.Version{{Repository: "fixture-web", Commit: strings.Repeat("a", 40), Dirty: &clean}}
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 45, G: 65, B: 85, A: 255})
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, img); err != nil {
		t.Fatal(err)
	}
	f := deliveryFixture{Files: map[string]string{"requirement.md": "Synthetic requirement: export a fixture.", "build.txt": "Synthetic build artifact, not production evidence.", "screen.png": pixels.String()}}
	f.Report = api.Report{Title: "Fixture", Description: "Synthetic platform test", VerifiedAt: "2026-10-13T09:00:00Z", Scope: "Complete synthetic fixture", ScopeType: "full", Environment: "Isolated in-process test", Versions: sources,
		Checks:   []api.Check{{ID: "fixture-export--download", Title: "Export fixture", Expected: "A file is available", Actual: "Synthetic result", Status: "passed", Evidence: []string{"screen.png"}}},
		Evidence: []api.Evidence{{Path: "requirement.md", Description: "Requirement"}, {Path: "build.txt", Description: "Build"}, {Path: "screen.png", Description: "Synthetic image"}, {Path: "feature-map.json", Description: "Map"}, {Path: "business-materials.json", Description: "Materials"}, {Path: "delivery-manifest.json", Description: "Manifest"}}}
	f.Map = api.VerificationMap{SchemaVersion: 1, ProjectID: pid, Features: []api.MapFeature{{ID: "fixture-export", Title: "Export", Checks: []api.MapCheck{{ID: "fixture-export--download", Title: "Export fixture", Expected: "A file is available", Required: true}}}}, Excluded: []string{}}
	f.Materials = api.DocumentationMaterials{SchemaVersion: 1, ProjectID: pid, Features: []api.DocumentationFeature{{FeatureID: "fixture-export", Summary: "Export fixture data.", Roles: []string{"Fixture user"}, Prerequisites: []string{"Open fixture"}, Steps: []api.DocumentationStep{{Instruction: "Choose Export", Expected: "A file is available", CheckIDs: []string{"fixture-export--download"}}}, Limitations: []string{}, Screenshots: []api.DocumentationScreenshot{{Path: "screen.png", Caption: "Synthetic export screen", CheckIDs: []string{"fixture-export--download"}}}}}}
	f.Manifest = api.DeliveryManifest{SchemaVersion: 1, ProjectID: pid, CampaignID: cid, Build: api.BuildIdentity{Kind: "artifact", ID: "fixture-build-1", Artifact: api.ArtifactRef{Path: "build.txt"}, Sources: sources}}
	return f
}

func (f *deliveryFixture) finalize(t *testing.T) {
	t.Helper()
	f.Manifest.Requirement = api.ArtifactRef{Path: "requirement.md", SHA256: fixtureDigest(f.Files["requirement.md"])}
	f.Map.RequirementSHA256 = f.Manifest.Requirement.SHA256
	f.Files["feature-map.json"] = fixtureJSON(t, f.Map)
	f.Manifest.Map = api.ArtifactRef{Path: "feature-map.json", SHA256: fixtureDigest(f.Files["feature-map.json"])}
	f.Materials.RequirementSHA256, f.Materials.MapSHA256 = f.Manifest.Requirement.SHA256, f.Manifest.Map.SHA256
	f.Files["business-materials.json"] = fixtureJSON(t, f.Materials)
	f.Manifest.Materials = api.ArtifactRef{Path: "business-materials.json", SHA256: fixtureDigest(f.Files["business-materials.json"])}
	if f.Manifest.Build.Kind == "artifact" {
		f.Manifest.Build.Artifact.SHA256 = fixtureDigest(f.Files[f.Manifest.Build.Artifact.Path])
	}
	f.Files["delivery-manifest.json"] = fixtureJSON(t, f.Manifest)
}

func publishDeliveryFixture(t *testing.T, app *api.Server, cid, submission string, f deliveryFixture) string {
	t.Helper()
	return upload(t, app, cid, submission, fixtureJSON(t, f.Report), f.Files, 201)["id"].(string)
}

func preparedFreeze(t *testing.T, app *api.Server, runID, requestID string) api.FreezeDeliveryInput {
	t.Helper()
	prep := request(t, app, "GET", "/api/v1/runs/"+runID+"/delivery-preparation", "", 200)
	return api.FreezeDeliveryInput{RequestID: requestID, Token: prep["token"].(string), MapConfirmed: true, MaterialsConfirmed: true, SensitiveInfoReviewed: true, ExceptionReasons: map[string]string{}}
}

func freezeFixture(t *testing.T, app *api.Server, runID, requestID string) map[string]any {
	t.Helper()
	input := preparedFreeze(t, app, runID, requestID)
	return request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 201)
}
