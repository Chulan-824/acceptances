package prd

import (
	"encoding/json"

	"github.com/Chulan-824/acceptances/internal/model"
)

const (
	ProtocolVersion   = 1
	NormalizerVersion = "lark-prd-v4-zh-CN"
	MaxBodyBytes      = 8 << 20
	MaxManifestBytes  = 1 << 20
	MaxResourceBytes  = 10 << 20
	MaxUploadBytes    = 128 << 20
	MaxResources      = 100
)

type Connector struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	ProtocolVersion int    `json:"protocolVersion"`
	LarkCliVersion  string `json:"larkCliVersion"`
	LastSeenAt      string `json:"lastSeenAt"`
	Online          bool   `json:"online"`
}

type Registration struct {
	Connector      Connector `json:"connector"`
	ConnectorToken string    `json:"connectorToken"`
}

type Claim struct {
	ImportID       string `json:"importId"`
	CampaignID     string `json:"campaignId"`
	URL            string `json:"url"`
	Attempt        int    `json:"attempt"`
	ClaimToken     string `json:"claimToken"`
	LeaseExpiresAt string `json:"leaseExpiresAt"`
}

type Warning struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	BlockID    string `json:"blockId,omitempty"`
	ResourceID string `json:"resourceId,omitempty"`
}

type Resource struct {
	Reference  string `json:"reference"`
	ResourceID string `json:"resourceId,omitempty"`
	SheetID    string `json:"sheetId,omitempty"`
	RevisionID string `json:"revisionId,omitempty"`
	Kind       string `json:"kind"`
	Name       string `json:"name,omitempty"`
	Filename   string `json:"filename,omitempty"`
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	BlockID    string `json:"blockId,omitempty"`
	FetchedAt  string `json:"fetchedAt,omitempty"`
}

type File struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

type Manifest struct {
	SchemaVersion     int        `json:"schemaVersion"`
	DocumentID        string     `json:"documentId"`
	Realm             string     `json:"realm"`
	RevisionID        string     `json:"revisionId"`
	Title             string     `json:"title"`
	FetchedAt         string     `json:"fetchedAt"`
	NormalizerVersion string     `json:"normalizerVersion"`
	Completeness      string     `json:"completeness"`
	Warnings          []Warning  `json:"warnings"`
	Files             []File     `json:"files"`
	Resources         []Resource `json:"resources"`
}

// SourceDocument is the read-only structure after comments and transient URLs are removed.
type SourceDocument struct {
	DocumentID   string                     `json:"documentId"`
	RevisionID   string                     `json:"revisionId"`
	Content      string                     `json:"content"`
	ReferenceMap map[string]json.RawMessage `json:"referenceMap"`
}

type Import struct {
	ID                  string      `json:"id"`
	CampaignID          string      `json:"campaignId"`
	ConnectorID         string      `json:"connectorId"`
	URL                 string      `json:"url"`
	Status              string      `json:"status"`
	Phase               string      `json:"phase,omitempty"`
	Attempt             int         `json:"attempt"`
	BaseSnapshotID      string      `json:"baseSnapshotId"`
	ConfirmedSnapshotID string      `json:"confirmedSnapshotId,omitempty"`
	CreatedAt           string      `json:"createdAt"`
	UpdatedAt           string      `json:"updatedAt"`
	ExpiresAt           string      `json:"expiresAt"`
	ErrorCode           string      `json:"errorCode,omitempty"`
	Manifest            *Manifest   `json:"manifest,omitempty"`
	CreatedBy           *model.User `json:"createdBy,omitempty"`
}

type Snapshot struct {
	ID           string      `json:"id"`
	CampaignID   string      `json:"campaignId"`
	ImportID     string      `json:"importId"`
	SourceURL    string      `json:"sourceUrl"`
	SourceHash   string      `json:"sourceHash"`
	ResourceHash string      `json:"resourceHash"`
	CreatedAt    string      `json:"createdAt"`
	CreatedBy    *model.User `json:"createdBy,omitempty"`
	Manifest     Manifest    `json:"manifest"`
}

type SnapshotList struct {
	CurrentSnapshotID string     `json:"currentSnapshotId"`
	Items             []Snapshot `json:"items"`
}

type SourceURL struct {
	URL   string
	Realm string
	Kind  string
	Token string
}

type Bundle struct {
	Manifest     Manifest
	Files        map[string][]byte
	SourceHash   string
	ResourceHash string
}
