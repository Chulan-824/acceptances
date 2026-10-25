package api_test

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chulan-824/acceptances/internal/api"
)

func guideFixture() api.BusinessGuide {
	return api.BusinessGuide{SchemaVersion: 1, Title: "订单使用指南", Summary: "找到订单，了解状态并确认展示。",
		Modules: []api.GuideModule{{Title: "订单", Description: "查看订单进度。"}},
		Pages:   []api.GuidePage{{Audience: "业务人员", Title: "订单列表", Entry: "工作台 → 订单", Instruction: "查看状态列。", Images: []api.GuideImage{{Path: "screen.png", Caption: "订单页面", Kind: "actual", Annotations: []api.GuideAnnotation{{GuideRegion: api.GuideRegion{X: 10, Y: 10, Width: 25, Height: 25}, Label: "状态列"}}}}}},
		Sections: []api.GuideSection{{Title: "查看订单状态", Summary: "以下状态通过演示样例展示。", Blocks: []api.GuideBlock{
			{Kind: "heading", Text: "在哪里看"}, {Kind: "steps", Items: []string{"打开订单列表，找到状态列。"}},
			{Kind: "table", Columns: []string{"状态", "含义"}, Rows: [][]string{{"等待中", "订单等待处理。"}, {"已完成", "订单处理完成。"}}},
			{Kind: "images", Images: []api.GuideImage{{Path: "screen.png", Caption: "不同状态的演示样例", Kind: "sample", Crop: &api.GuideRegion{X: 10, Y: 10, Width: 50, Height: 50}}}},
			{Kind: "paragraph", Text: "<script>alert(1)</script>"}, {Kind: "quote", Text: "再次处理前，请先确认订单。"},
			{Kind: "note", Text: "演示样例不代表实际订单流转。"}, {Kind: "confirmations", Items: []string{"状态名称是否清楚？"}},
		}}}, Review: []string{"确认状态列容易找到。"}, Limitations: []string{"只查看展示，不发起实际处理。"}}
}

func documentHTML(t *testing.T, app *api.Server, key string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	authenticatedHandler(t, app).ServeHTTP(w, localRequest("GET", "/api/v1/documents/"+key+"/html?download=1", nil))
	if w.Code != 200 {
		t.Fatalf("document HTML: %d %s", w.Code, w.Body.String())
	}
	return w
}

