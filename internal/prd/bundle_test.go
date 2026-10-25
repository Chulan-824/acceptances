package prd_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func textBundle(t *testing.T) (prd.Manifest, map[string][]byte) {
	t.Helper()
	raw, err := json.Marshal(prd.SourceDocument{
		DocumentID: "DocumentToken123", RevisionID: "7",
		Content:      "<title>登录需求</title><p>必须验证验证码。</p>",
		ReferenceMap: map[string]json.RawMessage{},
	})
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{"source.json": raw, "document.md": []byte("# 登录需求\n\n必须验证验证码。\n")}
	m := prd.Manifest{SchemaVersion: 1, DocumentID: "DocumentToken123", Realm: "feishu", RevisionID: "7", Title: "登录需求", FetchedAt: "2026-10-25T00:00:00Z", NormalizerVersion: prd.NormalizerVersion, Completeness: "complete", Warnings: []prd.Warning{}, Resources: []prd.Resource{}, Files: []prd.File{}}
	for _, name := range []string{"source.json", "document.md"} {
		role, media := "source", "application/json"
		if name == "document.md" {
			role, media = "markdown", "text/markdown"
		}
		sum := sha256.Sum256(files[name])
		m.Files = append(m.Files, prd.File{Name: name, Role: role, ContentType: media, Size: int64(len(files[name])), SHA256: hex.EncodeToString(sum[:])})
	}
	return m, files
}

func TestBundleKeepsStructureAndReadingViewTogether(t *testing.T) {
	m, files := textBundle(t)
	got, err := prd.ValidateBundle(m, files)
	if err != nil {
		t.Fatal(err)
	}
	if got.Manifest.RevisionID != "7" || len(got.Files) != 2 || len(got.SourceHash) != 64 || len(got.ResourceHash) != 64 {
		t.Fatalf("incomplete bundle: %#v", got)
	}
}

func TestBundleRejectsUntrustedOrPartialContent(t *testing.T) {
	for _, change := range []string{"bytes", "revision", "comments", "fragment", "extra file", "missing markdown"} {
		t.Run(change, func(t *testing.T) {
			m, files := textBundle(t)
			switch change {
			case "bytes":
				files["document.md"] = []byte("tampered")
			case "revision":
				m.RevisionID = "8"
			case "comments", "fragment":
				var source prd.SourceDocument
				json.Unmarshal(files["source.json"], &source)
				if change == "comments" {
					source.Content += "<comment>private conversation</comment>"
				} else {
					source.Content = "<fragment><p>selected text</p></fragment>"
				}
				files["source.json"], _ = json.Marshal(source)
				m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
			case "extra file":
				files["secret.txt"] = []byte("undeclared")
			case "missing markdown":
				delete(files, "document.md")
			}
			if _, err := prd.ValidateBundle(m, files); err == nil {
				t.Fatal("untrusted upload accepted")
			}
		})
	}
}

func TestBundleDeduplicatesTemporaryAliasesAndReadMetadata(t *testing.T) {
	makeBundle := func(alias, revision, readTime string) prd.Bundle {
		m, files := textBundle(t)
		source := prd.SourceDocument{DocumentID: m.DocumentID, RevisionID: revision, Content: `<title>登录需求</title><img ref="` + alias + `"></img>`, ReferenceMap: map[string]json.RawMessage{"images": json.RawMessage(`{"` + alias + `":{"token":"ImageToken123"}}`)}}
		files["source.json"], _ = json.Marshal(source)
		m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
		m.RevisionID, m.FetchedAt, m.Completeness = revision, readTime, "partial"
		m.Resources = []prd.Resource{{Reference: alias, ResourceID: "ImageToken123", Kind: "image", Status: "missing", Reason: "RESOURCE_NOT_DOWNLOADED"}}
		bundle, err := prd.ValidateBundle(m, files)
		if err != nil {
			t.Fatal(err)
		}
		return bundle
	}
	a := makeBundle("img_1", "7", "2026-10-25T00:00:00Z")
	b := makeBundle("img_99", "8", "2026-10-25T01:00:00Z")
	if a.SourceHash != b.SourceHash || a.ResourceHash != b.ResourceHash {
		t.Fatal("temporary aliases, read time or revision changed semantic hashes")
	}
}
