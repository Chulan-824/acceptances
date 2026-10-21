package api

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html/template"
	"image"
	"io"
	"os"

	webassets "github.com/Chulan-824/acceptances/apps/web"
)

//go:embed business_guide.html
var guideHTML string

type guideImageView struct {
	GuideImage
	URL           template.URL
	Width, Height int
	ViewBox       string
}

type guideBlockView struct {
	GuideBlock
	Pictures []guideImageView
}

type guideSectionView struct {
	GuideSection
	ID      string
	Content []guideBlockView
}

type guidePageView struct {
	GuidePage
	ID       string
	Pictures []guideImageView
}

type guideView struct {
	Guide    BusinessGuide
	Version  int
	Sections []guideSectionView
	Pages    []guidePageView
}

var guideTemplate = template.Must(template.New("guide").Funcs(template.FuncMap{
	"offlineTheme": func() template.CSS { return template.CSS(webassets.OfflineThemeCSS) },
	"fontLicense":  func() string { return webassets.FontLicense },
	"number":       func(index int) int { return index + 1 },
	"markStyle": func(mark GuideAnnotation) template.CSS {
		// Percentages have already been checked; caller text is never CSS.
		return template.CSS(fmt.Sprintf("left:%g%%;top:%g%%;width:%g%%;height:%g%%", mark.X, mark.Y, mark.Width, mark.Height))
	},
}).Parse(guideHTML))

func renderBusinessGuide(output io.Writer, root *os.Root, snapshot DeliverySnapshot, document BusinessDocument) error {
	if document.Guide == nil {
		return fmt.Errorf("业务指南素材缺失")
	}
	if err := validateBusinessGuide(*document.Guide, snapshot); err != nil {
		return err
	}
	if err := verifyFrozenDocumentEvidence(root, snapshot); err != nil {
		return err
	}
	renderImages := func(images []GuideImage) ([]guideImageView, error) {
		pictures := make([]guideImageView, 0, len(images))
		for _, picture := range images {
			data, kind, err := readDocumentationImage(root, picture.Path)
			if err != nil {
				return nil, err
			}
			config, _, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil {
				return nil, fmt.Errorf("读取指南图片尺寸: %w", err)
			}
			view := guideImageView{GuideImage: picture, URL: template.URL("data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data)), Width: config.Width, Height: config.Height}
			if crop := picture.Crop; crop != nil {
				view.ViewBox = fmt.Sprintf("%g %g %g %g", float64(config.Width)*crop.X/100, float64(config.Height)*crop.Y/100, float64(config.Width)*crop.Width/100, float64(config.Height)*crop.Height/100)
			}
			pictures = append(pictures, view)
		}
		return pictures, nil
	}
	view := guideView{Guide: *document.Guide, Version: document.Version}
	for index, section := range document.Guide.Sections {
		item := guideSectionView{GuideSection: section, ID: fmt.Sprintf("feature-%d", index+1)}
		for _, block := range section.Blocks {
			pictures, err := renderImages(block.Images)
			if err != nil {
				return err
			}
			item.Content = append(item.Content, guideBlockView{GuideBlock: block, Pictures: pictures})
		}
		view.Sections = append(view.Sections, item)
	}
	for index, page := range document.Guide.Pages {
		pictures, err := renderImages(page.Images)
		if err != nil {
			return err
		}
		view.Pages = append(view.Pages, guidePageView{GuidePage: page, ID: fmt.Sprintf("page-%d", index+1), Pictures: pictures})
	}
	return guideTemplate.Execute(output, view)
}
