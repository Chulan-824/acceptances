package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Chulan-824/acceptances/internal/prd"
)

type larkReader struct{ executable, profile, realm, identity, version string }
type larkEnvelope struct {
	OK       bool            `json:"ok"`
	Identity string          `json:"identity"`
	Data     json.RawMessage `json:"data"`
	Error    struct {
		Type       string      `json:"type"`
		Subtype    string      `json:"subtype"`
		Code       int         `json:"code"`
		RetryAfter json.Number `json:"retry_after_seconds"`
	} `json:"error"`
}
type larkDocument struct {
	DocumentID   string                     `json:"document_id"`
	RevisionID   json.Number                `json:"revision_id"`
	Content      string                     `json:"content"`
	ReferenceMap map[string]json.RawMessage `json:"reference_map"`
	Tips         string                     `json:"tips"`
}

func newLarkReader(ctx context.Context) (*larkReader, error) {
	path, err := exec.LookPath("lark-cli")
	if err != nil {
		return nil, larkProblem("LARK_CLI_REQUIRED：请先安装并授权 Lark CLI 1.0.98")
	}
	r := &larkReader{executable: path}
	raw, err := r.command(ctx, "", 64<<10, false, "--version")
	if err != nil {
		return nil, err
	}
	r.version = strings.TrimSpace(strings.TrimPrefix(string(raw), "lark-cli version "))
	if r.version != "1.0.98" {
		return nil, larkProblem("LARK_CLI_VERSION_UNSUPPORTED：当前连接器支持 Lark CLI 1.0.98")
	}
	raw, err = r.command(ctx, "", 64<<10, false, "profile", "list")
	if err != nil {
		return nil, err
	}
	var profiles []struct {
		Name, Brand string
		Effective   bool
	}
	if json.Unmarshal(raw, &profiles) != nil {
		return nil, larkProblem("LARK_INVALID_RESULT")
	}
	for _, profile := range profiles {
		if profile.Effective {
			if r.profile != "" {
				return nil, larkProblem("LARK_IDENTITY_CHANGED")
			}
			r.profile, r.realm = profile.Name, profile.Brand
		}
	}
	if r.profile == "" || r.realm != "feishu" && r.realm != "lark" {
		return nil, larkProblem("LARK_PROFILE_REQUIRED")
	}
	r.identity, err = r.checkIdentity(ctx)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (r *larkReader) checkIdentity(ctx context.Context) (string, error) {
	raw, err := r.command(ctx, "", 64<<10, false, "auth", "status", "--json", "--verify")
	if err != nil {
		return "", err
	}
	var status struct {
		AppID      string `json:"appId"`
		Brand      string `json:"brand"`
		Identity   string `json:"identity"`
		Identities struct {
			User struct {
				OpenID   string `json:"openId"`
				Verified bool   `json:"verified"`
			} `json:"user"`
		} `json:"identities"`
	}
	if json.Unmarshal(raw, &status) != nil || status.AppID == "" || status.Identities.User.OpenID == "" || !status.Identities.User.Verified || status.Identity != "user" {
		return "", &larkError{Code: "LARK_AUTH_REQUIRED", Stop: true}
	}
	identity := status.Brand + "\x00" + status.AppID + "\x00" + status.Identities.User.OpenID
	if status.Brand != r.realm || r.identity != "" && r.identity != identity {
		return "", &larkError{Code: "LARK_IDENTITY_CHANGED", Stop: true}
	}
	return identity, nil
}

func (r *larkReader) fetch(ctx context.Context, rawURL string) (prd.Bundle, error) {
	source, err := prd.NormalizeURL(rawURL)
	if err != nil {
		return prd.Bundle{}, larkProblem("LARK_UNSUPPORTED_DOCUMENT")
	}
	if source.Realm != r.realm {
		return prd.Bundle{}, larkProblem("LARK_REALM_MISMATCH")
	}
	for attempt := range 3 {
		if attempt > 0 && !larkWait(ctx, larkBackoff(attempt, 0)) {
			return prd.Bundle{}, larkProblem("CONNECTOR_CANCELLED")
		}
		bundle, err := r.fetchRevision(ctx, source)
		if err == nil || asLarkError(err).Code != "LARK_VERSION_CHANGED" {
			return bundle, err
		}
	}
	return prd.Bundle{}, larkProblem("LARK_VERSION_CHANGED")
}

func (r *larkReader) fetchRevision(ctx context.Context, source prd.SourceURL) (prd.Bundle, error) {
	if _, err := r.checkIdentity(ctx); err != nil {
		return prd.Bundle{}, err
	}
	documentID := source.Token
	docURL := source.URL
	if source.Kind == "wiki" {
		raw, err := r.command(ctx, "", 1<<20, true, "wiki", "+node-get", "--node-token", source.Token, "--as", "user", "--format", "json")
		if err != nil {
			return prd.Bundle{}, err
		}
		var node struct {
			Token string `json:"obj_token"`
			Type  string `json:"obj_type"`
		}
		if json.Unmarshal(raw, &node) != nil || node.Type != "docx" {
			return prd.Bundle{}, larkProblem("LARK_UNSUPPORTED_DOCUMENT")
		}
		canonical, err := prd.NormalizeURL(strings.Replace(source.URL, "/wiki/"+source.Token, "/docx/"+node.Token, 1))
		if err != nil {
			return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
		}
		documentID, docURL = node.Token, canonical.URL
	}
	xmlDoc, err := r.readDocument(ctx, docURL, "xml", "")
	if err != nil {
		return prd.Bundle{}, err
	}
	if xmlDoc.DocumentID != documentID {
		return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
	}
	markdown, err := r.readDocument(ctx, docURL, "markdown", xmlDoc.RevisionID.String())
	if err != nil {
		return prd.Bundle{}, err
	}
	if markdown.DocumentID != xmlDoc.DocumentID || markdown.RevisionID != xmlDoc.RevisionID {
		return prd.Bundle{}, larkProblem("LARK_VERSION_CHANGED")
	}
	clean, err := prd.SanitizeDocument(prd.SourceDocument{DocumentID: xmlDoc.DocumentID, RevisionID: xmlDoc.RevisionID.String(), Content: xmlDoc.Content, ReferenceMap: xmlDoc.ReferenceMap})
	if err != nil {
		return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
	}
	if clean.Title == "" {
		return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
	}
	m := prd.Manifest{SchemaVersion: prd.ProtocolVersion, DocumentID: xmlDoc.DocumentID, Realm: r.realm, RevisionID: xmlDoc.RevisionID.String(), Title: clean.Title, NormalizerVersion: prd.NormalizerVersion, Completeness: "complete", Warnings: clean.Warnings, Resources: clean.Resources, Files: []prd.File{}}
	if strings.TrimSpace(xmlDoc.Tips) != "" || strings.TrimSpace(markdown.Tips) != "" {
		m.Warnings = append(m.Warnings, prd.Warning{Code: "LARK_RENDERING_NOTICE", Message: "Lark 返回了格式或依赖提示，请对照原文检查内容。"})
	}
	directory, err := os.MkdirTemp("", "acceptances-lark-")
	if err != nil {
		return prd.Bundle{}, larkProblem("LARK_FETCH_FAILED")
	}
	defer os.RemoveAll(directory)
	files := make(map[string][]byte)
	files["source.json"], err = json.Marshal(clean.Source)
	if err != nil {
		return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
	}
	if len(files["source.json"]) > prd.MaxBodyBytes {
		return prd.Bundle{}, larkProblem("LARK_LIMIT_EXCEEDED")
	}
	total := len(files["source.json"]) + len(markdown.Content)
	for index := range m.Resources {
		resource := &m.Resources[index]
		if resource.Status == "unsupported" || resource.ResourceID == "" {
			continue
		}
		data, media, err := r.download(ctx, directory, *resource, index)
		if err != nil {
			problem := asLarkError(err)
			if problem.Stop || problem.Code == "CONNECTOR_CANCELLED" {
				return prd.Bundle{}, problem
			}
			resource.Status, resource.Reason = "missing", problem.Code
			continue
		}
		extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}[media]
		resource.Filename = fmt.Sprintf("resource-%03d.%s", index+1, extension)
		resource.Status, resource.Reason = "saved", ""
		resource.FetchedAt = time.Now().UTC().Format(time.RFC3339Nano)
		total += len(data)
		if total > prd.MaxUploadBytes {
			return prd.Bundle{}, larkProblem("LARK_LIMIT_EXCEEDED")
		}
		files[resource.Filename] = data
		m.Files = append(m.Files, prd.DescribeFile(resource.Filename, resource.Kind, media, data))
	}
	// Resources cannot be atomically versioned by Lark. Reject a changed source
	// and repeat the complete read rather than combining two document revisions.
	latest, err := r.readDocument(ctx, docURL, "xml", "")
	if err != nil {
		return prd.Bundle{}, err
	}
	if latest.DocumentID != xmlDoc.DocumentID || latest.RevisionID != xmlDoc.RevisionID {
		return prd.Bundle{}, larkProblem("LARK_VERSION_CHANGED")
	}
	if _, err := r.checkIdentity(ctx); err != nil {
		return prd.Bundle{}, err
	}
	reading, unmapped := larkReadingView(markdown.Content, m.Resources, xmlDoc.ReferenceMap)
	if unmapped {
		m.Warnings = append(m.Warnings, prd.Warning{Code: "MARKDOWN_RESOURCE_UNMAPPED", Message: "阅读视图存在未匹配资源，请结合结构原文与资源清单检查。"})
	}
	for _, resource := range m.Resources {
		if resource.Status != "saved" {
			m.Completeness = "partial"
		}
	}
	if len(m.Warnings) > 0 {
		m.Completeness = "partial"
	}
	files["document.md"] = []byte(reading)
	m.Files = append(m.Files, prd.DescribeFile("source.json", "source", "application/json", files["source.json"]), prd.DescribeFile("document.md", "markdown", "text/markdown", files["document.md"]))
	m.FetchedAt = time.Now().UTC().Format(time.RFC3339Nano)
	bundle, err := prd.ValidateBundle(m, files)
	if err != nil {
		return prd.Bundle{}, larkProblem("LARK_INVALID_RESULT")
	}
	return bundle, nil
}

