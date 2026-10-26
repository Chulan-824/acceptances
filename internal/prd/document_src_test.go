package prd_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func TestDocumentRetainsDownloadableImageTokensInSrc(t *testing.T) {
	for _, source := range []prd.SourceDocument{
		{Content: `<title>PRD</title><img id="ImageBlock123" src="ImageToken123" name="image.png"/>`},
		{Content: `<title>PRD</title><img ref="image1"/>`, ReferenceMap: map[string]json.RawMessage{
			"images": json.RawMessage(`{"image1":{"src":"ImageToken123","name":"image.png"}}`),
		}},
	} {
		doc, err := prd.SanitizeDocument(source)
		if err != nil {
			t.Fatal(err)
		}
		if len(doc.Resources) != 1 || doc.Resources[0].ResourceID != "ImageToken123" || doc.Resources[0].Reason != "RESOURCE_NOT_DOWNLOADED" {
			t.Fatalf("image token was not available for download: %#v", doc.Resources)
		}
		if doc.Excluded {
			t.Fatal("opaque image token was treated as a transient URL")
		}
		again, err := prd.SanitizeDocument(doc.Source)
		if err != nil || again.Excluded || len(again.Resources) != 1 || again.Resources[0].ResourceID != "ImageToken123" {
			t.Fatalf("saved source lost the image identity: %v %#v", err, again.Resources)
		}
	}
}

func TestDocumentDoesNotTreatImageURLsAsResourceTokens(t *testing.T) {
	for _, value := range []string{"https://example.com/image?signature=private", "http://127.0.0.1/image", "//example.com/image", "data:image/png;base64,private"} {
		doc, err := prd.SanitizeDocument(prd.SourceDocument{Content: `<title>PRD</title><img src="` + value + `"/>`})
		if err != nil {
			t.Fatal(err)
		}
		if len(doc.Resources) != 1 || doc.Resources[0].ResourceID != "" || doc.Resources[0].Reason != "NO_RESOURCE_TOKEN" || !doc.Excluded || strings.Contains(doc.Source.Content, value) {
			t.Fatalf("image URL was retained or made downloadable: %#v", doc)
		}
	}
}

func TestDocumentKeepsMentionsLinksAndFormattingWithoutMissingResources(t *testing.T) {
	source := prd.SourceDocument{Content: `<title>PRD</title><p><cite type="user" user-id="UserToken123" user-name="测试成员"/>审阅<cite type="doc" file-type="wiki" doc-id="WikiToken123" title="关联说明"/></p><table><colgroup><col width="100"/></colgroup><tbody><tr><td><del>旧需求</del></td></tr></tbody></table><figure id="FigureBlock123"><img src="ImageToken123"/></figure><sheet id="SheetBlock123" token="SheetToken123"/><source id="FileBlock123" token="FileToken123" name="prototype.html"/>`}
	doc, err := prd.SanitizeDocument(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Resources) != 3 || doc.Resources[0].Kind != "image" || doc.Resources[1].Kind != "sheet" || doc.Resources[2].Kind != "html" {
		t.Fatalf("mentions or formatting were listed as missing resources: %#v", doc.Resources)
	}
	if len(doc.Warnings) != 0 {
		t.Fatalf("recognized structure was reported as unsupported: %#v", doc.Warnings)
	}
	for _, text := range []string{"测试成员", "关联说明", "旧需求", "<del>", "<colgroup>", "<figure"} {
		if !strings.Contains(doc.Source.Content, text) {
			t.Fatalf("document meaning or formatting was discarded: %s", text)
		}
	}
	if doc.Resources[1].Status != "unsupported" || doc.Resources[2].Status != "missing" {
		t.Fatalf("embedded content was silently marked complete: %#v", doc.Resources)
	}
}

func TestDocumentDistinguishesEmbeddedCitationsFromOrdinaryReferences(t *testing.T) {
	doc, err := prd.SanitizeDocument(prd.SourceDocument{Content: `<title>PRD</title><cite type="doc" file-type="sheets" token="SheetToken123"/><cite type="doc" file-type="bitable" token="BaseToken123"/><cite type="unknown"/><unknown-block id="UnknownBlock123"/><unknown-block id="UnknownBlock456"/>`})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Resources) != 3 || doc.Resources[0].Kind != "sheet" || doc.Resources[1].Kind != "bitable" || doc.Resources[2].Kind != "cite" {
		t.Fatalf("embedded citations lost their classification: %#v", doc.Resources)
	}
	if len(doc.Warnings) != 1 || doc.Warnings[0].BlockID != "UnknownBlock123" || !strings.Contains(doc.Warnings[0].Message, "unknown-block") || !strings.Contains(doc.Warnings[0].Message, "2") {
		t.Fatalf("unknown block warnings were missing or repeated: %#v", doc.Warnings)
	}
}
