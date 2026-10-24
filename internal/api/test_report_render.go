package api

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html/template"
	"image"
	"io"
	"io/fs"
	"path/filepath"
	"strings"
	"unicode/utf8"

	webassets "github.com/Chulan-824/acceptances/apps/web"
)

//go:embed test_report.html
var testReportHTML string

type testReportCounts struct {
	Total, Passed, Failed, Blocked, Skipped int
	Accepted, Rejected, Pending, Unrecorded int
}

type testReportFile struct {
	ArchivedFile
	Anchor, Description string
	Image               template.URL
	Text                string
	Width, Height       int
	Truncated           bool
	Checks              []string
}

type testReportCheck struct {
	Check
	Number, Anchor, Method, HumanStatus string
	Reason                              string
	Review                              *Review
	Steps                               []DocumentationStep
	Files                               []*testReportFile
	Cover                               *testReportFile
}

type testReportFeature struct {
	Title, Anchor string
	DocumentationFeature
	Counts testReportCounts
	Checks []testReportCheck
}

type testReportView struct {
	Snapshot   DeliverySnapshot
	Document   BusinessDocument
	Counts     testReportCounts
	Features   []testReportFeature
	Files      []*testReportFile
	Abnormal   []testReportCheck
	Methods    map[string]int
	Unassigned bool
}

func testResultLabel(value string) string {
	switch value {
	case "passed":
		return "通过（passed）"
	case "failed":
		return "失败（failed）"
	case "blocked":
		return "阻塞（blocked）"
	case "skipped":
		return "未执行（skipped）"
	default:
		return value
	}
}

func humanResultLabel(value string) string {
	switch value {
	case "accepted":
		return "人工接受"
	case "rejected":
		return "人工拒绝"
	case "pending":
		return "待人工评审"
	default:
		return "未记录"
	}
}

// These labels quote explicit signals in the actual observation only. Neither
// filenames nor expected behavior imply an execution method or backend proof.
func testMethod(actual string) string {
	if strings.Contains(actual, "受控") || strings.Contains(actual, "注入") || strings.Contains(actual, "DELIVERY_UI_ONLY") {
		if strings.Contains(actual, "恢复真实") || strings.Contains(actual, "临时响应控制恢复") {
			return "受控后恢复"
		}
		return "受控数据"
	}
	if strings.Contains(actual, "真实") {
		return "真实数据记录"
	}
	return "未单独记录"
}

func (counts *testReportCounts) add(check testReportCheck) {
	counts.Total++
	switch check.Status {
	case "passed":
		counts.Passed++
	case "failed":
		counts.Failed++
	case "blocked":
		counts.Blocked++
	case "skipped":
		counts.Skipped++
	}
	switch check.HumanStatus {
	case "accepted":
		counts.Accepted++
	case "rejected":
		counts.Rejected++
	case "pending":
		counts.Pending++
	default:
		counts.Unrecorded++
	}
}

var testReportTemplate = template.Must(template.New("test-report").Funcs(template.FuncMap{
	"offlineTheme": func() template.CSS { return template.CSS(webassets.OfflineThemeCSS) },
	"fontLicense":  func() string { return webassets.FontLicense },
	"result":       testResultLabel,
	"human":        humanResultLabel,
}).Parse(testReportHTML))

