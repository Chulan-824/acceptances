package api

import (
	"encoding/base64"
	"fmt"
	"html/template"
	"io"
	"os"
)

type renderedScreenshot struct {
	URL      template.URL
	Caption  string
	CheckIDs []string
}
type renderedFeature struct {
	ID    string
	Title string
	DocumentationFeature
	Images []renderedScreenshot
	Checks []Check
}
type documentView struct {
	Snapshot DeliverySnapshot
	Document BusinessDocument
	Features []renderedFeature
}

func verificationLabel(status string) string {
	switch status {
	case "passed":
		return "通过"
	case "failed":
		return "失败，人工已接受"
	case "blocked":
		return "阻塞，人工已接受"
	case "skipped":
		return "未执行，人工已接受"
	default:
		return status
	}
}

var businessTemplate = template.Must(template.New("business").Funcs(template.FuncMap{"verificationLabel": verificationLabel}).Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>{{.Snapshot.Payload.Campaign.Title}} · 业务说明</title>
<style>
body{font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;color:#0f172a;background:#f8fafc;margin:0}main{max-width:960px;margin:auto;padding:32px 24px;background:white}h1{font-size:28px}h2{margin-top:40px;border-bottom:1px solid #cbd5e1;padding-bottom:8px}h3{font-size:18px}p,li,td,code{overflow-wrap:anywhere}code{font:13px/1.5 monospace}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#334155}img{max-width:100%;height:auto;border:1px solid #e2e8f0}figure{margin:24px 0}figcaption,.metadata{font-size:14px;color:#475569}.notice{border-left:4px solid #a16207;background:#fefce8;padding:12px 16px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left}.step{margin-bottom:16px}@media print{body,main{background:white}main{padding:0}section,figure{break-inside:avoid}}
</style></head><body><main>
<header><p class="metadata">{{.Snapshot.Payload.Project.Name}} · 交付 v{{.Snapshot.Version}} · 说明 v{{.Document.Version}}</p>
<h1>{{.Snapshot.Payload.Campaign.Title}}</h1><p>{{.Snapshot.Payload.Campaign.Description}}</p>
<p class="notice">此文档根据已人工确认的交付材料生成，可离线阅读。原始验证结果与人工接受分别记录。文件不会随后续改判自动更新，交付当前效力以 Acceptances 中的记录为准。</p>
<nav aria-label="功能目录">{{range .Features}}<a href="#{{.ID}}">{{.Title}}</a>{{end}}<a href="#sources">版本与来源</a></nav></header>
{{range .Features}}<section id="{{.ID}}"><h2>{{.Title}}</h2><p>{{.Summary}}</p>
<h3>适用角色</h3><ul>{{range .Roles}}<li>{{.}}</li>{{end}}</ul>
<h3>操作前提</h3>{{if .Prerequisites}}<ul>{{range .Prerequisites}}<li>{{.}}</li>{{end}}</ul>{{else}}<p>素材未声明额外前提。</p>{{end}}
<h3>操作步骤</h3><ol>{{range .Steps}}<li class="step"><p>{{.Instruction}}</p><p>预期结果：{{.Expected}}</p><p class="metadata">对应检查：{{range .CheckIDs}}<code>{{.}}</code> {{end}}</p></li>{{end}}</ol>
<h3>限制与注意事项</h3>{{if .Limitations}}<ul>{{range .Limitations}}<li>{{.}}</li>{{end}}</ul>{{else}}<p>素材未声明额外限制。</p>{{end}}
{{range .Images}}<figure><img src="{{.URL}}" alt="{{.Caption}}"><figcaption>{{.Caption}} · 对应检查 {{range .CheckIDs}}<code>{{.}}</code> {{end}}</figcaption></figure>{{end}}
{{if .ScreenshotOmissionReason}}<p class="notice">截图说明：{{.ScreenshotOmissionReason}}</p>{{end}}
<h3>验证依据</h3><table><thead><tr><th>检查项</th><th>原始结果</th><th>冻结时人审</th></tr></thead><tbody>{{range .Checks}}<tr><td>{{.Title}}<br><code>{{.ID}}</code></td><td>{{verificationLabel .Status}}</td><td>人工接受</td></tr>{{end}}</tbody></table>
</section>{{end}}
<section id="sources"><h2>版本与来源</h2>
<p>验证范围：{{.Snapshot.Payload.Run.Report.Scope}}</p>
{{if .Snapshot.Payload.Map.Excluded}}<h3>排除范围</h3><ul>{{range .Snapshot.Payload.Map.Excluded}}<li>{{.}}</li>{{end}}</ul>{{end}}
<p>实际验证时间：{{.Snapshot.Payload.Run.Report.VerifiedAt}}<br>验证环境：{{.Snapshot.Payload.Run.Report.Environment}}</p>
<table><thead><tr><th>代码来源</th><th>受验提交</th></tr></thead><tbody>{{range .Snapshot.Payload.Run.Report.Versions}}<tr><td>{{.Repository}}</td><td><code>{{.Commit}}</code></td></tr>{{end}}</tbody></table>
{{if eq .Snapshot.Payload.Manifest.Build.Kind "artifact"}}<p>实际构建：{{.Snapshot.Payload.Manifest.Build.ID}}<br>产物摘要：<code>{{.Snapshot.Payload.Manifest.Build.Artifact.SHA256}}</code></p>{{else}}<p>无需构建：{{.Snapshot.Payload.Manifest.Build.Reason}}</p>{{end}}
<p class="metadata">交付快照：<code>{{.Snapshot.ID}}</code><br>快照内容摘要：<code>{{.Snapshot.SHA256}}</code><br>来源 Run：<code>{{.Snapshot.Payload.Run.ID}}</code><br>需求摘要：<code>{{.Snapshot.Payload.Manifest.Requirement.SHA256}}</code><br>地图摘要：<code>{{.Snapshot.Payload.Manifest.Map.SHA256}}</code><br>素材摘要：<code>{{.Snapshot.Payload.Manifest.Materials.SHA256}}</code><br>说明版本：{{.Document.Version}} · 模板：{{.Document.TemplateVersion}} · 创建时间：{{.Document.CreatedAt}}</p>
</section></main></body></html>`))

func renderBusinessDocument(output io.Writer, root *os.Root, snapshot DeliverySnapshot, document BusinessDocument) error {
	files, err := archiveFiles(root, snapshot.Payload.Run.Report.Evidence)
	if err != nil {
		return err
	}
	if len(files) != len(snapshot.Payload.Files) {
		return fmt.Errorf("frozen evidence integrity failure")
	}
	for index := range files {
		if files[index] != snapshot.Payload.Files[index] {
			return fmt.Errorf("frozen evidence changed: %s", files[index].Path)
		}
	}
	materials := map[string]DocumentationFeature{}
	for _, feature := range snapshot.Payload.Materials.Features {
		materials[feature.FeatureID] = feature
	}
	checks := map[string]Check{}
	for _, check := range snapshot.Payload.Run.Report.Checks {
		checks[check.ID] = check
	}
	view := documentView{Snapshot: snapshot, Document: document, Features: []renderedFeature{}}
	for _, feature := range snapshot.Payload.Map.Features {
		material, exists := materials[feature.ID]
		if !exists {
			return fmt.Errorf("frozen documentation feature missing")
		}
		rendered := renderedFeature{ID: feature.ID, Title: feature.Title, DocumentationFeature: material, Images: []renderedScreenshot{}, Checks: []Check{}}
		for _, reference := range feature.Checks {
			if check, exists := checks[reference.ID]; exists {
				rendered.Checks = append(rendered.Checks, check)
			}
		}
		for _, screenshot := range material.Screenshots {
			data, kind, err := readDocumentationImage(root, screenshot.Path)
			if err != nil {
				return err
			}
			// Only validated raster bytes construct this URL; no caller-provided
			// HTML, template, URI scheme or external address enters trusted output.
			url := template.URL("data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data))
			rendered.Images = append(rendered.Images, renderedScreenshot{URL: url, Caption: screenshot.Caption, CheckIDs: screenshot.CheckIDs})
		}
		view.Features = append(view.Features, rendered)
	}
	return businessTemplate.Execute(output, view)
}
