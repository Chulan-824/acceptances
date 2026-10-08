package protocol

import (
	"fmt"
	"io"
	"os"
	"strings"
)

// LoadBundle keeps caller-chosen identities stable and does not generate IDs during upload retries.
func LoadBundle(dir string) (*Bundle, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, Failure("INVALID_ARGUMENT", "", "cannot open bundle directory")
	}
	defer root.Close()
	raw, err := readBounded(root, "report.json", DocumentLimit)
	if err != nil {
		return nil, err
	}
	report, err := ParseDocument("report", raw)
	if err != nil {
		return nil, err
	}
	manifestRaw, err := readBounded(root, "manifest.json", ManifestLimit)
	if err != nil {
		return nil, err
	}
	m, err := ParseManifest(manifestRaw)
	if err != nil {
		return nil, err
	}
	if m.ID != report.ID || m.ProjectID != report.ProjectID || m.RunID != field(report.Value, "runId") {
		return nil, Failure("REFERENCE_INVALID", "/manifest", "manifest/report identity mismatch")
	}
	if m.Report.Size != int64(len(raw)) || m.Report.SHA256 != report.SHA256 {
		return nil, Failure("DIGEST_MISMATCH", "/manifest/report", "raw report digest or size mismatch")
	}
	out := &Bundle{Report: report, ManifestRaw: manifestRaw, Manifest: m, Documents: map[string]Document{}, RequiresServerChecks: []string{"authorization", "remoteReferences", "campaignBasis", "coverage", "observedBuildIdentity"}}
	for _, ref := range m.Documents {
		raw, err := readBounded(root, "documents/"+ref.ID+".json", DocumentLimit)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		doc, err := ParseDocument(ref.Kind, raw)
		if err != nil {
			return nil, err
		}
		if doc.ID != ref.ID || doc.ProjectID != report.ProjectID || doc.SHA256 != ref.SHA256 {
			return nil, Failure("REFERENCE_INVALID", "/documents", "document identity or raw digest mismatch")
		}
		out.Documents[ref.ID] = doc
	}
	assetIDs := map[string]bool{}
	for i, a := range m.Assets {
		file, err := root.Open(a.Path)
		if err != nil {
			return nil, Failure("ASSET_INCOMPLETE", fmt.Sprintf("/assets/%d", i), "declared asset is missing or inaccessible")
		}
		size, hash, err := HashFile(file, a.Size)
		file.Close()
		if err != nil || size != a.Size || hash != a.SHA256 {
			return nil, Failure("DIGEST_MISMATCH", fmt.Sprintf("/assets/%d", i), "asset size or digest mismatch")
		}
		assetIDs[a.ID] = true
	}
	if err := ValidateBundleReferences(out, assetIDs); err != nil {
		return nil, err
	}
	return out, nil
}
func ValidateBundleReferences(b *Bundle, assets map[string]bool) error {
	if b.Manifest.Report.Path != "report.json" {
		return Failure("PATH_INVALID", "/report/path", "report path must be report.json")
	}
	kinds := map[string]string{}
	for _, asset := range b.Manifest.Assets {
		kinds[asset.ID] = asset.Kind
	}
	for _, key := range []string{"planRef", "targetRef"} {
		ref := object(b.Report.Value[key])
		found := false
		for _, doc := range b.Manifest.Documents {
			if doc.ID == field(ref, "id") && doc.Kind == strings.TrimSuffix(key, "Ref") && doc.SHA256 == field(ref, "sha256") {
				found = true
			}
		}
		if !found {
			return Failure("REFERENCE_INVALID", "/"+key, "manifest must declare the report document reference")
		}
	}

	for _, v := range array(b.Report.Value["results"]) {
		for _, a := range array(object(v)["attempts"]) {
			for _, o := range array(object(a)["observations"]) {
				for _, e := range array(object(o)["evidence"]) {
					selector := object(object(e)["selector"])
					kind := kinds[field(object(e), "assetId")]
					if selector["startMs"] != nil {
						if kind != "audio" && kind != "video" {
							return Failure("REFERENCE_INVALID", "/results", "time selector requires audio/video evidence")
						}
						if number(selector["startMs"]) > number(selector["endMs"]) {
							return Failure("REFERENCE_INVALID", "/results", "invalid time selector interval")
						}
					}
					if selector["lineStart"] != nil {
						if kind != "text" && kind != "json" {
							return Failure("REFERENCE_INVALID", "/results", "line selector requires text/JSON evidence")
						}
						if number(selector["lineStart"]) > number(selector["lineEnd"]) {
							return Failure("REFERENCE_INVALID", "/results", "invalid line selector interval")
						}
					}
					if !assets[field(object(e), "assetId")] {
						return Failure("REFERENCE_INVALID", "/results", "evidence references undeclared asset")
					}
				}
			}
		}
	}
	for _, v := range array(object(b.Report.Value["observedBuild"])["observations"]) {
		for _, a := range array(object(v)["assetIds"]) {
			id, _ := a.(string)
			if !assets[id] {
				return Failure("REFERENCE_INVALID", "/observedBuild", "build observation references undeclared asset")
			}
		}
	}
	for _, key := range []string{"planRef", "targetRef"} {
		r := object(b.Report.Value[key])
		id := field(r, "id")
		if doc, ok := b.Documents[id]; ok {
			if doc.SHA256 != field(r, "sha256") || doc.Kind != strings.TrimSuffix(key, "Ref") {
				return Failure("REFERENCE_INVALID", "/"+key, "document reference mismatch")
			}
		}
	}
	if plan, ok := b.Documents[field(object(b.Report.Value["planRef"]), "id")]; ok {
		if field(plan.Value, "campaignId") != field(b.Report.Value, "campaignId") {
			return Failure("REFERENCE_INVALID", "/campaignId", "plan belongs to another campaign")
		}
		items := map[string]map[string]any{}
		for _, v := range array(plan.Value["items"]) {
			items[field(object(v), "id")] = object(v)
		}
		for _, v := range array(b.Report.Value["results"]) {
			r := object(v)
			item := items[field(r, "planItemId")]
			if item == nil {
				return Failure("REFERENCE_INVALID", "/results", "result not in declared plan")
			}
			for _, key := range []string{"caseRef", "executionRef"} {
				a, c := object(r[key]), object(item[key])
				if field(a, "id") != field(c, "id") || field(a, "versionId") != field(c, "versionId") {
					return Failure("REFERENCE_INVALID", "/results/"+key, "result version differs from plan")
				}
			}
		}
	}
	return nil
}
func readBounded(root *os.Root, path string, limit int64) ([]byte, error) {
	f, err := root.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, Failure("PATH_INVALID", "/path", "bundle input must be a regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, Failure("LIMIT_EXCEEDED", "/path", "bundle input too large")
	}
	return raw, nil
}
