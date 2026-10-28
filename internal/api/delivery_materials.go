package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"regexp"
	"sort"
	"strings"
)

var commitIdentity = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)
var sha256Identity = regexp.MustCompile(`^[0-9a-f]{64}$`)

func digestBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func readMaterial(root fs.FS, name string, target any) error {
	if !validName(name) {
		return fmt.Errorf("材料文件名无效")
	}
	file, err := root.Open(name)
	if err != nil {
		return fmt.Errorf("无法读取材料 %s", name)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return fmt.Errorf("材料 %s 超过 1 MiB 或无法读取", name)
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("材料 %s 格式无效：%w", name, err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return fmt.Errorf("材料 %s 含多余内容", name)
	}
	return nil
}

func archiveFiles(root fs.FS, evidence []Evidence) ([]ArchivedFile, error) {
	files := make([]ArchivedFile, 0, len(evidence))
	for _, item := range evidence {
		if !validName(item.Path) {
			return nil, fmt.Errorf("附件文件名无效")
		}
		file, err := root.Open(item.Path)
		if err != nil {
			return nil, fmt.Errorf("附件 %s 无法读取", item.Path)
		}
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			file.Close()
			return nil, fmt.Errorf("附件 %s 不是普通文件", item.Path)
		}
		hash := sha256.New()
		size, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			return nil, fmt.Errorf("附件 %s 读取失败", item.Path)
		}
		files = append(files, ArchivedFile{Path: item.Path, SHA256: hex.EncodeToString(hash.Sum(nil)), Size: size})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, nil
}

func (s *Server) prepareDelivery(runID string) (DeliveryPreparation, error) {
	prep := DeliveryPreparation{Issues: []DeliveryIssue{}, Files: []ArchivedFile{}, ExceptionReasons: map[string]string{}}
	run, err := s.run(runID)
	if err != nil {
		return prep, err
	}
	prep.Run = run
	prep.Campaign, err = s.campaign(run.CampaignID)
	if err != nil {
		return prep, err
	}
	prep.Project, err = s.project(prep.Campaign.ProjectID)
	if err != nil {
		return prep, err
	}
	issue := func(code, message string) { prep.Issues = append(prep.Issues, DeliveryIssue{code, message}) }
	if run.ConsolidatedInto != nil {
		issue("RUN_CONSOLIDATED", "该报告已合并留档，请使用当前报告。")
	}
	if prep.Campaign.LatestRunID != run.ID {
		issue("RUN_NOT_LATEST", "只能冻结当前最新的验证记录。")
	}
	if run.Report.ScopeType != "full" {
		issue("FULL_SCOPE_REQUIRED", "正式交付需要完整验证范围。")
	}
	if run.humanStatus() != "accepted" {
		issue("HUMAN_ACCEPTANCE_REQUIRED", "所有检查项须人工接受，作废记录不能冻结。")
	}
	if err := validateDeliverySources(run.Report.Versions); err != nil {
		issue("SOURCE_IDENTITY_REQUIRED", err.Error())
	}
	for _, check := range run.Report.Checks {
		if check.Status == "passed" {
			continue
		}
		prep.ExceptionReasons[check.ID] = ""
		for _, current := range run.CheckReviews {
			if current.CheckID != check.ID || current.Status != "accepted" {
				continue
			}
			for _, review := range run.Reviews {
				body := strings.TrimSpace(review.Body)
				if review.ID == current.LastReviewID && !isBulkAcceptanceBody(body) {
					prep.ExceptionReasons[check.ID] = body
				}
			}
		}
	}
	root, err := s.openFiles(context.Background(), fileOwner{"evidence", run.ID})
	if err != nil {
		issue("EVIDENCE_UNAVAILABLE", "本轮附件无法读取。")
	} else {
		defer root.Close()
		prep.Files, err = archiveFiles(root, run.Report.Evidence)
		if err != nil {
			issue("EVIDENCE_UNAVAILABLE", err.Error())
		} else if err = loadDeliveryMaterials(root, &prep); err != nil {
			issue("DELIVERY_MATERIALS_INVALID", err.Error())
		}
	}
	// Bind the confirmation to actual bytes and current judgments, not a UI cache.
	tokenData, err := json.Marshal(struct {
		Project  Project
		Campaign Campaign
		Run      Run
		Files    []ArchivedFile
	}{prep.Project, prep.Campaign, run, prep.Files})
	if err != nil {
		return prep, err
	}
	prep.Token = digestBytes(tokenData)
	prep.Eligible = len(prep.Issues) == 0
	return prep, nil
}

