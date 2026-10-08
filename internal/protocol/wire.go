package protocol

import (
	"bytes"
	"encoding/json"
)

// Document is the validated projection; Raw is always the authoritative stored content.
type Document struct {
	ID        string
	Kind      string
	ProjectID string
	SHA256    string
	Raw       []byte
	Typed     any
	Value     map[string]any
}
type DocumentRef struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256"`
}
type FileRef struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type Asset struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	Kind      string `json:"kind"`
	MediaType string `json:"mediaType"`
}
type Manifest struct {
	SchemaVersion string         `json:"schemaVersion"`
	Kind          string         `json:"kind"`
	ID            string         `json:"id"`
	ProjectID     string         `json:"projectId"`
	RunID         string         `json:"runId"`
	Report        FileRef        `json:"report"`
	Documents     []DocumentRef  `json:"documents"`
	Assets        []Asset        `json:"assets"`
	Extensions    map[string]any `json:"extensions,omitempty"`
}
type RevisionInput struct {
	ID             string `json:"id"`
	ReportBase64   string `json:"reportBase64"`
	ManifestBase64 string `json:"manifestBase64"`
}
type Bundle struct {
	Report               Document
	ManifestRaw          []byte
	Manifest             Manifest
	Documents            map[string]Document
	RequiresServerChecks []string `json:"requiresServerChecks"`
}

func ParseDocument(kind string, raw []byte) (Document, error) {
	value, err := ValidateDocument(kind, raw)
	if err != nil {
		return Document{}, err
	}
	typed, err := decodeDTO(kind, raw)
	if err != nil {
		return Document{}, Failure("SCHEMA_INVALID", "", "wire DTO does not match validated contract")
	}
	return Document{Typed: typed, ID: field(value, "id"), Kind: kind, ProjectID: field(value, "projectId"), SHA256: Digest(raw), Raw: append([]byte(nil), raw...), Value: value}, nil
}
func ParseManifest(raw []byte) (Manifest, error) {
	if _, err := ValidateDocument("manifest", raw); err != nil {
		return Manifest{}, err
	}
	value, err := Decode(raw)
	if err != nil {
		return Manifest{}, err
	}
	canonical, err := Canonical(value)
	if err != nil {
		return Manifest{}, err
	}
	if !bytes.Equal(raw, canonical) {
		return Manifest{}, Failure("SCHEMA_INVALID", "", "manifest must use acceptances-jcs-1 bytes")
	}
	var m Manifest
	err = json.Unmarshal(raw, &m)
	return m, err
}
