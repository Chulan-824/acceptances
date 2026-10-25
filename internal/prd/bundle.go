package prd

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

func ValidateBundle(manifest Manifest, files map[string][]byte) (Bundle, error) {
	if manifest.SchemaVersion != ProtocolVersion || manifest.NormalizerVersion != NormalizerVersion ||
		!documentToken.MatchString(manifest.DocumentID) || manifest.Realm != "feishu" && manifest.Realm != "lark" ||
		!validRevision(manifest.RevisionID) || strings.TrimSpace(manifest.Title) == "" || len(manifest.Title) > 4096 ||
		manifest.Completeness != "complete" && manifest.Completeness != "partial" {
		return Bundle{}, errors.New("invalid PRD manifest")
	}
	if _, err := time.Parse(time.RFC3339Nano, manifest.FetchedAt); err != nil {
		return Bundle{}, errors.New("invalid PRD read time")
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil || len(rawManifest) > MaxManifestBytes || len(manifest.Files) < 2 || len(manifest.Files) > MaxResources+2 || len(manifest.Resources) > MaxResources || len(manifest.Files) != len(files) {
		return Bundle{}, errors.New("PRD bundle exceeds its limits")
	}
	total, names := len(rawManifest), make(map[string]bool)
	for _, file := range manifest.Files {
		data, exists := files[file.Name]
		if !exists || !validFilename(file.Name) || names[file.Name] || int64(len(data)) != file.Size || file.SHA256 != sum(data) {
			return Bundle{}, errors.New("PRD files do not match the manifest")
		}
		names[file.Name] = true
		total += len(data)
		if total > MaxUploadBytes {
			return Bundle{}, errors.New("PRD upload exceeds its limit")
		}
		switch file.Role {
		case "source":
			if file.Name != "source.json" || file.ContentType != "application/json" || len(data) > MaxBodyBytes {
				return Bundle{}, errors.New("invalid PRD source file")
			}
		case "markdown":
			if file.Name != "document.md" || file.ContentType != "text/markdown" || len(data) > MaxBodyBytes || !utf8.Valid(data) {
				return Bundle{}, errors.New("invalid PRD reading view")
			}
		case "image", "whiteboard":
			if len(data) == 0 || len(data) > MaxResourceBytes || !slices.Contains([]string{"image/png", "image/jpeg", "image/gif", "image/webp"}, file.ContentType) || http.DetectContentType(data) != file.ContentType {
				return Bundle{}, errors.New("invalid PRD image")
			}
			extension := strings.ToLower(file.Name[strings.LastIndex(file.Name, ".")+1:])
			if !slices.Contains(map[string][]string{"image/png": {"png"}, "image/jpeg": {"jpg", "jpeg"}, "image/gif": {"gif"}, "image/webp": {"webp"}}[file.ContentType], extension) {
				return Bundle{}, errors.New("PRD image extension does not match its bytes")
			}
		default:
			return Bundle{}, errors.New("unsupported PRD file role")
		}
	}
	if !names["source.json"] || !names["document.md"] {
		return Bundle{}, errors.New("PRD structure and reading view are required")
	}
	var source SourceDocument
	decoder := json.NewDecoder(bytes.NewReader(files["source.json"]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&source); err != nil || source.DocumentID != manifest.DocumentID || source.RevisionID != manifest.RevisionID {
		return Bundle{}, errors.New("PRD source version does not match")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return Bundle{}, errors.New("invalid PRD source JSON")
	}
	doc, err := SanitizeDocument(source)
	if err != nil || doc.Excluded {
		return Bundle{}, errors.New("PRD source contains excluded or invalid data")
	}
	if len(doc.Resources) != len(manifest.Resources) {
		return Bundle{}, errors.New("PRD resource declarations are incomplete")
	}
	for _, expected := range doc.Warnings {
		if !slices.ContainsFunc(manifest.Warnings, func(w Warning) bool { return w.Code == expected.Code && w.BlockID == expected.BlockID }) {
			return Bundle{}, errors.New("PRD structure warning is missing")
		}
	}
	partial, references, usedFiles := len(manifest.Warnings) > 0, make(map[string]bool), make(map[string]bool)
	for _, resource := range manifest.Resources {
		expectedIndex := slices.IndexFunc(doc.Resources, func(r Resource) bool { return r.Reference == resource.Reference })
		if expectedIndex < 0 || references[resource.Reference] {
			return Bundle{}, errors.New("unknown or duplicate PRD resource")
		}
		references[resource.Reference] = true
		expected := doc.Resources[expectedIndex]
		if expected.ResourceID != resource.ResourceID || expected.Kind != resource.Kind || expected.BlockID != resource.BlockID {
			return Bundle{}, errors.New("PRD resource does not match its source")
		}
		switch resource.Status {
		case "saved":
			index := slices.IndexFunc(manifest.Files, func(f File) bool { return f.Name == resource.Filename })
			if expected.Status == "unsupported" || expected.ResourceID == "" || index < 0 || manifest.Files[index].Role != resource.Kind {
				return Bundle{}, errors.New("invalid saved PRD resource")
			}
			usedFiles[resource.Filename] = true
		case "missing", "unsupported":
			partial = true
			if resource.Filename != "" || resource.Reason == "" || expected.Status == "unsupported" && resource.Status != "unsupported" {
				return Bundle{}, errors.New("invalid missing PRD resource")
			}
		default:
			return Bundle{}, errors.New("invalid PRD resource status")
		}
	}
	for _, file := range manifest.Files {
		if (file.Role == "image" || file.Role == "whiteboard") && !usedFiles[file.Name] {
			return Bundle{}, errors.New("unreferenced PRD resource file")
		}
	}
	if partial != (manifest.Completeness == "partial") {
		return Bundle{}, errors.New("PRD completeness does not match its content")
	}
	if manifest.Warnings == nil {
		manifest.Warnings = []Warning{}
	}
	if manifest.Resources == nil {
		manifest.Resources = []Resource{}
	}
	stableSource, err := stableDocument(doc.Source)
	if err != nil {
		return Bundle{}, err
	}
	// Names and reference aliases are transport details. Only resource identity,
	// availability and the bytes actually retained participate in deduplication.
	resources := make([]string, 0, len(manifest.Resources))
	for _, resource := range manifest.Resources {
		value := resource
		value.Reference, value.Filename = "", ""
		var fileHash string
		for _, file := range manifest.Files {
			if file.Name == resource.Filename {
				fileHash = file.SHA256
			}
		}
		raw, _ := json.Marshal(struct {
			Resource Resource
			SHA256   string
		}{value, fileHash})
		resources = append(resources, string(raw))
	}
	slices.Sort(resources)
	resourceJSON, _ := json.Marshal(resources)
	return Bundle{Manifest: manifest, Files: files, SourceHash: sum(stableSource), ResourceHash: sum(resourceJSON)}, nil
}

func DescribeFile(name, role, contentType string, data []byte) File {
	return File{Name: name, Role: role, ContentType: contentType, Size: int64(len(data)), SHA256: sum(data)}
}

func validFilename(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 200 && !strings.ContainsAny(name, "/\\\x00\r\n") && !strings.ContainsAny(name, ":")
}

func validRevision(revision string) bool {
	if revision == "" || len(revision) > 40 {
		return false
	}
	for _, r := range revision {
		if r < '0' || r > '9' {
			return false
		}
	}
	return strings.TrimLeft(revision, "0") != ""
}

func sum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func stableDocument(source SourceDocument) ([]byte, error) {
	source.RevisionID = ""
	replacements := make(map[string]string)
	stableMap := make(map[string]json.RawMessage)
	for group, raw := range source.ReferenceMap {
		var references map[string]json.RawMessage
		if json.Unmarshal(raw, &references) != nil {
			return nil, fmt.Errorf("invalid PRD reference group")
		}
		values := make(map[string]json.RawMessage)
		for reference, attributes := range references {
			var value any
			if json.Unmarshal(attributes, &value) != nil {
				return nil, errors.New("invalid PRD reference")
			}
			canonical, _ := json.Marshal(value)
			stableRef := "ref-" + sum(canonical)
			replacements[reference] = stableRef
			values[stableRef] = canonical
		}
		stableMap[group], _ = json.Marshal(values)
	}
	for reference, stable := range replacements {
		source.Content = strings.ReplaceAll(source.Content, "ref=\""+reference+"\"", "ref=\""+stable+"\"")
	}
	source.ReferenceMap = stableMap
	return json.Marshal(source)
}
