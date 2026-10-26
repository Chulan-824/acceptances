package cli

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func larkSheetFixture(args []string, scenario string, count func(string) int) bool {
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "sheets +") {
		return false
	}
	if scenario == "sheet_scope" {
		fmt.Fprint(os.Stderr, `{"ok":false,"error":{"type":"authorization","subtype":"missing_scope"}}`)
		os.Exit(3)
	}
	data := map[string]any{}
	switch {
	case strings.Contains(joined, "+revision-get"):
		revision := 41
		if scenario == "sheet_changed" {
			revision = count(`"+revision-get"`)
		}
		data["revision"] = revision
	case strings.Contains(joined, "+workbook-info"):
		data["sheets"] = []map[string]any{{"sheet_id": "tab001", "title": "Requirements [A]", "row_count": 3, "column_count": 2, "resource_type": "sheet"}, {"sheet_id": "tab002", "title": "Second tab", "row_count": 3, "column_count": 1, "resource_type": "sheet"}}
		if scenario == "sheet_pages" {
			data["sheets"] = []map[string]any{{"sheet_id": "tab001", "title": "Paged values", "row_count": 150, "column_count": 1}, {"sheet_id": "tab002", "title": "Other values", "row_count": 150, "column_count": 1}}
		}
	case strings.Contains(joined, "+csv-get"):
		second := strings.Contains(joined, "tab002")
		csvText, cols, actual := "[row=1] Feature,Detail\n[row=2] ,\n[row=3] Tail,\"line1\n[row=999] | <script>alert(1)</script>\"\n", []string{"A", "B"}, "A1:B3"
		if second {
			csvText, cols, actual = "[row=1] Other\n[row=2] \n[row=3] Last\n", []string{"A"}, "A1:A3"
		}
		data = map[string]any{"annotated_csv": csvText, "row_indices": []int{1, 2, 3}, "col_indices": cols, "row_count": 3, "col_count": len(cols), "actual_range": actual, "has_more": false}
		if scenario == "sheet_truncated" {
			data["has_more"] = true
		}
		if scenario == "sheet_gap" {
			data["row_indices"] = []int{1, 3, 4}
		}
		if scenario == "sheet_pages" {
			var start, end int
			for i, arg := range args {
				if arg == "--range" {
					fmt.Sscanf(args[i+1], "A%d:A%d", &start, &end)
				}
			}
			var body strings.Builder
			var rows []int
			for row := start; row <= end; row++ {
				rows = append(rows, row)
				fmt.Fprintf(&body, "[row=%d] ", row)
				writer := csv.NewWriter(&body)
				writer.Write([]string{fmt.Sprintf("Cell %d", row)})
				writer.Flush()
			}
			data = map[string]any{"annotated_csv": body.String(), "row_indices": rows, "col_indices": []string{"A"}, "actual_range": fmt.Sprintf("A%d:A%d", start, end), "row_count": end - start + 1, "col_count": 1}
		}
	default:
		return false
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "identity": "user", "data": data})
	return true
}

func TestLarkConnectImportsEmbeddedSheetsAndRejectsIncompleteReads(t *testing.T) {
	for _, scenario := range []string{"sheet_complete", "sheet_pages", "sheet_scope", "sheet_truncated", "sheet_gap", "sheet_changed"} {
		t.Run(scenario, func(t *testing.T) {
			t.Setenv("LARK_FIXTURE_SCENARIO", scenario)
			h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
			cmd, output, dir := connectorProcess(t, h.server.URL)
			select {
			case bundle := <-h.uploads:
				resources := bundle.Manifest.Resources
				if len(resources) != 2 {
					t.Fatalf("embedded tabs were lost: %#v", resources)
				}
				if scenario == "sheet_changed" {
					t.Fatal("mixed sheet revisions were accepted")
				}
				complete := scenario == "sheet_complete" || scenario == "sheet_pages"
				for _, r := range resources {
					if complete {
						if r.Status != "saved" || r.Kind != "sheet" {
							t.Fatalf("sheet not archived: %#v", r)
						}
						var data map[string]any
						if json.Unmarshal(bundle.Files[r.Filename], &data) != nil || data["revisionId"] != "41" {
							t.Fatal("sheet identity/revision missing")
						}
						if scenario == "sheet_pages" && len(data["values"].([]any)) != 150 {
							t.Fatal("second page lost")
						}
					} else if r.Status != "missing" || r.Reason != map[string]string{"sheet_scope": "LARK_SCOPE_REQUIRED", "sheet_truncated": "LARK_LIMIT_EXCEEDED", "sheet_gap": "LARK_INVALID_RESULT"}[scenario] {
						t.Fatalf("missing content was misclassified: %#v", r)
					}
				}
				reading := string(bundle.Files["document.md"])
				if scenario == "sheet_pages" && !strings.Contains(reading, "Cell 150") {
					t.Fatal("last physical row missing")
				}
				if scenario == "sheet_complete" && (!strings.Contains(reading, "Tail") || !strings.Contains(reading, "Last") || strings.Contains(reading, "<sheet") || strings.Contains(reading, "<script>") || bundle.Manifest.Completeness != "complete") {
					t.Fatal("reading view lost or executed cell text")
				}
				if !complete && bundle.Manifest.Completeness != "partial" {
					t.Fatal("incomplete read claimed complete")
				}
			case failure := <-h.failures:
				if scenario != "sheet_changed" || failure["errorCode"] != "LARK_VERSION_CHANGED" {
					t.Fatalf("unexpected failure: %#v", failure)
				}
			case <-time.After(larkProcessTimeout):
				cmd.Process.Signal(os.Interrupt)
				cmd.Wait()
				t.Fatal("sheet import timed out")
			}
			stopConnector(t, cmd, output, dir)
		})
	}
}
