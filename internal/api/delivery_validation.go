package api

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
)

var stableIdentity = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,199}$`)

func validateVerificationMap(m VerificationMap, prep DeliveryPreparation) error {
	if m.SchemaVersion != 1 || m.ProjectID != prep.Project.ID || m.RequirementSHA256 != prep.Manifest.Requirement.SHA256 || len(m.Features) == 0 {
		return fmt.Errorf("需求地图的版本、归属、需求摘要或功能列表无效。")
	}
	actual := map[string]Check{}
	for _, check := range prep.Run.Report.Checks {
		actual[check.ID] = check
	}
	features, checks := map[string]bool{}, map[string]bool{}
	for _, feature := range m.Features {
		if !stableIdentity.MatchString(feature.ID) || features[feature.ID] || strings.TrimSpace(feature.Title) == "" || len(feature.Checks) == 0 {
			return fmt.Errorf("地图功能 ID 须唯一、稳定且有标题和检查项。")
		}
		features[feature.ID] = true
		required := 0
		for _, check := range feature.Checks {
			if !stableIdentity.MatchString(check.ID) || checks[check.ID] || strings.TrimSpace(check.Title) == "" || strings.TrimSpace(check.Expected) == "" {
				return fmt.Errorf("地图检查项 ID 须唯一、稳定且有明确预期。")
			}
			checks[check.ID] = true
			item, exists := actual[check.ID]
			if check.Required {
				required++
				if !exists {
					return fmt.Errorf("最终 Run 缺少必验项 %s，不能跨轮补齐。", check.ID)
				}
			}
			if exists && strings.TrimSpace(item.Expected) != strings.TrimSpace(check.Expected) {
				return fmt.Errorf("检查项 %s 的地图预期与受验报告不一致。", check.ID)
			}
		}
		if required == 0 {
			return fmt.Errorf("交付范围中的功能 %s 至少需要一个必验项；范围外内容请明确列为排除。", feature.ID)
		}
	}
	if !nonemptyStrings(m.Excluded) {
		return fmt.Errorf("排除范围不能包含空白文字。")
	}
	return nil
}

func validateDocumentationMaterials(root fs.FS, m DocumentationMaterials, prep DeliveryPreparation) error {
	if m.SchemaVersion != 1 || m.ProjectID != prep.Project.ID || m.RequirementSHA256 != prep.Manifest.Requirement.SHA256 || m.MapSHA256 != prep.Manifest.Map.SHA256 {
		return fmt.Errorf("说明素材的版本、归属或需求/地图摘要不匹配。")
	}
	features := map[string]MapFeature{}
	for _, feature := range prep.Map.Features {
		features[feature.ID] = feature
	}
	actual := map[string]Check{}
	for _, check := range prep.Run.Report.Checks {
		actual[check.ID] = check
	}
	seen := map[string]bool{}
	var imageBytes int
	for _, feature := range m.Features {
		mapped, exists := features[feature.FeatureID]
		if !exists || seen[feature.FeatureID] || strings.TrimSpace(feature.Summary) == "" || len(feature.Roles) == 0 || !nonemptyStrings(feature.Roles) || !nonemptyStrings(feature.Prerequisites) || !nonemptyStrings(feature.Limitations) || len(feature.Steps) == 0 {
			return fmt.Errorf("说明功能须唯一对应地图，并有说明、角色、前提、步骤及限制。")
		}
		seen[feature.FeatureID] = true
		allowed := map[string]bool{}
		exceptional := false
		for _, check := range mapped.Checks {
			if item, exists := actual[check.ID]; exists {
				allowed[check.ID] = true
				exceptional = exceptional || item.Status != "passed"
			}
		}
		if exceptional && len(feature.Limitations) == 0 {
			return fmt.Errorf("功能 %s 包含原始未通过项，必须写明业务限制。", feature.FeatureID)
		}
		for _, step := range feature.Steps {
			if strings.TrimSpace(step.Instruction) == "" || strings.TrimSpace(step.Expected) == "" || !validCheckReferences(step.CheckIDs, allowed) {
				return fmt.Errorf("功能 %s 的每步需有操作、预期和本轮检查项关联。", feature.FeatureID)
			}
		}
		if len(feature.Screenshots) == 0 && strings.TrimSpace(feature.ScreenshotOmissionReason) == "" {
			return fmt.Errorf("功能 %s 缺少对应截图，须明确说明缺图原因。", feature.FeatureID)
		}
		for _, screenshot := range feature.Screenshots {
			if strings.TrimSpace(screenshot.Caption) == "" || !validCheckReferences(screenshot.CheckIDs, allowed) {
				return fmt.Errorf("截图须有说明及该功能的本轮检查项关联。")
			}
			for _, checkID := range screenshot.CheckIDs {
				declared := false
				for _, path := range actual[checkID].Evidence {
					declared = declared || path == screenshot.Path
				}
				if !declared {
					return fmt.Errorf("截图 %s 不属于检查项 %s 的实际证据。", screenshot.Path, checkID)
				}
			}
			data, _, err := readDocumentationImage(root, screenshot.Path)
			if err != nil {
				return err
			}
			imageBytes += len(data)
			if imageBytes > 32<<20 {
				return fmt.Errorf("说明截图合计超过 32 MiB，请在发布前缩减图片。")
			}
		}
	}
	if len(seen) != len(features) {
		return fmt.Errorf("说明素材必须覆盖交付地图中的全部功能。")
	}
	return nil
}

func nonemptyStrings(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return false
		}
	}
	return true
}

func validCheckReferences(values []string, allowed map[string]bool) bool {
	if len(values) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, value := range values {
		if !allowed[value] || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func readDocumentationImage(root fs.FS, name string) ([]byte, string, error) {
	if !validName(name) {
		return nil, "", fmt.Errorf("截图仅允许单层附件文件名。")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, "", fmt.Errorf("截图 %s 无法读取。", name)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (10<<20)+1))
	if err != nil || len(data) > 10<<20 {
		return nil, "", fmt.Errorf("截图 %s 无法读取或超过 10 MiB。", name)
	}
	mime := http.DetectContentType(data)
	if mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" {
		return nil, "", fmt.Errorf("说明截图 %s 必须是实际 PNG、JPEG 或 GIF，不接受脚本、SVG 或外部地址。", name)
	}
	extension := strings.ToLower(filepath.Ext(name))
	if (mime == "image/png" && extension != ".png") || (mime == "image/jpeg" && extension != ".jpg" && extension != ".jpeg") || (mime == "image/gif" && extension != ".gif") {
		return nil, "", fmt.Errorf("截图 %s 的文件扩展名与实际图片格式不一致。", name)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, "", fmt.Errorf("截图 %s 格式或尺寸无效。", name)
	}
	return data, mime, nil
}
