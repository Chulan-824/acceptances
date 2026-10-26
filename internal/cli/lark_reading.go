package cli

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/Chulan-824/acceptances/internal/prd"
)

var markdownImage = regexp.MustCompile(`!\[([^\]\n]*)\]\(([^)\n]*)\)`)
var markdownReferenceImage = regexp.MustCompile(`!\[[^\]\n]*\]\[[^\]\n]*\]`)
var markdownHTMLImage = regexp.MustCompile(`(?is)<(?:img|whiteboard)\b[^>]*>`)
var markdownEmptyCitation = regexp.MustCompile(`(?is)<cite\b[^>]*(?:/>|>\s*</cite>)`)
var markdownHTMLTable = regexp.MustCompile(`(?is)<table\b[^>]*>.*?</table>`)
var markdownEmbeddedResource = regexp.MustCompile(`(?is)<(?:source|file|sheet)\b[^>]*(?:/>|>\s*</(?:source|file|sheet)>)`)
var markdownComments = regexp.MustCompile(`(?is)<!--.*?-->|<comment\b[^>]*>.*?</comment>`)

func larkReadingView(markdown string, resources []prd.Resource, references map[string]json.RawMessage, files map[string][]byte) (string, bool) {
	unmapped := false
	renderImage := func(label string, targets ...string) string {
		for _, resource := range resources {
			for _, target := range targets {
				if resource.ResourceID != "" && strings.Contains(target, resource.ResourceID) || resource.Reference != "" && strings.Trim(target, " <>") == resource.Reference {
					if resource.Status == "saved" {
						return "![" + label + "](" + resource.Filename + ")"
					}
					return "[图片未保存：" + resource.Reason + "]"
				}
			}
		}
		unmapped = true
		return "[图片未匹配，见资源清单]"
	}
	renderInline := func(element xml.StartElement) (string, bool) {
		attrs := make(map[string]string)
		for _, attr := range element.Attr {
			attrs[attr.Name.Local] = attr.Value
		}
		switch element.Name.Local {
		case "sheet":
			for _, resource := range resources {
				if resource.Kind == "sheet" && resource.ResourceID == attrs["token"] && resource.SheetID == attrs["sheet-id"] {
					if resource.Status != "saved" {
						return "[Sheet 未保存：" + resource.Reason + "]", true
					}
					return larkSheetMarkdown(files[resource.Filename]), true
				}
			}
		case "source", "file":
			for _, resource := range resources {
				if resource.Kind == "html" && resource.ResourceID != "" && resource.ResourceID == attrs["token"] {
					return "[HTML 附件：" + literalMarkdown(resource.Name) + "，见附件预览]", true
				}
			}
		case "img", "whiteboard":
			return renderImage("图片", attrs["src"], attrs["ref"], attrs["token"], attrs["file-token"], attrs["file_token"], attrs["whiteboard_id"]), true
		case "cite":
			if attrs["type"] == "user" && attrs["user-id"] != "" && attrs["user-name"] != "" {
				return literalMarkdown("@" + attrs["user-name"]), true
			}
			if attrs["type"] == "doc" && slices.Contains([]string{"doc", "docx", "wiki"}, attrs["file-type"]) && (attrs["doc-id"] != "" || attrs["token"] != "") && attrs["title"] != "" {
				return literalMarkdown(attrs["title"]), true
			}
		}
		return "", false
	}
	renderElement := func(raw string) string {
		if token, err := xml.NewDecoder(strings.NewReader(raw)).Token(); err == nil {
			if element, ok := token.(xml.StartElement); ok {
				if value, ok := renderInline(element); ok {
					return value
				}
			}
		}
		return raw
	}
	var transientURLs []string
	var collectURLs func(any)
	collectURLs = func(value any) {
		switch value := value.(type) {
		case map[string]any:
			for key, item := range value {
				if text, ok := item.(string); ok && slices.Contains([]string{"url", "src", "download_url", "downloadurl"}, strings.ToLower(key)) && text != "" {
					transientURLs = append(transientURLs, text)
				}
				collectURLs(item)
			}
		case []any:
			for _, item := range value {
				collectURLs(item)
			}
		}
	}
	for group, raw := range references {
		if !slices.Contains([]string{"img", "image", "images", "whiteboard", "whiteboards", "source", "sources", "file", "files"}, strings.ToLower(group)) {
			continue
		}
		var value any
		if json.Unmarshal(raw, &value) == nil {
			collectURLs(value)
		}
	}
	markdown = outsideMarkdownCode(markdown, func(text string) string {
		text = markdownComments.ReplaceAllString(text, "")
		text = markdownImage.ReplaceAllStringFunc(text, func(image string) string {
			parts := markdownImage.FindStringSubmatch(image)
			return renderImage(parts[1], parts[2])
		})
		text = markdownHTMLTable.ReplaceAllStringFunc(text, func(table string) string {
			if value, err := larkHTMLTable(table, renderInline); err == nil {
				return value
			}
			unmapped = true
			return literalMarkdown(table)
		})
		text = markdownEmptyCitation.ReplaceAllStringFunc(text, renderElement)
		text = markdownHTMLImage.ReplaceAllStringFunc(text, renderElement)
		text = markdownEmbeddedResource.ReplaceAllStringFunc(text, renderElement)
		if markdownReferenceImage.MatchString(text) {
			unmapped = true
			text = markdownReferenceImage.ReplaceAllString(text, "[图片未匹配，见资源清单]")
		}
		for _, temporary := range transientURLs {
			text = strings.ReplaceAll(text, temporary, "[临时资源地址已排除]")
		}
		return text
	})
	if len(resources) > 0 {
		markdown += "\n\n## 资源清单\n"
		for index, resource := range resources {
			if resource.Status == "saved" && resource.Kind == "html" {
				markdown += "\n- HTML 附件：" + literalMarkdown(resource.Name) + "，已归档，可在附件预览中查看。\n"
			} else if resource.Status == "saved" && resource.Kind == "sheet" {
				markdown += "\n- Sheet：" + literalMarkdown(resource.Name) + "，修订 " + resource.RevisionID + "，单元格显示值已归档。\n"
			} else if resource.Status == "saved" {
				markdown += fmt.Sprintf("\n资源 %d（%s）\n\n![资源 %d](%s)\n", index+1, resource.Kind, index+1, resource.Filename)
			} else {
				markdown += fmt.Sprintf("\n- 资源 %d（%s）：未保存，%s。\n", index+1, resource.Kind, resource.Reason)
			}
		}
	}
	return markdown, unmapped
}