func (r *larkReader) readDocument(ctx context.Context, source, format, revision string) (larkDocument, error) {
	detail := "full"
	if format == "markdown" {
		detail = "simple"
	}
	args := []string{"docs", "+fetch", "--doc", source, "--doc-format", format, "--detail", detail, "--scope", "full", "--lang", "zh-CN", "--as", "user", "--format", "json"}
	if revision != "" {
		args = append(args, "--revision-id", revision)
	}
	raw, err := r.command(ctx, "", 2*prd.MaxBodyBytes+prd.MaxManifestBytes, true, args...)
	if err != nil {
		return larkDocument{}, err
	}
	var payload struct {
		Document larkDocument `json:"document"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&payload) != nil || decoder.Decode(new(any)) != io.EOF || payload.Document.DocumentID == "" || payload.Document.Content == "" || !utf8.ValidString(payload.Document.Content) {
		return larkDocument{}, larkProblem("LARK_INVALID_RESULT")
	}
	if _, err := strconv.ParseInt(payload.Document.RevisionID.String(), 10, 64); err != nil || strings.HasPrefix(payload.Document.RevisionID.String(), "-") || payload.Document.RevisionID == "0" || payload.Document.RevisionID == "" {
		return larkDocument{}, larkProblem("LARK_INVALID_RESULT")
	}
	if len(payload.Document.Content) > prd.MaxBodyBytes {
		return larkDocument{}, larkProblem("LARK_LIMIT_EXCEEDED")
	}
	return payload.Document, nil
}

func (r *larkReader) download(ctx context.Context, directory string, resource prd.Resource, index int) ([]byte, string, error) {
	base := fmt.Sprintf("asset-%03d", index+1)
	args := []string{"docs", "+media-download", "--token", resource.ResourceID, "--output", "./" + base, "--as", "user", "--format", "json"}
	if resource.Kind == "whiteboard" {
		args = append(args, "--type", "whiteboard")
	}
	if _, err := r.command(ctx, directory, 64<<10, true, args...); err != nil {
		return nil, "", err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, "", larkProblem("LARK_FETCH_FAILED")
	}
	var path string
	for _, entry := range entries {
		if entry.Name() == base || strings.HasPrefix(entry.Name(), base+".") {
			if path != "" || !entry.Type().IsRegular() {
				return nil, "", larkProblem("LARK_INVALID_RESULT")
			}
			path = filepath.Join(directory, entry.Name())
		}
	}
	if path == "" {
		return nil, "", larkProblem("LARK_INVALID_RESULT")
	}
	defer os.Remove(path)
	file, err := os.Open(path)
	if err != nil {
		return nil, "", larkProblem("LARK_FETCH_FAILED")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, prd.MaxResourceBytes+1))
	if err != nil {
		return nil, "", larkProblem("LARK_FETCH_FAILED")
	}
	if len(data) > prd.MaxResourceBytes {
		return nil, "", larkProblem("LARK_LIMIT_EXCEEDED")
	}
	media := http.DetectContentType(data)
	if !slices.Contains([]string{"image/png", "image/jpeg", "image/gif", "image/webp"}, media) {
		return nil, "", larkProblem("LARK_INVALID_RESULT")
	}
	return data, media, nil
}

type larkBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *larkBuffer) Write(data []byte) (int, error) {
	if len(data) > b.limit-b.Len() {
		b.overflow = true
		return 0, errors.New("output limit")
	}
	return b.Buffer.Write(data)
}

func (r *larkReader) command(ctx context.Context, directory string, limit int, envelope bool, args ...string) ([]byte, error) {
	if r.profile != "" {
		args = append([]string{"--profile", r.profile}, args...)
	}
	var last *larkError
	for attempt := range 3 {
		if attempt > 0 && !larkWait(ctx, larkBackoff(attempt, last.Delay)) {
			return nil, larkProblem("CONNECTOR_CANCELLED")
		}
		commandCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		cmd := exec.CommandContext(commandCtx, r.executable, args...)
		cmd.Dir = directory
		cmd.Env = append(os.Environ(), "LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1", "LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1")
		stdout, stderr := &larkBuffer{limit: limit}, &larkBuffer{limit: 1 << 20}
		cmd.Stdout, cmd.Stderr = stdout, stderr
		configureLarkProcess(cmd)
		err := cmd.Run()
		timedOut := commandCtx.Err() != nil
		cancel()
		if ctx.Err() != nil {
			return nil, larkProblem("CONNECTOR_CANCELLED")
		}
		if stdout.overflow || stderr.overflow {
			return nil, larkProblem("LARK_LIMIT_EXCEEDED")
		}
		if err != nil {
			last = larkCommandError(stderr.Bytes())
			if timedOut {
				last = &larkError{Code: "LARK_FETCH_FAILED", Retryable: true}
			}
			if !last.Retryable {
				return nil, last
			}
			continue
		}
		if !envelope {
			return stdout.Bytes(), nil
		}
		var response larkEnvelope
		decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
		if decoder.Decode(&response) != nil || decoder.Decode(new(any)) != io.EOF || !response.OK {
			return nil, larkProblem("LARK_INVALID_RESULT")
		}
		if response.Identity != "user" {
			return nil, &larkError{Code: "LARK_IDENTITY_CHANGED", Stop: true}
		}
		return response.Data, nil
	}
	return nil, last
}

func larkCommandError(raw []byte) *larkError {
	var response larkEnvelope
	if json.Unmarshal(raw, &response) != nil {
		return larkProblem("LARK_FETCH_FAILED")
	}
	problem := response.Error
	switch {
	case problem.Subtype == "missing_scope":
		return larkProblem("LARK_SCOPE_REQUIRED")
	case problem.Type == "authentication" || problem.Subtype == "not_logged_in" || problem.Subtype == "token_expired" || problem.Subtype == "invalid_token":
		return &larkError{Code: "LARK_AUTH_REQUIRED", Stop: true}
	case problem.Subtype == "permission_denied" || problem.Code == 131006 || problem.Code == 99991672:
		return larkProblem("LARK_PERMISSION_DENIED")
	case problem.Subtype == "not_found" || slices.Contains([]int{131005, 131012}, problem.Code):
		return larkProblem("LARK_NOT_FOUND")
	case problem.Subtype == "rate_limit" || problem.Type == "rate_limit" || problem.Code == 99991400:
		return &larkError{Code: "LARK_RATE_LIMITED", Retryable: true, Delay: retryAfterSeconds(problem.RetryAfter.String())}
	case problem.Type == "network" || problem.Type == "transport" || problem.Subtype == "network" || problem.Subtype == "timeout":
		return &larkError{Code: "LARK_FETCH_FAILED", Retryable: true, Delay: retryAfterSeconds(problem.RetryAfter.String())}
	default:
		return larkProblem("LARK_FETCH_FAILED")
	}
}

var markdownImage = regexp.MustCompile(`!\[([^\]\n]*)\]\(([^)\n]*)\)`)
var markdownReferenceImage = regexp.MustCompile(`!\[[^\]\n]*\]\[[^\]\n]*\]`)
var markdownHTMLImage = regexp.MustCompile(`(?is)<(?:img|whiteboard)\b[^>]*>`)
var markdownComments = regexp.MustCompile(`(?is)<!--.*?-->|<comment\b[^>]*>.*?</comment>`)

func larkReadingView(markdown string, resources []prd.Resource, references map[string]json.RawMessage) (string, bool) {
	unmapped := false
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
			for _, resource := range resources {
				if resource.ResourceID != "" && strings.Contains(parts[2], resource.ResourceID) || resource.Reference != "" && strings.Trim(parts[2], " <>") == resource.Reference {
					if resource.Status == "saved" {
						return "![" + parts[1] + "](" + resource.Filename + ")"
					}
					return "[图片未保存：" + resource.Reason + "]"
				}
			}
			unmapped = true
			return "[图片未匹配，见资源清单]"
		})
		for _, pattern := range []*regexp.Regexp{markdownReferenceImage, markdownHTMLImage} {
			if pattern.MatchString(text) {
				unmapped = true
				text = pattern.ReplaceAllString(text, "[图片未匹配，见资源清单]")
			}
		}
		for _, temporary := range transientURLs {
			text = strings.ReplaceAll(text, temporary, "[临时资源地址已排除]")
		}
		return text
	})
	if len(resources) > 0 {
		markdown += "\n\n## 资源清单\n"
		for index, resource := range resources {
			if resource.Status == "saved" {
				markdown += fmt.Sprintf("\n资源 %d（%s）\n\n![资源 %d](%s)\n", index+1, resource.Kind, index+1, resource.Filename)
			} else {
				markdown += fmt.Sprintf("\n- 资源 %d（%s）：未保存，%s。\n", index+1, resource.Kind, resource.Reason)
			}
		}
	}
	return markdown, unmapped
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
