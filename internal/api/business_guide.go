package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
)

// BusinessGuide is independently authored prose, never a replacement Report.
// Images may only reference files already retained by this delivery.
type BusinessGuide struct {
	SchemaVersion int            `json:"schemaVersion"`
	Title         string         `json:"title"`
	Summary       string         `json:"summary"`
	Modules       []GuideModule  `json:"modules"`
	Pages         []GuidePage    `json:"pages"`
	Sections      []GuideSection `json:"sections"`
	Review        []string       `json:"review"`
	Limitations   []string       `json:"limitations"`
}

type GuideModule struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type GuidePage struct {
	Audience    string       `json:"audience"`
	Title       string       `json:"title"`
	Entry       string       `json:"entry"`
	Instruction string       `json:"instruction"`
	Images      []GuideImage `json:"images"`
}

type GuideSection struct {
	Title   string       `json:"title"`
	Summary string       `json:"summary"`
	Blocks  []GuideBlock `json:"blocks"`
}

// A small set of text-only blocks keeps authoring independent of HTML/CSS/JS.
type GuideBlock struct {
	Kind    string       `json:"kind"`
	Text    string       `json:"text,omitempty"`
	Items   []string     `json:"items,omitempty"`
	Columns []string     `json:"columns,omitempty"`
	Rows    [][]string   `json:"rows,omitempty"`
	Images  []GuideImage `json:"images,omitempty"`
}

type GuideRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type GuideAnnotation struct {
	GuideRegion
	Label string `json:"label"`
}

type GuideImage struct {
	Path        string            `json:"path"`
	Caption     string            `json:"caption"`
	Kind        string            `json:"kind"` // actual or sample, explicitly authored
	Crop        *GuideRegion      `json:"crop,omitempty"`
	Annotations []GuideAnnotation `json:"annotations,omitempty"`
}

func validateBusinessGuide(guide BusinessGuide, snapshot DeliverySnapshot) error {
	if guide.SchemaVersion != 1 || strings.TrimSpace(guide.Title) == "" || strings.TrimSpace(guide.Summary) == "" || len(guide.Modules) == 0 || len(guide.Sections) == 0 || len(guide.Review) == 0 {
		return fmt.Errorf("指南须包含标题、简介、涉及模块、使用步骤章节和业务确认清单。")
	}
	if len(guide.Modules) > 100 || len(guide.Pages) > 200 || len(guide.Sections) > 50 {
		return fmt.Errorf("指南模块、页面或章节过多。")
	}
	files := map[string]ArchivedFile{}
	for _, file := range snapshot.Payload.Files {
		files[file.Path] = file
	}
	var imageCount int
	var imageBytes int64
	validateImages := func(images []GuideImage) error {
		for _, image := range images {
			file, exists := files[image.Path]
			if !exists || !validName(image.Path) || strings.TrimSpace(image.Caption) == "" || (image.Kind != "actual" && image.Kind != "sample") {
				return fmt.Errorf("指南图片须引用本交付的附件，并填写说明及 actual/sample 类型：%s", image.Path)
			}
			imageCount++
			imageBytes += file.Size
			if imageCount > 128 || imageBytes > 64<<20 || len(image.Annotations) > 30 {
				return fmt.Errorf("指南图片或标注过多，图片合计不能超过 64 MiB。")
			}
			if image.Crop != nil && !validGuideRegion(*image.Crop) {
				return fmt.Errorf("图片局部范围须在 0–100%% 以内。")
			}
			for _, mark := range image.Annotations {
				if !validGuideRegion(mark.GuideRegion) || strings.TrimSpace(mark.Label) == "" {
					return fmt.Errorf("图片标注须填写说明，位置须在 0–100%% 以内。")
				}
			}
		}
		return nil
	}
	for _, module := range guide.Modules {
		if strings.TrimSpace(module.Title) == "" || strings.TrimSpace(module.Description) == "" {
			return fmt.Errorf("涉及模块须填写名称和说明。")
		}
	}
	for _, page := range guide.Pages {
		if strings.TrimSpace(page.Title) == "" || strings.TrimSpace(page.Entry) == "" || strings.TrimSpace(page.Instruction) == "" {
			return fmt.Errorf("涉及页面须填写名称、入口和操作说明。")
		}
		if err := validateImages(page.Images); err != nil {
			return err
		}
	}
	for _, section := range guide.Sections {
		if strings.TrimSpace(section.Title) == "" || len(section.Blocks) == 0 || len(section.Blocks) > 100 {
			return fmt.Errorf("使用步骤章节须填写标题和内容。")
		}
		for _, block := range section.Blocks {
			if block.Kind != "images" && len(block.Images) != 0 {
				return fmt.Errorf("图片只能放在 images 段落中。")
			}
			switch block.Kind {
			case "heading", "paragraph", "note", "quote":
				if strings.TrimSpace(block.Text) == "" {
					return fmt.Errorf("文字段落不能为空。")
				}
			case "steps", "confirmations":
				if len(block.Items) == 0 {
					return fmt.Errorf("步骤或确认内容不能为空。")
				}
			case "table":
				if len(block.Columns) == 0 || len(block.Rows) == 0 || len(block.Columns) > 10 {
					return fmt.Errorf("状态说明表格须包含表头和内容。")
				}
				for _, row := range block.Rows {
					if len(row) != len(block.Columns) {
						return fmt.Errorf("状态说明表格的列数不一致。")
					}
				}
			case "images":
				if len(block.Images) == 0 {
					return fmt.Errorf("图片段落不能为空。")
				}
				if err := validateImages(block.Images); err != nil {
					return err
				}
			default:
				return fmt.Errorf("不支持的指南段落类型：%s", block.Kind)
			}
		}
	}
	return nil
}

