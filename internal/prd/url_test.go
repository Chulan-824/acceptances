package prd_test

import (
	"testing"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func TestURLImportsTheWholeDocument(t *testing.T) {
	got, err := prd.NormalizeURL("https://team.feishu.cn/wiki/DocumentToken123?from=share#share-selected")
	if err != nil {
		t.Fatal(err)
	}
	if got.URL != "https://team.feishu.cn/wiki/DocumentToken123" || got.Kind != "wiki" || got.Token != "DocumentToken123" || got.Realm != "feishu" {
		t.Fatalf("unexpected document location: %#v", got)
	}
}

func TestURLRejectsOtherResourcesAndRequestTargets(t *testing.T) {
	for _, raw := range []string{
		"http://team.feishu.cn/docx/DocumentToken123",
		"https://team.feishu.cn.evil.test/docx/DocumentToken123",
		"https://user:secret@team.feishu.cn/docx/DocumentToken123",
		"https://team.feishu.cn:8080/docx/DocumentToken123",
		"https://127.0.0.1/docx/DocumentToken123",
		"https://team.feishu.cn/sheets/DocumentToken123",
		"https://team.feishu.cn/docx/DocumentToken123/extra",
		"https://team.feishu.cn/docx/%2FDocumentToken123",
	} {
		if _, err := prd.NormalizeURL(raw); err == nil {
			t.Errorf("accepted unsupported input %q", raw)
		}
	}
}