func literalMarkdown(text string) string {
	var result strings.Builder
	for _, char := range text {
		if char == '\n' || char == '\r' {
			char = ' '
		}
		if strings.ContainsRune("\\`*_{}[]<>()#+-.!|~&", char) {
			result.WriteByte('\\')
		}
		result.WriteRune(char)
	}
	return result.String()
}

// Lark renders code as fenced blocks or backtick spans. Those bytes describe
// the requirement itself and must never be interpreted as resource markup.
func outsideMarkdownCode(markdown string, transform func(string) string) string {
	var output, plain strings.Builder
	flush := func() { output.WriteString(transform(plain.String())); plain.Reset() }
	var fence byte
	fenceLength, span := 0, 0
	for line := range strings.SplitAfterSeq(markdown, "\n") {
		trimmed := strings.TrimLeft(line, " ")
		indent := len(line) - len(trimmed)
		count := 0
		if len(trimmed) > 0 && (trimmed[0] == '`' || trimmed[0] == '~') {
			for count < len(trimmed) && trimmed[count] == trimmed[0] {
				count++
			}
		}
		if fence != 0 {
			output.WriteString(line)
			if indent <= 3 && len(trimmed) > 0 && trimmed[0] == fence && count >= fenceLength && strings.TrimSpace(trimmed[count:]) == "" {
				fence = 0
			}
			continue
		}
		if span == 0 && indent <= 3 && count >= 3 {
			flush()
			fence, fenceLength = trimmed[0], count
			output.WriteString(line)
			continue
		}
		for index := 0; index < len(line); {
			if line[index] == '`' {
				end := index
				for end < len(line) && line[end] == '`' {
					end++
				}
				run := end - index
				if span == 0 {
					flush()
					span = run
					output.WriteString(line[index:end])
				} else {
					output.WriteString(line[index:end])
					if run == span {
						span = 0
					}
				}
				index = end
				continue
			}
			if span > 0 {
				output.WriteByte(line[index])
			} else {
				plain.WriteByte(line[index])
			}
			index++
		}
	}
	flush()
	return output.String()
}
