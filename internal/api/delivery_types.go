package api

// Delivery materials are ordinary immutable Run attachments. They deliberately
// do not extend Report or silently reinterpret arbitrary evidence JSON.
const deliveryManifestName = "delivery-manifest.json"
const documentTemplateVersion = "business-html-v2-geist"
const testReportTemplateVersion = "test-report-html-v1"
const guideTemplateVersion = "business-guide-html-v1"

type DocumentKind string

const (
	TestReportDocument    DocumentKind = "test_report"
	BusinessGuideDocument DocumentKind = "business_guide"
)

func (kind DocumentKind) templateVersion() string {
	if kind == BusinessGuideDocument {
		return guideTemplateVersion
	}
	return testReportTemplateVersion
}

func supportedDocumentTemplate(kind DocumentKind, version string) bool {
	return version == kind.templateVersion() || kind == TestReportDocument && version == documentTemplateVersion
}

type ArtifactRef struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type BuildIdentity struct {
	Kind     string      `json:"kind"`
	ID       string      `json:"id"`
	Artifact ArtifactRef `json:"artifact"`
	Sources  []Version   `json:"sources"`
	Reason   string      `json:"reason"`
}
type DeliveryManifest struct {
	SchemaVersion int           `json:"schemaVersion"`
	ProjectID     string        `json:"projectId"`
	CampaignID    string        `json:"campaignId"`
	Requirement   ArtifactRef   `json:"requirement"`
	Map           ArtifactRef   `json:"map"`
	Materials     ArtifactRef   `json:"materials"`
	Build         BuildIdentity `json:"build"`
}
type MapCheck struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Expected string `json:"expected"`
	Required bool   `json:"required"`
}
type MapFeature struct {
	ID     string     `json:"id"`
	Title  string     `json:"title"`
	Checks []MapCheck `json:"checks"`
}
type VerificationMap struct {
	SchemaVersion     int          `json:"schemaVersion"`
	ProjectID         string       `json:"projectId"`
	RequirementSHA256 string       `json:"requirementSha256"`
	Features          []MapFeature `json:"features"`
	Excluded          []string     `json:"excluded"`
}
type DocumentationStep struct {
	Instruction string   `json:"instruction"`
	Expected    string   `json:"expected"`
	CheckIDs    []string `json:"checkIds"`
}
type DocumentationScreenshot struct {
	Path     string   `json:"path"`
	Caption  string   `json:"caption"`
	CheckIDs []string `json:"checkIds"`
}
type DocumentationFeature struct {
	FeatureID                string                    `json:"featureId"`
	Summary                  string                    `json:"summary"`
	Roles                    []string                  `json:"roles"`
	Prerequisites            []string                  `json:"prerequisites"`
	Steps                    []DocumentationStep       `json:"steps"`
	Limitations              []string                  `json:"limitations"`
	Screenshots              []DocumentationScreenshot `json:"screenshots"`
	ScreenshotOmissionReason string                    `json:"screenshotOmissionReason"`
}
type DocumentationMaterials struct {
	SchemaVersion     int                    `json:"schemaVersion"`
	ProjectID         string                 `json:"projectId"`
	RequirementSHA256 string                 `json:"requirementSha256"`
	MapSHA256         string                 `json:"mapSha256"`
	Features          []DocumentationFeature `json:"features"`
}
type ArchivedFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type DeliveryIssue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type DeliveryPreparation struct {
	Eligible         bool                    `json:"eligible"`
	Token            string                  `json:"token"`
	Issues           []DeliveryIssue         `json:"issues"`
	Project          Project                 `json:"project"`
	Campaign         Campaign                `json:"campaign"`
	Run              Run                     `json:"run"`
	Manifest         *DeliveryManifest       `json:"manifest"`
	Map              *VerificationMap        `json:"map"`
	Materials        *DocumentationMaterials `json:"materials"`
	Files            []ArchivedFile          `json:"files"`
	ExceptionReasons map[string]string       `json:"exceptionReasons"`
}
type FreezeDeliveryInput struct {
	RequestID             string            `json:"requestId"`
	Token                 string            `json:"token"`
	MapConfirmed          bool              `json:"mapConfirmed"`
	MaterialsConfirmed    bool              `json:"materialsConfirmed"`
	SensitiveInfoReviewed bool              `json:"sensitiveInfoReviewed"`
	ExceptionReasons      map[string]string `json:"exceptionReasons"`
}
type DeliveryPayload struct {
	SchemaVersion         int                    `json:"schemaVersion"`
	Project               Project                `json:"project"`
	Campaign              Campaign               `json:"campaign"`
	Run                   Run                    `json:"run"`
	Manifest              DeliveryManifest       `json:"manifest"`
	Map                   VerificationMap        `json:"map"`
	Materials             DocumentationMaterials `json:"materials"`
	Files                 []ArchivedFile         `json:"files"`
	ExceptionReasons      map[string]string      `json:"exceptionReasons"`
	MapConfirmed          bool                   `json:"mapConfirmed"`
	MaterialsConfirmed    bool                   `json:"materialsConfirmed"`
	SensitiveInfoReviewed bool                   `json:"sensitiveInfoReviewed"`
}
type DeliveryEvent struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Reason    string `json:"reason"`
	Reference string `json:"reference"`
	CreatedAt string `json:"createdAt"`
}
type DeliverySnapshot struct {
	ID                 string          `json:"id"`
	Version            int             `json:"version"`
	RequestID          string          `json:"requestId"`
	Status             string          `json:"status"`
	CreatedAt          string          `json:"createdAt"`
	SHA256             string          `json:"sha256"`
	Payload            DeliveryPayload `json:"payload"`
	Events             []DeliveryEvent `json:"events"`
	SuccessorID        string          `json:"successorId"`
	SourceRunAvailable bool            `json:"sourceRunAvailable"`
}
type DeliverySummary struct {
	ID            string `json:"id"`
	Version       int    `json:"version"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	ProjectID     string `json:"projectId"`
	ProjectName   string `json:"projectName"`
	CampaignID    string `json:"campaignId"`
	CampaignTitle string `json:"campaignTitle"`
	RunID         string `json:"runId"`
	SuccessorID   string `json:"successorId"`
}
type BusinessDocument struct {
	Kind DocumentKind `json:"kind"`
	// Guide is the immutable authoring input. It is omitted from list responses.
	Guide           *BusinessGuide `json:"-"`
	ID              string         `json:"id"`
	DeliveryID      string         `json:"deliveryId"`
	Version         int            `json:"version"`
	RequestID       string         `json:"requestId"`
	TemplateVersion string         `json:"templateVersion"`
	Status          string         `json:"status"`
	Attempts        int            `json:"attempts"`
	Error           string         `json:"error"`
	SHA256          string         `json:"sha256"`
	CreatedAt       string         `json:"createdAt"`
	CompletedAt     string         `json:"completedAt"`
}
