package prd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const MaxSheetCells = 100000

// SheetDocument retains displayed values at their physical positions, including empty cells.
type SheetDocument struct {
	WorkbookID string     `json:"workbookId"`
	SheetID    string     `json:"sheetId"`
	RevisionID string     `json:"revisionId"`
	Title      string     `json:"title"`
	Range      string     `json:"range"`
	Columns    int        `json:"columns"`
	Values     [][]string `json:"values"`
}

func ParseSheet(data []byte) (SheetDocument, error) {
	var sheet SheetDocument
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if len(data) > MaxResourceBytes || decoder.Decode(&sheet) != nil || decoder.Decode(new(any)) != io.EOF ||
		!documentToken.MatchString(sheet.WorkbookID) || !documentToken.MatchString(sheet.SheetID) || !validRevision(sheet.RevisionID) ||
		sheet.Title == "" || len(sheet.Title) > 4096 || sheet.Columns < 1 || sheet.Columns > 200 || len(sheet.Values) < 1 || len(sheet.Values) > 5000 || len(sheet.Values)*sheet.Columns > MaxSheetCells ||
		sheet.Range != fmt.Sprintf("A1:%s%d", SheetColumn(sheet.Columns), len(sheet.Values)) {
		return SheetDocument{}, errors.New("invalid PRD sheet")
	}
	for _, row := range sheet.Values {
		if len(row) != sheet.Columns {
			return SheetDocument{}, errors.New("invalid PRD sheet row")
		}
	}
	return sheet, nil
}

func SheetColumn(index int) string {
	result := ""
	for index > 0 {
		index--
		result = string(rune('A'+index%26)) + result
		index /= 26
	}
	return result
}
