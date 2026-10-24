package api_test

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func jpegBundleFixture(t *testing.T) deliveryFixture {
	t.Helper()
	f := newDeliveryFixture(t, "p1", "c1")
	var data bytes.Buffer
	if err := jpeg.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil); err != nil {
		t.Fatal(err)
	}
	delete(f.Files, "screen.png")
	f.Files["screen.jpg"] = data.String()
	for i := range f.Report.Evidence {
		if f.Report.Evidence[i].Path == "screen.png" {
			f.Report.Evidence[i].Path = "screen.jpg"
		}
	}
	f.Report.Checks[0].Evidence = []string{"screen.jpg"}
	f.Materials.Features[0].Screenshots[0].Path = "screen.jpg"
	return f
}

func writeBundleFixture(t *testing.T, f deliveryFixture) string {
	t.Helper()
	dir := t.TempDir()
	f.Files["report.json"] = fixtureJSON(t, f.Report)
	for name, content := range f.Files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestBundlePreflightMatchesFreezeContractWithoutPublishing(t *testing.T) {
	tests := []struct {
		name   string
		change func(*deliveryFixture)
		want   string
	}{
		{"valid", func(*deliveryFixture) {}, ""},
		{"missing-manifest", func(f *deliveryFixture) { delete(f.Files, "delivery-manifest.json") }, "delivery-manifest.json"},
		{"partial", func(f *deliveryFixture) { f.Report.ScopeType = "partial" }, "scopeType=full"},
		{"hash", func(f *deliveryFixture) { f.Files["requirement.md"] += "changed" }, "SHA-256"},
		{"missing-required-check", func(f *deliveryFixture) {
			f.Map.Features[0].Checks = append(f.Map.Features[0].Checks, api.MapCheck{ID: "missing", Title: "Missing", Expected: "Must run", Required: true})
			f.finalize(t)
		}, "缺少必验项"},
		{"dirty", func(f *deliveryFixture) { f.Report.Versions[0].Dirty = new(true) }, "dirty"},
		{"missing-feature-material", func(f *deliveryFixture) { f.Materials.Features = nil; f.finalize(t) }, "全部功能"},
		{"bad-image-extension", func(f *deliveryFixture) {
			f.Files["screen.jpg"] = newDeliveryFixture(t, "p1", "c1").Files["screen.png"]
		}, "扩展名"},
		{"truncated-jpeg", func(f *deliveryFixture) {
			f.Files["screen.jpg"] = f.Files["screen.jpg"][:len(f.Files["screen.jpg"])-2]
		}, "不完整"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := jpegBundleFixture(t)
			f.finalize(t)
			tt.change(&f)
			dir := writeBundleFixture(t, f)
			before := fixtureJSON(t, f.Report)
			report, err := api.ValidateBundle(dir, "p1", "c1", true)
			if tt.want == "" {
				if err != nil || len(report.Checks) != len(f.Report.Checks) {
					t.Fatalf("%+v: %v", report, err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("want %q, got %v", tt.want, err)
			}
			actual, _ := os.ReadFile(filepath.Join(dir, "report.json"))
			if string(actual) != before {
				t.Fatal("report rewritten")
			}
			if _, err := os.Stat(filepath.Join(dir, ".submission-id")); !os.IsNotExist(err) {
				t.Fatal("preflight created submission")
			}
		})
	}
}

func TestBundleIdentityImagePolicyAndSymlinks(t *testing.T) {
	f := jpegBundleFixture(t)
	f.finalize(t)
	dir := writeBundleFixture(t, f)
	if _, err := api.ValidateBundle(dir, "wrong", "c1", true); err == nil {
		t.Fatal("wrong project accepted")
	}
	if _, err := api.ValidateBundle(dir, "p1", "wrong", true); err == nil {
		t.Fatal("wrong campaign accepted")
	}
	if _, err := api.ValidateBundle(dir, "", "", true); err != nil {
		t.Fatal(err)
	}
	old := newDeliveryFixture(t, "p1", "c1")
	old.finalize(t)
	if _, err := api.ValidateBundle(writeBundleFixture(t, old), "p1", "c1", true); err == nil || !strings.Contains(err.Error(), "JPEG") {
		t.Fatal("PNG accepted", err)
	}
	if err := os.Remove(filepath.Join(dir, "screen.jpg")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(writeBundleFixture(t, f), "screen.jpg"), filepath.Join(dir, "screen.jpg")); err != nil {
		t.Fatal(err)
	}
	if _, err := api.ValidateBundle(dir, "p1", "c1", true); err == nil {
		t.Fatal("symlink accepted")
	}
}
