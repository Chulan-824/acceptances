package cli

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// Lark keeps rich table cells as XML even in its Markdown response.
func larkHTMLTable(raw string, renderInline func(xml.StartElement) (string, bool)) (string, error) {
	decoder := xml.NewDecoder(strings.NewReader(raw))
	var rows [][]string
	var row []string
	columns := 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch token := token.(type) {
		case xml.StartElement:
			switch token.Name.Local {
			case "tr":
				row = nil
			case "td", "th":
				var cell struct {
					Content string `xml:",innerxml"`
				}
				if err := decoder.DecodeElement(&cell, &token); err != nil {
					return "", err
				}
				text, err := larkHTMLCell(cell.Content, renderInline)
				if err != nil {
					return "", err
				}
				row = append(row, text)
			}
		case xml.EndElement:
			if token.Name.Local == "tr" && len(row) > 0 {
				rows = append(rows, row)
				columns = max(columns, len(row))
			}
		}
	}
	if len(rows) == 0 {
		return "", errors.New("Lark table has no cells")
	}
	var result strings.Builder
	result.WriteString("\n\n")
	for index, row := range rows {
		result.WriteByte('|')
		for column := range columns {
			value := ""
			if column < len(row) {
				value = row[column]
			}
			result.WriteString(" " + value + " |")
		}
		result.WriteByte('\n')
		if index == 0 {
			result.WriteString("|" + strings.Repeat(" --- |", columns) + "\n")
		}
	}
	result.WriteByte('\n')
	return result.String(), nil
}

func larkHTMLCell(raw string, renderInline func(xml.StartElement) (string, bool)) (string, error) {
	decoder := xml.NewDecoder(strings.NewReader("<cell>" + raw + "</cell>"))
	var result strings.Builder
	var lists []int
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch token := token.(type) {
		case xml.StartElement:
			if value, ok := renderInline(token); ok {
				result.WriteString(value)
				if err := decoder.Skip(); err != nil {
					return "", err
				}
				continue
			}
			switch token.Name.Local {
			case "b", "strong", "del", "s", "i", "em":
				var inner struct {
					Content string `xml:",innerxml"`
				}
				if err := decoder.DecodeElement(&inner, &token); err != nil {
					return "", err
				}
				value, err := larkHTMLCell(inner.Content, renderInline)
				if err != nil {
					return "", err
				}
				if value != "" {
					marker := map[string]string{"b": "**", "strong": "**", "del": "~~", "s": "~~", "i": "*", "em": "*"}[token.Name.Local]
					result.WriteString(" " + marker + value + marker + " ")
				}
			case "br", "hr":
				result.WriteString(" · ")
			case "ol", "ul":
				start := -1
				if token.Name.Local == "ol" {
					start = 1
					for _, attr := range token.Attr {
						if value, err := strconv.Atoi(attr.Value); attr.Name.Local == "start" && err == nil && value >= 0 {
							start = value
						}
					}
				}
				lists = append(lists, start)
			case "li":
				if len(lists) > 0 && lists[len(lists)-1] >= 0 {
					fmt.Fprintf(&result, " %d. ", lists[len(lists)-1])
					lists[len(lists)-1]++
				} else {
					result.WriteString(" • ")
				}
			case "code", "inline-code", "inline_code":
				var text string
				if err := decoder.DecodeElement(&text, &token); err != nil {
					return "", err
				}
				fence := strings.Repeat("`", strings.Count(text, "`")+1)
				result.WriteString(fence + " " + strings.ReplaceAll(text, "|", `\|`) + " " + fence)
			}
		case xml.EndElement:
			switch token.Name.Local {
			case "ol", "ul":
				if len(lists) > 0 {
					lists = lists[:len(lists)-1]
				}
				result.WriteByte(' ')
			case "li", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote":
				result.WriteByte(' ')
			}
		case xml.CharData:
			result.WriteString(literalMarkdown(string(token)))
		}
	}
	return strings.Join(strings.Fields(result.String()), " "), nil
}
