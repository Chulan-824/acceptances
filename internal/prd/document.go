package prd

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
)

type Document struct {
	Source    SourceDocument
	Title     string
	Resources []Resource
	Warnings  []Warning
	Excluded  bool
}

func SanitizeDocument(source SourceDocument) (Document, error) {
	result := Document{Source: source, Resources: []Resource{}, Warnings: []Warning{}}
	result.Source.ReferenceMap = make(map[string]json.RawMessage)
	for group, raw := range source.ReferenceMap {
		if strings.Contains(strings.ToLower(group), "comment") {
			result.Excluded = true
			continue
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return Document{}, errors.New("invalid PRD references")
		}
		value, removed := removePrivateMetadata(value, isMediaElement(strings.TrimSuffix(strings.ToLower(group), "s")))
		result.Excluded = result.Excluded || removed
		result.Source.ReferenceMap[group], _ = json.Marshal(value)
	}
	if len(source.Content) > MaxBodyBytes || strings.TrimSpace(source.Content) == "" {
		return Document{}, errors.New("invalid PRD structure")
	}
	decoder := xml.NewDecoder(strings.NewReader("<acceptances-root>" + source.Content + "</acceptances-root>"))
	var content bytes.Buffer
	encoder := xml.NewEncoder(&content)
	depth, dropped, titleDepth := 0, 0, 0
	seen := make(map[string]bool)
	resourceAliases := make(map[string][]int)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return Document{}, errors.New("invalid PRD XML")
		}
		switch token := token.(type) {
		case xml.StartElement:
			depth++
			if depth > 100 {
				return Document{}, errors.New("PRD structure is too deeply nested")
			}
			if depth == 1 {
				continue
			}
			name := strings.ToLower(token.Name.Local)
			if dropped > 0 {
				dropped++
				continue
			}
			if strings.Contains(name, "comment") {
				result.Excluded, dropped = true, 1
				continue
			}
			if name == "fragment" || name == "excerpt" {
				return Document{}, errors.New("partial PRD content cannot be imported as a document")
			}
			if slices.Contains([]string{"script", "style", "iframe", "object", "embed"}, name) {
				return Document{}, errors.New("active content is not supported")
			}
			attributes := make(map[string]string)
			for _, attr := range token.Attr {
				attributes[attr.Name.Local] = attr.Value
			}
			if reference := attributes["ref"]; reference != "" {
				values, _, err := referenceValue(name, reference, result.Source.ReferenceMap)
				if err != nil {
					return Document{}, err
				}
				for key, value := range values {
					if text, ok := value.(string); ok && attributes[key] == "" {
						attributes[key] = text
					}
				}
			}
			blockID := attributes["block-id"]
			if blockID == "" {
				blockID = attributes["id"]
			}
			if resource, ok := documentResource(name, attributes, len(result.Resources)); ok && !seen[resource.Kind+"\x00"+resource.Reference] {
				alias := resource.Reference
				seen[resource.Kind+"\x00"+alias] = true
				if previous := resourceAliases[alias]; len(previous) > 0 {
					for _, index := range previous {
						result.Resources[index].Reference = result.Resources[index].Kind + ":" + alias
					}
					resource.Reference = resource.Kind + ":" + alias
				}
				resourceAliases[alias] = append(resourceAliases[alias], len(result.Resources))
				result.Resources = append(result.Resources, resource)
				if len(result.Resources) > MaxResources {
					return Document{}, errors.New("PRD contains too many resources")
				}
			}
			if !supportedElement(name) {
				result.Warnings = append(result.Warnings, Warning{Code: "UNSUPPORTED_BLOCK", Message: "此类文档块仅保留结构原文，未展开读取。", BlockID: blockID})
			}
			if name == "td" || name == "th" {
				if attributes["rowspan"] != "" && attributes["rowspan"] != "1" || attributes["colspan"] != "" && attributes["colspan"] != "1" {
					result.Warnings = append(result.Warnings, Warning{Code: "TABLE_LAYOUT_DEGRADED", Message: "合并单元格在阅读视图中可能降级。", BlockID: blockID})
				}
			}
			attrs := make([]xml.Attr, 0, len(token.Attr))
			for _, attr := range token.Attr {
				key := strings.ToLower(attr.Name.Local)
				if strings.HasPrefix(key, "on") || strings.HasPrefix(strings.ToLower(strings.TrimSpace(attr.Value)), "javascript:") {
					return Document{}, errors.New("active PRD attributes are not supported")
				}
				if strings.Contains(key, "comment") || isMediaElement(name) && (key == "url" || key == "src") {
					result.Excluded = true
					continue
				}
				attrs = append(attrs, attr)
			}
			slices.SortFunc(attrs, func(a, b xml.Attr) int {
				return strings.Compare(a.Name.Space+":"+a.Name.Local, b.Name.Space+":"+b.Name.Local)
			})
			token.Attr = attrs
			if name == "title" {
				titleDepth = depth
			}
			if err := encoder.EncodeToken(token); err != nil {
				return Document{}, err
			}
		case xml.EndElement:
			if dropped > 0 {
				dropped--
				depth--
				continue
			}
			if titleDepth == depth {
				titleDepth = 0
			}
			if depth > 1 {
				if err := encoder.EncodeToken(token); err != nil {
					return Document{}, err
				}
			}
			depth--
		case xml.CharData:
			if dropped > 0 || depth == 1 && strings.TrimSpace(string(token)) == "" {
				continue
			}
			if titleDepth > 0 {
				result.Title += string(token)
			}
			if err := encoder.EncodeToken(token); err != nil {
				return Document{}, err
			}
		case xml.Comment:
			result.Excluded = true
		case xml.Directive, xml.ProcInst:
			return Document{}, errors.New("PRD XML declarations are not supported")
		}
	}
	if err := encoder.Flush(); err != nil {
		return Document{}, err
	}
	result.Source.Content = content.String()
	result.Title = strings.TrimSpace(result.Title)
	return result, nil
}

