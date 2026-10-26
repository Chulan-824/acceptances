package cli

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func (r *larkReader) sheetRevision(ctx context.Context, token string) (string, error) {
	raw, err := r.command(ctx, "", 1<<20, true, "sheets", "+revision-get", "--spreadsheet-token", token, "--as", "user", "--format", "json")
	if err != nil {
		return "", err
	}
	var result struct {
		Revision json.Number `json:"revision"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return "", larkProblem("LARK_INVALID_RESULT")
	}
	if n, err := strconv.ParseUint(result.Revision.String(), 10, 64); err != nil || n == 0 {
		return "", larkProblem("LARK_INVALID_RESULT")
	}
	return result.Revision.String(), nil
}

func (r *larkReader) readSheet(ctx context.Context, resource *prd.Resource) ([]byte, error) {
	revision, err := r.sheetRevision(ctx, resource.ResourceID)
	if err != nil {
		return nil, err
	}
	raw, err := r.command(ctx, "", 1<<20, true, "sheets", "+workbook-info", "--spreadsheet-token", resource.ResourceID, "--as", "user", "--format", "json")
	if err != nil {
		return nil, err
	}
	type grid struct {
		ID       string `json:"sheet_id"`
		LegacyID string `json:"id"`
		Title    string `json:"title"`
		Name     string `json:"name"`
		Rows     int    `json:"row_count"`
		Columns  int    `json:"column_count"`
		Type     string `json:"resource_type"`
	}
	var workbook struct {
		Sheets   []grid `json:"sheets"`
		Workbook struct {
			Sheets []grid `json:"sheets"`
		} `json:"workbook"`
	}
	if json.Unmarshal(raw, &workbook) != nil {
		return nil, larkProblem("LARK_INVALID_RESULT")
	}
	if len(workbook.Sheets) == 0 {
		workbook.Sheets = workbook.Workbook.Sheets
	}
	for i := range workbook.Sheets {
		if workbook.Sheets[i].ID == "" {
			workbook.Sheets[i].ID = workbook.Sheets[i].LegacyID
		}
		if workbook.Sheets[i].Title == "" {
			workbook.Sheets[i].Title = workbook.Sheets[i].Name
		}
	}
	index := slices.IndexFunc(workbook.Sheets, func(g grid) bool { return g.ID == resource.SheetID })
	if index < 0 {
		return nil, larkProblem("LARK_NOT_FOUND")
	}
	g := workbook.Sheets[index]
	if g.Type != "" && g.Type != "sheet" {
		return nil, larkProblem("LARK_UNSUPPORTED_DOCUMENT")
	}
	if g.Rows < 1 || g.Columns < 1 || g.Rows > 5000 || g.Columns > 200 || g.Rows*g.Columns > prd.MaxSheetCells {
		return nil, larkProblem("LARK_LIMIT_EXCEEDED")
	}
	sheet := prd.SheetDocument{WorkbookID: resource.ResourceID, SheetID: resource.SheetID, RevisionID: revision, Title: g.Title, Range: fmt.Sprintf("A1:%s%d", prd.SheetColumn(g.Columns), g.Rows), Columns: g.Columns, Values: make([][]string, 0, g.Rows)}
	valueBytes := 0
	for start := 1; start <= g.Rows; start += 100 {
		end := min(start+99, g.Rows)
		region := fmt.Sprintf("A%d:%s%d", start, prd.SheetColumn(g.Columns), end)
		raw, err = r.command(ctx, "", prd.MaxResourceBytes, true, "sheets", "+csv-get", "--spreadsheet-token", resource.ResourceID, "--sheet-id", resource.SheetID, "--range", region, "--include-row-prefix=true", "--skip-hidden=false", "--max-chars", "2000000", "--as", "user", "--format", "json")
		if err != nil {
			return nil, err
		}
		var page struct {
			CSV         string   `json:"annotated_csv"`
			Rows        []int    `json:"row_indices"`
			Columns     []string `json:"col_indices"`
			Range       string   `json:"actual_range"`
			RowCount    int      `json:"row_count"`
			ColumnCount int      `json:"col_count"`
			More        bool     `json:"has_more"`
			Truncated   bool     `json:"truncated"`
		}
		if json.Unmarshal(raw, &page) != nil {
			return nil, larkProblem("LARK_INVALID_RESULT")
		}
		if page.More || page.Truncated {
			return nil, larkProblem("LARK_LIMIT_EXCEEDED")
		}
		if page.Range != region || page.RowCount != end-start+1 || len(page.Rows) != page.RowCount || page.ColumnCount != g.Columns || len(page.Columns) != g.Columns {
			return nil, larkProblem("LARK_INVALID_RESULT")
		}
		for i, col := range page.Columns {
			if col != prd.SheetColumn(i+1) {
				return nil, larkProblem("LARK_INVALID_RESULT")
			}
		}
		remaining := page.CSV
		for i, row := range page.Rows {
			prefix := fmt.Sprintf("[row=%d] ", row)
			if row != start+i || !strings.HasPrefix(remaining, prefix) {
				return nil, larkProblem("LARK_INVALID_RESULT")
			}
			remaining = strings.TrimPrefix(remaining, prefix)
			var values []string
			// encoding/csv skips empty physical lines; an annotated one-column empty row is still a cell.
			if g.Columns == 1 && (strings.HasPrefix(remaining, "\n") || strings.HasPrefix(remaining, "\r\n")) {
				values = []string{""}
				remaining = remaining[strings.IndexByte(remaining, '\n')+1:]
			} else {
				reader := csv.NewReader(strings.NewReader(remaining))
				reader.FieldsPerRecord = g.Columns
				values, err = reader.Read()
				if err != nil {
					return nil, larkProblem("LARK_INVALID_RESULT")
				}
				remaining = remaining[reader.InputOffset():]
			}
			sheet.Values = append(sheet.Values, values)
			for _, value := range values {
				valueBytes += len(value)
			}
			if valueBytes > prd.MaxResourceBytes {
				return nil, larkProblem("LARK_LIMIT_EXCEEDED")
			}
		}
		if remaining != "" {
			return nil, larkProblem("LARK_INVALID_RESULT")
		}
	}
	latest, err := r.sheetRevision(ctx, resource.ResourceID)
	if err != nil {
		return nil, err
	}
	if latest != revision {
		return nil, larkProblem("LARK_VERSION_CHANGED")
	}
	data, err := json.Marshal(sheet)
	if err != nil {
		return nil, larkProblem("LARK_INVALID_RESULT")
	}
	if len(data) > prd.MaxResourceBytes {
		return nil, larkProblem("LARK_LIMIT_EXCEEDED")
	}
	if _, err = prd.ParseSheet(data); err != nil {
		return nil, larkProblem("LARK_INVALID_RESULT")
	}
	resource.Name, resource.RevisionID = sheet.Title, revision
	return data, nil
}
