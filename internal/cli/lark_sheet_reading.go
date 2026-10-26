package cli

import (
	"fmt"
	"strings"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func larkSheetMarkdown(data []byte) string {
	sheet, err := prd.ParseSheet(data)
	if err != nil {
		return "[Sheet 归档无效]"
	}
	var result strings.Builder
	fmt.Fprintf(&result, "\n\n### Sheet：%s\n\n修订 %s；范围 %s。以下为单元格显示值，隐藏行列包含在内；样式、合并、公式定义及图形对象不在本次文本读取范围。\n\n", literalMarkdown(sheet.Title), sheet.RevisionID, sheet.Range)
	lastRow, lastColumn := 0, 0
	for i, row := range sheet.Values {
		for j, value := range row {
			if value != "" {
				lastRow = max(lastRow, i+1)
				lastColumn = max(lastColumn, j+1)
			}
		}
	}
	if lastRow == 0 {
		result.WriteString("（空表）\n")
		return result.String()
	}
	result.WriteString("| 行 |")
	for col := 1; col <= lastColumn; col++ {
		fmt.Fprintf(&result, " %s |", prd.SheetColumn(col))
	}
	result.WriteString("\n| --- |")
	for range lastColumn {
		result.WriteString(" --- |")
	}
	result.WriteByte('\n')
	for row := 0; row < lastRow; row++ {
		fmt.Fprintf(&result, "| %d |", row+1)
		for col := 0; col < lastColumn; col++ {
			fmt.Fprintf(&result, " %s |", literalMarkdown(sheet.Values[row][col]))
		}
		result.WriteByte('\n')
	}
	return result.String()
}