func renderTestReport(output io.Writer, root fs.FS, snapshot DeliverySnapshot, document BusinessDocument) error {
	if err := verifyFrozenDocumentEvidence(root, snapshot); err != nil {
		return err
	}
	view := testReportView{Snapshot: snapshot, Document: document, Methods: map[string]int{}}
	files := map[string]*testReportFile{}
	descriptions := map[string]string{}
	for _, evidence := range snapshot.Payload.Run.Report.Evidence {
		descriptions[evidence.Path] = evidence.Description
	}
	textBudget := int64(4 << 20)
	imageBudget := int64(64 << 20)
	for index, file := range snapshot.Payload.Files {
		item := &testReportFile{ArchivedFile: file, Anchor: fmt.Sprintf("file-%d", index+1), Description: descriptions[file.Path]}
		if err := testReportFilePreview(root, item, &textBudget, &imageBudget); err != nil {
			return err
		}
		view.Files = append(view.Files, item)
		files[file.Path] = item
	}
	materials := map[string]DocumentationFeature{}
	for _, feature := range snapshot.Payload.Materials.Features {
		materials[feature.FeatureID] = feature
	}
	human := map[string]CheckReview{}
	for _, decision := range snapshot.Payload.Run.CheckReviews {
		human[decision.CheckID] = decision
	}
	reviews := map[string]Review{}
	for _, review := range snapshot.Payload.Run.Reviews {
		reviews[review.ID] = review
	}
	checks := map[string]testReportCheck{}
	for index, check := range snapshot.Payload.Run.Report.Checks {
		decision := human[check.ID]
		item := testReportCheck{Check: check, Number: fmt.Sprintf("T%02d", index+1), Anchor: fmt.Sprintf("check-%d", index+1), Method: testMethod(check.Actual), HumanStatus: decision.Status, Reason: snapshot.Payload.ExceptionReasons[check.ID]}
		if review, exists := reviews[decision.LastReviewID]; exists && review.CheckID == check.ID {
			item.Review = &review
		}
		for _, path := range check.Evidence {
			file, exists := files[path]
			if !exists {
				return fmt.Errorf("检查项 %s 的冻结附件 %s 缺失", check.ID, path)
			}
			file.Checks = append(file.Checks, item.Number)
			item.Files = append(item.Files, file)
			if item.Cover == nil && file.Image != "" {
				item.Cover = file
			}
		}
		checks[check.ID] = item
		view.Counts.add(item)
		view.Methods[item.Method]++
	}
	assigned := map[string]bool{}
	for _, feature := range snapshot.Payload.Map.Features {
		material, exists := materials[feature.ID]
		if !exists {
			return fmt.Errorf("frozen documentation feature missing")
		}
		group := testReportFeature{Title: feature.Title, Anchor: fmt.Sprintf("feature-%d", len(view.Features)+1), DocumentationFeature: material}
		for _, reference := range feature.Checks {
			item, exists := checks[reference.ID]
			if !exists || assigned[reference.ID] {
				continue
			}
			for _, step := range material.Steps {
				for _, checkID := range step.CheckIDs {
					if checkID == reference.ID {
						item.Steps = append(item.Steps, step)
						break
					}
				}
			}
			group.Checks = append(group.Checks, item)
			group.Counts.add(item)
			assigned[reference.ID] = true
		}
		view.Features = append(view.Features, group)
	}
	// Optional or extra Run checks remain visible and counted, even if the map
	// did not classify them. Never discard observations to fit the summary.
	extra := testReportFeature{Title: "地图未归类检查项", Anchor: "feature-unassigned"}
	for _, original := range snapshot.Payload.Run.Report.Checks {
		item := checks[original.ID]
		if !assigned[original.ID] {
			extra.Checks = append(extra.Checks, item)
			extra.Counts.add(item)
		}
		if item.Status != "passed" {
			view.Abnormal = append(view.Abnormal, item)
		}
	}
	if len(extra.Checks) > 0 {
		view.Features = append(view.Features, extra)
		view.Unassigned = true
	}
	return testReportTemplate.Execute(output, view)
}

func testReportFilePreview(root fs.FS, item *testReportFile, textBudget, imageBudget *int64) error {
	extension := strings.ToLower(filepath.Ext(item.Path))
	switch extension {
	case ".png", ".jpg", ".jpeg", ".gif":
		data, kind, err := readDocumentationImage(root, item.Path)
		if err != nil {
			return err
		}
		*imageBudget -= int64(len(data))
		if *imageBudget < 0 {
			return fmt.Errorf("测试报告内嵌截图超过 64 MiB")
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return err
		}
		item.Width, item.Height = config.Width, config.Height
		item.Image = template.URL("data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data))
	case ".txt", ".json", ".jsonl", ".md", ".log", ".csv", ".diff", ".patch", ".yaml", ".yml":
		limit := min(int64(256<<10), *textBudget)
		if limit == 0 {
			item.Truncated = true
			return nil
		}
		file, err := root.Open(item.Path)
		if err != nil {
			return err
		}
		data, readErr := io.ReadAll(io.LimitReader(file, limit))
		err = file.Close()
		if readErr != nil {
			return readErr
		}
		if err != nil {
			return err
		}
		*textBudget -= int64(len(data))
		item.Truncated = int64(len(data)) < item.Size
		if item.Truncated {
			for trim := 0; trim < utf8.UTFMax-1 && len(data) > 0 && !utf8.Valid(data); trim++ {
				data = data[:len(data)-1]
			}
		}
		if utf8.Valid(data) {
			item.Text = string(data)
		}
	}
	return nil
}