// Reference aliases are scoped to their block-type group in the CLI response.
// If a future format is ambiguous, reject it rather than selecting a map entry.
func referenceValue(element, alias string, groups map[string]json.RawMessage) (map[string]any, string, error) {
	type match struct {
		group string
		value map[string]any
	}
	var matches, preferred []match
	category := func(name string) string {
		name = strings.TrimSuffix(strings.ToLower(name), "s")
		switch name {
		case "img", "image":
			return "image"
		case "a", "link":
			return "link"
		}
		return name
	}
	for group, raw := range groups {
		var values map[string]map[string]any
		if json.Unmarshal(raw, &values) != nil {
			return nil, "", errors.New("invalid PRD reference group")
		}
		if value, ok := values[alias]; ok {
			item := match{group, value}
			matches = append(matches, item)
			if category(group) == category(element) {
				preferred = append(preferred, item)
			}
		}
	}
	if len(preferred) == 1 {
		return preferred[0].value, preferred[0].group, nil
	}
	if len(matches) == 1 {
		return matches[0].value, matches[0].group, nil
	}
	if len(matches) == 0 {
		return nil, "", nil
	}
	return nil, "", errors.New("ambiguous PRD reference alias")
}

func removePrivateMetadata(value any, media bool) (any, bool) {
	removed := false
	switch value := value.(type) {
	case map[string]any:
		for key, nested := range value {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "comment") || slices.Contains([]string{"access_token", "refresh_token", "authorization", "app_secret"}, lower) || media && slices.Contains([]string{"url", "src", "download_url", "downloadurl"}, lower) {
				delete(value, key)
				removed = true
				continue
			}
			clean, changed := removePrivateMetadata(nested, media)
			value[key] = clean
			removed = removed || changed
		}
		return value, removed
	case []any:
		for index, nested := range value {
			clean, changed := removePrivateMetadata(nested, media)
			value[index] = clean
			removed = removed || changed
		}
		return value, removed
	default:
		return value, false
	}
}

func documentResource(name string, attrs map[string]string, index int) (Resource, bool) {
	kind := name
	switch name {
	case "img", "image":
		kind = "image"
	case "whiteboard":
	case "source", "file", "sheet", "bitable", "synced_reference", "cite", "vc-transcribe-tab":
	default:
		return Resource{}, false
	}
	reference := attrs["ref"]
	if reference == "" {
		reference = fmt.Sprintf("resource-%d", index+1)
	}
	resourceID := ""
	for _, key := range []string{"token", "file-token", "file_token", "whiteboard_id", "src-token"} {
		if attrs[key] != "" {
			resourceID = attrs[key]
			break
		}
	}
	resource := Resource{Reference: reference, ResourceID: resourceID, Kind: kind, Name: attrs["name"], BlockID: attrs["block-id"], Status: "unsupported", Reason: "UNSUPPORTED_EMBED"}
	if resource.BlockID == "" {
		resource.BlockID = attrs["id"]
	}
	if kind == "image" || kind == "whiteboard" {
		resource.Status, resource.Reason = "missing", "RESOURCE_NOT_DOWNLOADED"
		if resourceID == "" {
			resource.Reason = "NO_RESOURCE_TOKEN"
		}
	}
	return resource, true
}

func isMediaElement(name string) bool {
	return name == "img" || name == "image" || name == "whiteboard" || name == "source" || name == "file"
}

func supportedElement(name string) bool {
	return strings.Contains("|doc|document|body|content|section|div|column|columns|col|table|tr|thead|tbody|td|th|p|para|title|h1|h2|h3|h4|h5|h6|h7|h8|h9|li|ul|ol|todo|list|code|pre|hr|br|a|link|u|b|s|i|span|strong|em|text|quote|blockquote|callout|mention|user|equation|latex|date|inline-code|inline_code|highlight|font|sup|sub|math|line-break|divider|cell|row|task|caption|img|image|whiteboard|source|file|", "|"+name+"|")
}
