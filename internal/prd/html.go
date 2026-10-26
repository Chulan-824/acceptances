package prd

import (
	"bytes"
	"errors"
	"slices"
	"strings"

	"golang.org/x/net/html"
)

const HTMLPreviewPolicy = "sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"

// HTML attachments stay byte-identical; only the separate preview is reduced to static HTML.
func HTMLPreview(data []byte) ([]byte, error) {
	if len(data) > MaxResourceBytes {
		return nil, errors.New("HTML preview exceeds its limit")
	}
	source, err := html.Parse(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	result := &html.Node{Type: html.DocumentNode}
	var copyNode func(*html.Node, *html.Node, int) error
	copyNode = func(node, parent *html.Node, depth int) error {
		if depth > 100 {
			return errors.New("HTML preview is too deeply nested")
		}
		if node.Type == html.TextNode {
			parent.AppendChild(&html.Node{Type: html.TextNode, Data: node.Data})
			return nil
		}
		if node.Type != html.ElementNode && node.Type != html.DocumentNode {
			return nil
		}
		if slices.Contains([]string{"script", "iframe", "object", "embed", "svg", "math", "template", "noscript", "meta", "base", "link"}, node.Data) {
			return nil
		}
		if strings.Contains("|html|head|body|title|style|div|span|main|section|article|header|footer|nav|aside|h1|h2|h3|h4|h5|h6|p|br|hr|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|colgroup|col|caption|b|strong|i|em|u|s|del|small|sup|sub|blockquote|pre|code|a|img|button|label|details|summary|", "|"+node.Data+"|") {
			clone := &html.Node{Type: html.ElementNode, Data: node.Data}
			for _, attr := range node.Attr {
				if attr.Namespace != "" {
					continue
				}
				if slices.Contains([]string{"class", "id", "title", "alt", "style", "lang", "dir", "width", "height", "rowspan", "colspan", "start"}, attr.Key) || attr.Key == "src" && node.Data == "img" && slices.Contains([]string{"data:image/png;base64", "data:image/jpeg;base64", "data:image/gif;base64", "data:image/webp;base64"}, strings.SplitN(attr.Val, ",", 2)[0]) {
					clone.Attr = append(clone.Attr, attr)
				}
			}
			if node.Data == "button" {
				clone.Attr = append(clone.Attr, html.Attribute{Key: "disabled"})
			}
			parent.AppendChild(clone)
			parent = clone
			if node.Data == "head" {
				clone.AppendChild(&html.Node{Type: html.ElementNode, Data: "meta", Attr: []html.Attribute{{Key: "http-equiv", Val: "Content-Security-Policy"}, {Key: "content", Val: "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"}}})
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if err := copyNode(child, parent, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := copyNode(source, result, 0); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	if err := html.Render(&output, result); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
