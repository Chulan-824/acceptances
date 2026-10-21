package api_test

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func TestTestReportPreservesResultsEvidenceAndIndependentGuide(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.Materials.Features[0].Limitations = []string{"后端固化不在本次范围。"}
	f.Map.Excluded = []string{"后端告警不在范围，不计入未执行。"}
	observations := []struct{ status, actual string }{
		{"passed", "真实任务 123 回读，页面已展示。"},
		{"failed", "受控数据展示失败，保留原始结果。"},
		{"blocked", "受控临时响应控制恢复为真实查询，另有资源阻塞。"},
		{"skipped", "未执行；<script>unsafe()</script>"},
	}
	for i, observation := range observations {
		id := fmt.Sprintf("fixture-export--case-%d", i)
		check := api.Check{ID: id, Title: fmt.Sprintf("原始检查 %d", i), Expected: "预期原文 <b>不可执行</b>", Actual: observation.actual, Status: observation.status, Evidence: []string{"screen.png", "trace.txt"}}
		f.Report.Checks = append(f.Report.Checks, check)
		f.Map.Features[0].Checks = append(f.Map.Features[0].Checks, api.MapCheck{ID: id, Title: check.Title, Expected: check.Expected, Required: true})
	}
	// A Run may also contain an optional check outside the map. It must not be lost.
	f.Report.Checks = append(f.Report.Checks, api.Check{ID: "unmapped-check", Title: "额外观察", Expected: "保留", Actual: "未声明验证方式", Status: "passed", Evidence: []string{"trace.txt"}})
	f.Files["trace.txt"] = "<img src=x onerror=alert(1)>\n原始文本"
	f.Files["long.json"] = `{"message":"` + strings.Repeat("长", 100000) + `"}`
	f.Report.Evidence = append(f.Report.Evidence, api.Evidence{Path: "trace.txt", Description: "受控文本原件"}, api.Evidence{Path: "long.json", Description: "长文本预览"})
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "test-report-facts", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	input := preparedFreeze(t, app, runID, "freeze-test-report-facts")
	for _, check := range f.Report.Checks {
		if check.Status != "passed" {
			input.ExceptionReasons[check.ID] = "明确接受合成测试中的原始异常，保留未验证限制。"
		}
	}
	snapshot := request(t, app, "POST", "/api/v1/runs/"+runID+"/deliveries", fixtureJSON(t, input), 201)
	deliveryID := snapshot["id"].(string)
	path := "/api/v1/deliveries/" + deliveryID + "/documents"
	guide := request(t, app, "POST", path, fixtureJSON(t, map[string]any{"requestId": "unchanged-guide", "kind": "business_guide", "guide": guideFixture()}), 201)
	guideBefore := documentHTML(t, app, guide["id"].(string)).Body.String()
	doc := request(t, app, "POST", path, `{"requestId":"structured-report","kind":"test_report"}`, 201)
	response := documentHTML(t, app, doc["id"].(string))
	html := response.Body.String()
	if doc["templateVersion"] != "test-report-html-v1" || !strings.Contains(response.Header().Get("Content-Disposition"), "test-report-v1.html") {
		t.Fatal("wrong test report template or download filename")
	}
	previous := -1
	for _, chapter := range []string{`id="summary"`, `id="scope"`, `id="environment"`, `id="results"`, `id="issues"`, `id="review"`, `id="appendix"`} {
		position := strings.Index(html, chapter)
		if position <= previous {
			t.Fatalf("missing or unordered chapter: %s", chapter)
		}
		previous = position
	}
	for _, text := range []string{"原始通过", "失败（failed）", "阻塞（blocked）", "未执行（skipped）", "人工接受", "明确接受合成测试", "真实数据记录", "受控后恢复", "未单独记录", "地图未归类检查项", "额外观察", "独立逐步操作记录未提供", "文本预览已截断", "data:image/png;base64,", "trace.txt", "原始文本", "&lt;script&gt;unsafe()&lt;/script&gt;", "&lt;img src=x onerror=alert(1)&gt;"} {
		if !strings.Contains(html, text) {
			t.Fatalf("missing preserved content %q", text)
		}
	}
	if strings.Count(html, `class="case"`) != len(f.Report.Checks) || strings.Contains(html, "<script>") || strings.Contains(html, `<b>不可执行</b>`) {
		t.Fatal("checks lost or unescaped input")
	}
	if strings.Count(html, "data:image/png;base64,") != 1 || !strings.Contains(html, `<use href="#image-file-`) {
		t.Fatal("shared screenshots must be embedded once and reused without scripts")
	}
	if !strings.Contains(response.Header().Get("Content-Security-Policy"), "sandbox;") || strings.Contains(html, "<iframe") {
		t.Fatal("report must preserve script-free sandbox isolation")
	}
	if documentHTML(t, app, guide["id"].(string)).Body.String() != guideBefore {
		t.Fatal("test report changed business guide")
	}
	after := request(t, app, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
	if fixtureJSON(t, snapshot["payload"]) != fixtureJSON(t, after["payload"]) || snapshot["sha256"] != after["sha256"] {
		t.Fatal("test report rewrote frozen facts")
	}
}

func TestLegacyFailedTestReportRetriesOriginalTemplate(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "legacy-report-retry", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, runID, "legacy-report-freeze")
	deliveryID := snapshot["id"].(string)
	db, err := sql.Open("sqlite", filepath.Join(dir, "archive.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`INSERT INTO business_documents(id,delivery_id,kind,version,request_id,template_version,status,created_at) VALUES('legacy-retry',?,'test_report',1,'legacy-retry-key','business-html-v2-geist','failed','2026-10-19T00:00:00Z')`, deliveryID)
	if err != nil {
		t.Fatal(err)
	}
	legacy := request(t, app, "POST", "/api/v1/documents/legacy-retry/retry", `{}`, 201)
	if legacy["status"] != "succeeded" || legacy["templateVersion"] != "business-html-v2-geist" || legacy["version"] != float64(1) {
		t.Fatal(legacy)
	}
	legacyHTML := documentHTML(t, app, "legacy-retry").Body.String()
	if !strings.Contains(legacyHTML, "验证依据") || strings.Contains(legacyHTML, `id="results"`) {
		t.Fatal("legacy retry must retain its original template")
	}
	newReport := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", `{"requestId":"current-after-legacy"}`, 201)
	if newReport["version"] != float64(2) || newReport["templateVersion"] != "test-report-html-v1" {
		t.Fatal(newReport)
	}
	if documentHTML(t, app, "legacy-retry").Body.String() != legacyHTML {
		t.Fatal("new report rewrote historical HTML")
	}
}
