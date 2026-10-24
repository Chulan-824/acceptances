package api

import (
	"bytes"
	"fmt"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ValidateBundle reuses the freeze contract before publishing, without changing
// files or requiring a database or human acceptance. Historical Runs stay intact.
func ValidateBundle(directory, projectID, campaignID string, formal bool) (Report, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return Report{}, err
	}
	defer root.Close()
	var report Report
	if err := readMaterial(root.FS(), "report.json", &report); err != nil {
		return report, err
	}
	if err := validateReport(&report); err != nil {
		return report, fmt.Errorf("report.json: %w", err)
	}
	hasManifest := false
	var total int64
	for _, item := range report.Evidence {
		info, err := root.Lstat(item.Path)
		if err != nil || !info.Mode().IsRegular() {
			return report, fmt.Errorf("附件 %s 必须为存在的普通文件，不接受符号链接。", item.Path)
		}
		total += info.Size()
		if total > 256<<20 {
			return report, fmt.Errorf("附件总量超过 256 MiB。")
		}
		file, err := root.Open(item.Path)
		if err != nil {
			return report, err
		}
		header := make([]byte, 512)
		n, readErr := file.Read(header)
		file.Close()
		if readErr != nil && readErr != io.EOF {
			return report, readErr
		}
		mime := http.DetectContentType(header[:n])
		extension := strings.ToLower(filepath.Ext(item.Path))
		if strings.HasPrefix(mime, "image/") || extension == ".jpg" || extension == ".jpeg" || extension == ".png" || extension == ".gif" || extension == ".webp" || extension == ".svg" {
			data, actual, err := readDocumentationImage(root.FS(), item.Path)
			if err != nil {
				return report, err
			}
			if actual != "image/jpeg" {
				return report, fmt.Errorf("新增截图 %s 须先编码为 JPEG（.jpg/.jpeg），不能只改扩展名。", item.Path)
			}
			if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
				return report, fmt.Errorf("截图 %s 内容不完整或无法解码。", item.Path)
			}
		}
		hasManifest = hasManifest || item.Path == deliveryManifestName
	}
	if formal || hasManifest {
		if report.ScopeType != "full" {
			return report, fmt.Errorf("正式交付需要 scopeType=full；不能缩减完整验证范围。")
		}
		if err := validateDeliverySources(report.Versions); err != nil {
			return report, err
		}
		files, err := archiveFiles(root.FS(), report.Evidence)
		if err != nil {
			return report, err
		}
		// An offline check may infer identity; publish always supplies actual IDs.
		if hasManifest && (projectID == "" || campaignID == "") {
			var manifest DeliveryManifest
			if err := readMaterial(root.FS(), deliveryManifestName, &manifest); err != nil {
				return report, err
			}
			if projectID == "" {
				projectID = manifest.ProjectID
			}
			if campaignID == "" {
				campaignID = manifest.CampaignID
			}
		}
		prep := DeliveryPreparation{Project: Project{ID: projectID}, Run: Run{CampaignID: campaignID, Report: report}, Files: files}
		if err := loadDeliveryMaterials(root.FS(), &prep); err != nil {
			return report, err
		}
	}
	return report, nil
}