func validGuideRegion(region GuideRegion) bool {
	for _, value := range []float64{region.X, region.Y, region.Width, region.Height} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return region.X >= 0 && region.Y >= 0 && region.Width > 0 && region.Height > 0 && region.X+region.Width <= 100 && region.Y+region.Height <= 100
}

// The fallback presents material prose only. Detailed page/state examples can
// be authored through the same schema without attaching files to a closed Run.
func guideFromMaterials(snapshot DeliverySnapshot) BusinessGuide {
	guide := BusinessGuide{SchemaVersion: 1, Title: snapshot.Payload.Campaign.Title + " · 业务使用指南", Summary: "了解本次涉及的功能、操作方法和页面展示，并按日常使用顺序确认效果。", Pages: []GuidePage{}, Limitations: []string{}}
	titles := map[string]string{}
	for _, feature := range snapshot.Payload.Map.Features {
		titles[feature.ID] = feature.Title
	}
	for _, feature := range snapshot.Payload.Materials.Features {
		title := titles[feature.FeatureID]
		guide.Modules = append(guide.Modules, GuideModule{Title: title, Description: feature.Summary})
		section := GuideSection{Title: title, Summary: feature.Summary, Blocks: []GuideBlock{}}
		if len(feature.Roles) > 0 {
			section.Blocks = append(section.Blocks, GuideBlock{Kind: "paragraph", Text: "适用角色：" + strings.Join(feature.Roles, "、")})
		}
		for _, prerequisite := range feature.Prerequisites {
			section.Blocks = append(section.Blocks, GuideBlock{Kind: "note", Text: prerequisite})
		}
		var steps []string
		for _, step := range feature.Steps {
			steps = append(steps, step.Instruction+"；页面应显示："+step.Expected)
		}
		section.Blocks = append(section.Blocks, GuideBlock{Kind: "steps", Items: steps})
		// Legacy materials do not identify sample images. Do not silently label
		// them as real pages: an author must classify them in the guide input.
		if len(feature.Screenshots) > 0 {
			section.Blocks = append(section.Blocks, GuideBlock{Kind: "note", Text: "本功能的页面图示尚待整理，请补充页面入口，并区分实际页面与演示样例。"})
		}
		guide.Sections = append(guide.Sections, section)
		guide.Review = append(guide.Review, "按“"+title+"”的步骤查看，确认入口、文字与操作结果是否清楚。")
		guide.Limitations = append(guide.Limitations, feature.Limitations...)
	}
	return guide
}

func (s *Server) businessGuideMaterials(deliveryID string) (BusinessGuide, error) {
	var raw string
	err := s.db.QueryRow("SELECT guide FROM business_documents WHERE delivery_id=? AND kind='business_guide' AND status='succeeded' ORDER BY version DESC LIMIT 1", deliveryID).Scan(&raw)
	if err == nil {
		var guide BusinessGuide
		if err = json.Unmarshal([]byte(raw), &guide); err != nil {
			return guide, err
		}
		return guide, nil
	}
	if err != sql.ErrNoRows {
		return BusinessGuide{}, err
	}
	snapshot, err := s.delivery(deliveryID)
	if err != nil {
		return BusinessGuide{}, err
	}
	return guideFromMaterials(snapshot), nil
}

func (s *Server) downloadBusinessGuideMaterials(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	guide, err := s.businessGuideMaterials(r.PathValue("id"))
	if err != nil {
		lookupFailure(w, r, err, "DELIVERY_NOT_FOUND")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="business-guide-materials.json"`)
	respond(w, 200, guide)
}