func validateDeliverySources(versions []Version) error {
	if len(versions) == 0 {
		return fmt.Errorf("必须记录受验源码版本。")
	}
	seen := map[string]bool{}
	for _, version := range versions {
		if strings.TrimSpace(version.Repository) == "" || strings.EqualFold(strings.TrimSpace(version.Repository), "unknown") || seen[version.Repository] || !commitIdentity.MatchString(version.Commit) {
			return fmt.Errorf("代码来源须唯一，commit 必须为明确的完整提交摘要。")
		}
		if version.Dirty == nil || *version.Dirty {
			return fmt.Errorf("受验源码必须已提交，dirty 必须为 false。")
		}
		seen[version.Repository] = true
	}
	return nil
}

func loadDeliveryMaterials(root fs.FS, prep *DeliveryPreparation) error {
	hashes := map[string]ArchivedFile{}
	for _, file := range prep.Files {
		hashes[file.Path] = file
	}
	if _, exists := hashes[deliveryManifestName]; !exists {
		return fmt.Errorf("缺少 %s，请通过项目侧补齐本 Run 的说明素材和版本清单。", deliveryManifestName)
	}
	var manifest DeliveryManifest
	if err := readMaterial(root, deliveryManifestName, &manifest); err != nil {
		return err
	}
	prep.Manifest = &manifest
	materialsCampaignID, err := prep.Run.materialsCampaignID()
	if err != nil {
		return err
	}
	if manifest.SchemaVersion != 1 || manifest.ProjectID != prep.Project.ID || manifest.CampaignID != materialsCampaignID {
		return fmt.Errorf("交付清单版本或 Project/Campaign 归属不匹配。")
	}
	refs := []ArtifactRef{manifest.Requirement, manifest.Map, manifest.Materials}
	used := map[string]bool{deliveryManifestName: true}
	for _, ref := range refs {
		if !validName(ref.Path) || !sha256Identity.MatchString(ref.SHA256) || hashes[ref.Path].SHA256 != ref.SHA256 || used[ref.Path] {
			return fmt.Errorf("需求、地图或说明素材的文件引用及 SHA-256 不匹配。")
		}
		used[ref.Path] = true
	}
	if hashes[manifest.Requirement.Path].Size == 0 || hashes[manifest.Requirement.Path].Size > 1<<20 {
		return fmt.Errorf("需求原文不能为空或超过 1 MiB。")
	}
	if err := validateDeliverySources(manifest.Build.Sources); err != nil {
		return err
	}
	if !sameSources(prep.Run.Report.Versions, manifest.Build.Sources) {
		return fmt.Errorf("构建绑定的源码版本与受验报告不一致。")
	}
	switch manifest.Build.Kind {
	case "artifact":
		ref := manifest.Build.Artifact
		if strings.TrimSpace(manifest.Build.ID) == "" || strings.EqualFold(strings.TrimSpace(manifest.Build.ID), "unknown") || used[ref.Path] || !validName(ref.Path) || !sha256Identity.MatchString(ref.SHA256) || hashes[ref.Path].SHA256 != ref.SHA256 || hashes[ref.Path].Size == 0 {
			return fmt.Errorf("实际运行构建须提供明确标识、独立产物附件与正确的 SHA-256。")
		}
	case "not-applicable":
		if strings.TrimSpace(manifest.Build.Reason) == "" || strings.EqualFold(strings.TrimSpace(manifest.Build.Reason), "unknown") || manifest.Build.Artifact.Path != "" || manifest.Build.Artifact.SHA256 != "" || manifest.Build.ID != "" {
			return fmt.Errorf("无需构建须明确说明原因，不能用 unknown 代替。")
		}
	default:
		return fmt.Errorf("构建类型必须为 artifact 或有说明的 not-applicable。")
	}
	var featureMap VerificationMap
	if err := readMaterial(root, manifest.Map.Path, &featureMap); err != nil {
		return err
	}
	if featureMap.Excluded == nil {
		featureMap.Excluded = []string{}
	}
	if err := validateVerificationMap(featureMap, *prep); err != nil {
		return err
	}
	prep.Map = &featureMap
	var materials DocumentationMaterials
	if err := readMaterial(root, manifest.Materials.Path, &materials); err != nil {
		return err
	}
	for index := range materials.Features {
		feature := &materials.Features[index]
		if feature.Prerequisites == nil {
			feature.Prerequisites = []string{}
		}
		if feature.Limitations == nil {
			feature.Limitations = []string{}
		}
		if feature.Screenshots == nil {
			feature.Screenshots = []DocumentationScreenshot{}
		}
	}
	if err := validateDocumentationMaterials(root, materials, *prep); err != nil {
		return err
	}
	prep.Materials = &materials
	return nil
}

func sameSources(a, b []Version) bool {
	if len(a) != len(b) {
		return false
	}
	versions := map[string]string{}
	for _, v := range a {
		versions[v.Repository] = v.Commit
	}
	for _, v := range b {
		if versions[v.Repository] != v.Commit {
			return false
		}
	}
	return true
}