func TestBusinessGuideIndependentContentVersionsAndHistoricalAccess(t *testing.T) {
	app, pid, cid, _ := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "guide-fixture", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, runID, "guide-freeze")
	beforeRun := request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)
	deliveryID := snapshot["id"].(string)
	path := "/api/v1/deliveries/" + deliveryID + "/documents"
	report := request(t, app, "POST", path, `{"requestId":"legacy-report"}`, 201)
	reportHTML := documentHTML(t, app, report["id"].(string)).Body.String()
	guide := guideFixture()
	input := map[string]any{"requestId": "guide-one", "kind": "business_guide", "guide": guide}
	document := request(t, app, "POST", path, fixtureJSON(t, input), 201)
	if document["kind"] != "business_guide" || document["version"] != float64(1) || report["kind"] != "test_report" {
		t.Fatal(document, report)
	}
	w := documentHTML(t, app, document["id"].(string))
	html := w.Body.String()
	for _, text := range []string{"涉及哪些模块与页面", "订单列表", "等待中", "演示样例", "实际页面", "状态列", "业务确认与反馈", "放大查看完整页面", "data:image/png;base64,", "&lt;script&gt;", `viewBox="0.2 0.2 1 1"`} {
		if !strings.Contains(html, text) {
			t.Fatalf("guide missing %s", text)
		}
	}
	for _, text := range []string{"<script>", "验证依据", "对应检查", "受验提交", "代码来源", "产物摘要", "来源 Run", "快照内容摘要"} {
		if strings.Contains(html, text) {
			t.Fatalf("unexpected guide content: %s", text)
		}
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), "business-guide-v1.html") || fixtureDigest(html) != document["sha256"] {
		t.Fatal("wrong guide download or digest")
	}
	replayed := request(t, app, "POST", path, fixtureJSON(t, input), 200)
	if replayed["id"] != document["id"] {
		t.Fatal("idempotent guide duplicated")
	}
	input["kind"] = "test_report"
	delete(input, "guide")
	request(t, app, "POST", path, fixtureJSON(t, input), 409)
	guide.Title = "修订版业务指南"
	input["kind"], input["guide"] = "business_guide", guide
	request(t, app, "POST", path, fixtureJSON(t, input), 409)
	// No guide input inherits the latest successful authored content.
	two := request(t, app, "POST", path, `{"requestId":"guide-two","kind":"business_guide"}`, 201)
	if two["version"] != float64(2) || documentHTML(t, app, two["id"].(string)).Body.String() != strings.Replace(html, "指南 · v1", "指南 · v2", 1) {
		t.Fatal("guide source inheritance failed")
	}
	reports := request(t, app, "GET", path+"?kind=test_report", "", 200)["items"].([]any)
	guides := request(t, app, "GET", path+"?kind=business_guide", "", 200)["items"].([]any)
	if len(reports) != 1 || len(guides) != 2 {
		t.Fatal(reports, guides)
	}
	request(t, app, "GET", path+"?kind=unknown", "", 400)
	request(t, app, "POST", path, `{"requestId":"bad-kind","kind":"unknown"}`, 400)
	guide.Pages[0].Images[0].Path = "../outside.png"
	request(t, app, "POST", path, fixtureJSON(t, map[string]any{"requestId": "bad-image", "kind": "business_guide", "guide": guide}), 409)
	guide.Pages[0].Images[0].Path = "screen.png"
	guide.Pages[0].Images[0].Annotations[0].X = 101
	request(t, app, "POST", path, fixtureJSON(t, map[string]any{"requestId": "bad-region", "kind": "business_guide", "guide": guide}), 409)
	if documentHTML(t, app, report["id"].(string)).Body.String() != reportHTML {
		t.Fatal("guide changed test report")
	}
	if fixtureJSON(t, request(t, app, "GET", "/api/v1/runs/"+runID, "", 200)) != fixtureJSON(t, beforeRun) {
		t.Fatal("guide mutated Run")
	}
	after := request(t, app, "GET", "/api/v1/deliveries/"+deliveryID, "", 200)
	if after["sha256"] != snapshot["sha256"] || fixtureJSON(t, after["payload"]) != fixtureJSON(t, snapshot["payload"]) {
		t.Fatal("guide mutated frozen content")
	}
	overview := request(t, app, "GET", "/api/v1/campaigns/"+cid+"/delivery", "", 200)
	if overview["latestDocument"].(map[string]any)["id"] != report["id"] || overview["latestGuide"].(map[string]any)["id"] != two["id"] {
		t.Fatal(overview)
	}
	request(t, app, "DELETE", "/api/v1/projects/"+pid, "", 204)
	request(t, app, "POST", path, `{"requestId":"inactive-guide","kind":"business_guide"}`, 409)
	if documentHTML(t, app, document["id"].(string)).Body.String() != html {
		t.Fatal("historical guide changed")
	}
}

func TestBusinessGuideRetryUsesSavedContentAfterRestart(t *testing.T) {
	app, pid, cid, dir := deliveryTestSetup(t)
	f := newDeliveryFixture(t, pid, cid)
	f.finalize(t)
	runID := publishDeliveryFixture(t, app, cid, "guide-retry-fixture", f)
	request(t, app, "POST", "/api/v1/runs/"+runID+"/accept-all", `{}`, 200)
	snapshot := freezeFixture(t, app, runID, "guide-retry-freeze")
	deliveryID := snapshot["id"].(string)
	imagePath := filepath.Join(dir, "deliveries", deliveryID, "evidence", "screen.png")
	if err := os.WriteFile(imagePath, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	failed := request(t, app, "POST", "/api/v1/deliveries/"+deliveryID+"/documents", fixtureJSON(t, map[string]any{"requestId": "retry-guide", "kind": "business_guide", "guide": guideFixture()}), 200)
	if failed["status"] != "failed" {
		t.Fatal(failed)
	}
	app.Close()
	if err := os.WriteFile(imagePath, []byte(f.Files["screen.png"]), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := openArchive(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	retried := request(t, reopened, "POST", "/api/v1/documents/"+failed["id"].(string)+"/retry", `{}`, 201)
	if retried["id"] != failed["id"] || retried["version"] != float64(1) || retried["attempts"] != float64(2) || retried["kind"] != "business_guide" || !strings.Contains(documentHTML(t, reopened, retried["id"].(string)).Body.String(), "订单列表") {
		t.Fatal(retried)
	}
}
