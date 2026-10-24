import {
  GitCommit,
  Box,
  Layers,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { DeliveryPreparation } from "@acceptances/api-client";
import { Badge } from "./components/reui/badge";
import { Label } from "./components/ui/label";
import { Checkbox } from "./components/ui/checkbox";
import { Disclosure } from "./components/disclosure";
import { cn } from "./lib/utils";

/** 步骤 1：受验代码与实际构建 */
export function StepCodeAndBuild({ prep }: { prep: DeliveryPreparation }) {
  const versions = prep.run.report.versions ?? [];
  return (
    <>
      <div className="delivery-step-intro">
        <div className="delivery-step-badge">
          <span className="delivery-step-badge-dot" />第 1 步 · 基线凭据
        </div>
        <h3 className="delivery-step-heading">受验代码与实际构建</h3>
        <p className="delivery-step-desc">
          核对本次验证绑定的代码版本与实际构建产物。所有代码须干净已提交，构建产物须与本次验证一致。
        </p>
      </div>

      <div className="delivery-section-group">
        <div className="delivery-card-block">
          <div className="delivery-card-block-header">
            <div className="flex items-center gap-2">
              <GitCommit size={15} className="text-muted" />
              <span className="delivery-card-block-title">
                受验代码仓库与提交
              </span>
            </div>
            <Badge variant="outline" className="text-xs font-normal">
              {versions.length} 个代码库
            </Badge>
          </div>

          <div className="delivery-version-list">
            {versions.map((version) => (
              <div key={version.repository} className="delivery-version-item">
                <div className="delivery-version-main">
                  <span className="delivery-repo-title">
                    {version.repository}
                  </span>
                  <div className="delivery-commit-pill">
                    <span className="delivery-commit-prefix">Commit</span>
                    <code>{version.commit}</code>
                  </div>
                </div>
                <div className="delivery-version-status">
                  {version.dirty === false ? (
                    <Badge variant="success-light" className="gap-1">
                      <CheckCircle2 size={12} />
                      已提交
                    </Badge>
                  ) : (
                    <Badge variant="warning-light" className="gap-1">
                      <AlertTriangle size={12} />
                      未提交或未知
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            {versions.length === 0 && (
              <p className="delivery-empty-text">未记录受验代码库版本信息。</p>
            )}
          </div>
        </div>

        {prep.manifest && (
          <div className="delivery-card-block">
            <div className="delivery-card-block-header">
              <div className="flex items-center gap-2">
                <Box size={15} className="text-muted" />
                <span className="delivery-card-block-title">实际构建产物</span>
              </div>
            </div>
            <div className="delivery-build-row">
              <span className="delivery-build-label">产物标识</span>
              <div className="delivery-build-value">
                {prep.manifest.build.kind === "artifact" ? (
                  <code>{prep.manifest.build.id}</code>
                ) : (
                  <span className="text-muted">
                    不适用：{prep.manifest.build.reason}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** 步骤 2：需求地图与必验范围 */
export function StepMapAndScope({
  prep,
  mapConfirmed,
  onMapConfirmedChange,
}: {
  prep: DeliveryPreparation;
  mapConfirmed: boolean;
  onMapConfirmedChange: (confirmed: boolean) => void;
}) {
  return (
    <>
      <div className="delivery-step-intro">
        <div className="delivery-step-badge">
          <span className="delivery-step-badge-dot" />第 2 步 · 范围覆盖
        </div>
        <h3 className="delivery-step-heading">需求地图与必验范围</h3>
        <p className="delivery-step-desc">
          确认交付包含地图中声明的所有功能及其必验项。排除范围须明确公示并经人工核对。
        </p>
      </div>

      {!prep.map ? (
        <div className="delivery-missing-notice">
          <AlertCircle size={16} className="shrink-0" />
          <p>需求地图尚未就绪，请先在项目侧补齐交付准备条件。</p>
        </div>
      ) : (
        <Disclosure title="需求地图与必验范围清单" defaultOpen>
          <div className="delivery-features-stack">
            {prep.map.features.map((feature) => {
              const requiredChecks = feature.checks.filter(
                (check) => check.required,
              );
              return (
                <div key={feature.id} className="delivery-feature-block">
                  <div className="delivery-feature-header">
                    <div className="delivery-feature-info">
                      <Layers size={14} className="text-muted shrink-0" />
                      <strong className="delivery-feature-name">
                        {feature.title}
                      </strong>
                      <code className="delivery-feature-code">
                        {feature.id}
                      </code>
                    </div>
                    <Badge variant="outline" className="text-xs font-normal">
                      {requiredChecks.length} 项必验
                    </Badge>
                  </div>
                  <div className="delivery-checks-table">
                    {requiredChecks.map((check) => (
                      <div key={check.id} className="delivery-check-row">
                        <div className="delivery-check-header">
                          <span className="delivery-check-name">
                            {check.title}
                          </span>
                          <code className="delivery-check-code">
                            {check.id}
                          </code>
                        </div>
                        <div className="delivery-check-desc">
                          <span className="delivery-expected-label">
                            预期结果：
                          </span>
                          <span className="delivery-expected-text">
                            {check.expected}
                          </span>
                        </div>
                      </div>
                    ))}
                    {requiredChecks.length === 0 && (
                      <p className="delivery-empty-text">
                        该功能下暂无必验检查项。
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {prep.map.excluded.length > 0 && (
            <div className="delivery-excluded-card">
              <span className="delivery-excluded-tag">排除范围</span>
              <span className="delivery-excluded-content">
                {prep.map.excluded.join("；")}
              </span>
            </div>
          )}

          <div className="delivery-map-digest">
            <span className="delivery-digest-label">地图校验摘要：</span>
            <code className="delivery-digest-code">
              {prep.manifest?.map.sha256 ?? "无摘要"}
            </code>
          </div>
        </Disclosure>
      )}

      <div
        className={cn("delivery-sign-panel", mapConfirmed && "is-confirmed")}
      >
        <Label className="delivery-checkbox">
          <Checkbox
            checked={mapConfirmed}
            onCheckedChange={(checked) =>
              onMapConfirmedChange(checked === true)
            }
          />
          <span className="delivery-checkbox-label-text">
            我确认所选地图版本及必验范围准确、完整。
          </span>
        </Label>
      </div>
    </>
  );
}
