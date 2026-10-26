package api_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func prdSheetBundle(t *testing.T, revision, value string) (prd.Manifest, map[string][]byte) {
	t.Helper()
	m, files := prdTestBundle(t, "7", "Sheet requirement")
	source := prd.SourceDocument{DocumentID: m.DocumentID, RevisionID: m.RevisionID, Content: `<title>PRD fixture</title><sheet token="SheetToken123" sheet-id="tab001"/><sheet token="SheetToken123" sheet-id="tab002"/>`}
	files["source.json"], _ = json.Marshal(source)
	m.Files[0] = prd.DescribeFile("source.json", "source", "application/json", files["source.json"])
	for _, id := range []string{"tab001", "tab002"} {
		name := id + ".json"
		sheet := prd.SheetDocument{WorkbookID: "SheetToken123", SheetID: id, RevisionID: revision, Title: id, Range: "A1:A1", Columns: 1, Values: [][]string{{id + value}}}
		files[name], _ = json.Marshal(sheet)
		m.Files = append(m.Files, prd.DescribeFile(name, "sheet", "application/json", files[name]))
		m.Resources = append(m.Resources, prd.Resource{Reference: "resource-" + map[string]string{"tab001": "1", "tab002": "2"}[id], ResourceID: sheet.WorkbookID, SheetID: id, RevisionID: revision, Kind: "sheet", Name: id, Filename: name, Status: "saved", FetchedAt: time.Now().UTC().Format(time.RFC3339Nano)})
	}
	return m, files
}

func TestPRDSheetRevisionChangesCreateImmutableSnapshots(t *testing.T) {
	f := newPRDFixture(t)
	first, claim := prdStart(t, f, "sheet-first")
	m, files := prdSheetBundle(t, "41", " original")
	original := string(files["tab001.json"])
	prdUpload(t, f, first, claim, m, files, 200)
	old := prdConfirm(t, f, first, "", false, 201)
	second, claim := prdStart(t, f, "sheet-new")
	m, files = prdSheetBundle(t, "42", " updated")
	prdUpload(t, f, second, claim, m, files, 200)
	head := prdConfirm(t, f, second, old.ID, false, 201)
	if old.ID == head.ID {
		t.Fatal("new sheet revision reused old snapshot")
	}
	third, claim := prdStart(t, f, "sheet-repeat")
	prdUpload(t, f, third, claim, m, files, 200)
	if prdConfirm(t, f, third, head.ID, false, 200).ID != head.ID {
		t.Fatal("same sheet revision duplicated snapshot")
	}
	for _, test := range []struct{ revision, value, code string }{{"42", " changed", "IMPORT_INCONSISTENT"}, {"41", " original", "PRD_REVISION_STALE"}} {
		task, claim := prdStart(t, f, "sheet-"+test.code)
		m, files = prdSheetBundle(t, test.revision, test.value)
		prdUpload(t, f, task, claim, m, files, 200)
		response := prdJSON(t, f.app, f.alice, "POST", "/api/v1/prd-imports/"+task.ID+"/confirm", map[string]any{"expectedCurrentSnapshotId": head.ID}, nil, 409, nil)
		if !strings.Contains(response.Body.String(), test.code) {
			t.Fatalf("wrong conflict: %s", response.Body.String())
		}
	}
	response := prdJSON(t, f.app, f.bob, "GET", "/api/v1/prd-snapshots/"+old.ID+"/files/tab001.json", nil, nil, 200, nil)
	if response.Body.String() != original {
		t.Fatal("historical sheet bytes were overwritten")
	}
	var list prd.SnapshotList
	prdJSON(t, f.app, f.bob, "GET", "/api/v1/campaigns/"+f.campaign+"/prd-snapshots", nil, nil, 200, &list)
	if len(list.Items) != 2 || list.CurrentSnapshotID != head.ID {
		t.Fatal("sheet history or current pointer changed after conflicts")
	}
}

func TestPRDSheetUploadRejectsWrongIdentityOrGrid(t *testing.T) {
	f := newPRDFixture(t)
	for _, test := range []string{"tab", "revision", "grid", "workbook_revision"} {
		task, claim := prdStart(t, f, "invalid-sheet-"+test)
		m, files := prdSheetBundle(t, "41", " original")
		var sheet prd.SheetDocument
		json.Unmarshal(files["tab001.json"], &sheet)
		switch test {
		case "tab":
			sheet.SheetID = "tab002"
		case "revision":
			sheet.RevisionID = "42"
		case "grid":
			sheet.Values[0] = []string{"one", "extra"}
		case "workbook_revision":
			sheet.RevisionID = "42"
			m.Resources[0].RevisionID = "42"
		}
		files["tab001.json"], _ = json.Marshal(sheet)
		for i, file := range m.Files {
			if file.Name == "tab001.json" {
				m.Files[i] = prd.DescribeFile(file.Name, file.Role, file.ContentType, files[file.Name])
			}
		}
		prdUpload(t, f, task, claim, m, files, 400)
	}
}
