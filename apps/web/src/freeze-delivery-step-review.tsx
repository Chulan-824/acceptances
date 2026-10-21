import {
  FileText,
  AlertTriangle,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type { DeliveryPreparation } from "@acceptances/api-client";
import { Badge } from "./components/reui/badge";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { Disclosure } from "./components/disclosure";
import { Status } from "./client";
import { cn } from "./lib/utils";

/** 步骤 3：业务说明素材 */
export function StepBusinessMaterials({
  prep,
  materialsConfirmed,
  onMaterialsConfirmedChange,
}: {
  prep: DeliveryPreparation;
  materialsConfirmed: boolean;
  onMaterialsConfirmedChange: (confirmed: boolean) => void;
}) {
  return (
    <>
      <div className="delivery-step-intro">
        <div className="delivery-step-badge">
          <span className="delivery-step-badge-dot" />第 3 步 · 业务素材
        </div>
        <h3 className="delivery-step-heading">业务说明素材</h3>
        <p className="delivery-step-desc">
          审阅面向业务人员的功能说明、操作步骤、角色前提、限制条件与真实验证截图。
        </p>
      </div>

      {!prep.materials ? (
        <div className="delivery-missing-notice">
          <AlertCircle size={16} className="shrink-0" />
          <p>说明素材尚未就绪，请先补齐交付准备条件。</p>
        </div>
      ) : (
        <Disclosure title="业务说明素材审阅清单" defaultOpen>
          <div className="delivery-materials-stack">
            {prep.materials.features.map((feature) => (
              <section
                key={feature.featureId}
                className="delivery-material-card"
              >
                <div className="delivery-material-top">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-muted" />
                    <h3 className="delivery-material-title">
                      {prep.map?.features.find(
                        (item) => item.id === feature.featureId,
                      )?.title ?? feature.featureId}
                    </h3>
                  </div>
                  <p className="delivery-material-summary">{feature.summary}</p>
                </div>

                <div className="delivery-material-meta-grid">
                  <div className="delivery-meta-item">
                    <span className="delivery-meta-label">适用角色</span>
                    <div className="delivery-roles-list">
                      {feature.roles.map((role) => (
                        <Badge
                          key={role}
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="delivery-meta-item">
                    <span className="delivery-meta-label">前置条件</span>
                    <span className="delivery-meta-value">
                      {feature.prerequisites.join("；") || "未声明额外前提"}
                    </span>
                  </div>
                  <div className="delivery-meta-item">
                    <span className="delivery-meta-label">限制约束</span>
                    <span className="delivery-meta-value">
                      {feature.limitations.join("；") || "未声明额外限制"}
                    </span>
                  </div>
                </div>

                <div className="delivery-instructions-box">
                  <div className="delivery-instructions-label">
                    操作步骤与预期
                  </div>
                  <ol className="delivery-instructions-list">
                    {feature.steps.map((step, index) => (
                      <li key={index} className="delivery-instruction-item">
                        <span className="delivery-step-index">{index + 1}</span>
                        <div className="delivery-instruction-content">
                          <p className="delivery-instruction-text">
                            {step.instruction}
                          </p>
                          <p className="delivery-instruction-expected">
                            <span className="delivery-expected-badge">
                              预期结果
                            </span>
                            {step.expected}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {feature.screenshots.length > 0 && (
                  <div className="delivery-figures-gallery">
                    {feature.screenshots.map((screenshot) => (
                      <figure
                        key={`${screenshot.path}-${screenshot.checkIds.join(",")}`}
                        className="delivery-figure-item"
                      >
                        <div className="delivery-figure-img-wrap">
                          <img
                            loading="lazy"
                            src={`/api/v1/runs/${encodeURIComponent(prep.run.id)}/evidence/${encodeURIComponent(screenshot.path)}`}
                            alt={screenshot.caption}
                          />
                        </div>
                        <figcaption className="delivery-figure-caption">
                          <div className="flex items-center gap-1.5 font-medium text-fg">
                            <ImageIcon size={13} className="text-muted" />
                            <span>{screenshot.caption}</span>
                          </div>
                          <div className="delivery-caption-checks">
                            <span className="delivery-checks-intro">
                              对应检查：
                            </span>
                            {screenshot.checkIds.map((cid) => (
                              <code key={cid} className="delivery-cid-badge">
                                {cid}
                              </code>
                            ))}
                          </div>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}

                {feature.screenshotOmissionReason && (
                  <p className="delivery-omission-text">
                    <HelpCircle size={13} className="inline mr-1 text-muted" />
                    截图说明：{feature.screenshotOmissionReason}
                  </p>
                )}
              </section>
            ))}
          </div>
        </Disclosure>
      )}

      <div
        className={cn(
          "delivery-sign-panel",
          materialsConfirmed && "is-confirmed",
        )}
      >
        <Label className="delivery-checkbox">
          <input
            type="checkbox"
            checked={materialsConfirmed}
            onChange={(e) => onMaterialsConfirmedChange(e.target.checked)}
          />
          <span className="delivery-checkbox-label-text">
            我已审阅功能说明、操作步骤、角色前提、限制和对应截图。
          </span>
        </Label>
      </div>
    </>
  );
}

/** 步骤 4：最终冻结签署与人工确认 */
export function StepFinalConfirmation({
  prep,
  mapConfirmed,
  materialsConfirmed,
  sensitiveInfoReviewed,
  onSensitiveInfoReviewedChange,
  reasons,
  onReasonsChange,
}: {
  prep: DeliveryPreparation;
  mapConfirmed: boolean;
  materialsConfirmed: boolean;
  sensitiveInfoReviewed: boolean;
  onSensitiveInfoReviewedChange: (reviewed: boolean) => void;
  reasons: Record<string, string>;
  onReasonsChange: (reasons: Record<string, string>) => void;
}) {
  const reasonKeys = Object.keys(reasons);
  const allPreflightsDone = mapConfirmed && materialsConfirmed;

  return (
    <>
      <div className="delivery-step-intro">
        <div className="delivery-step-badge">
          <span className="delivery-step-badge-dot" />第 4 步 · 签署与冻结
        </div>
        <h3 className="delivery-step-heading">最终冻结确认</h3>
        <p className="delivery-step-desc">
          完成交付签署前置门禁审查。确认后将为本次 Run
          产生正式的不可变交付快照版本。
        </p>
      </div>

      <div className="delivery-preflight-card">
        <div className="delivery-preflight-header">
          <span className="delivery-preflight-title">交付前置核对清单</span>
          <span className="delivery-preflight-meta">
            来源 Run：<code>{prep.run.id}</code>
          </span>
        </div>
        <div className="delivery-preflight-grid">
          <div
            className={cn(
              "delivery-check-status-box",
              mapConfirmed ? "is-ready" : "is-pending",
            )}
          >
            <div className="delivery-status-box-label">地图与必验范围</div>
            <div className="delivery-status-box-val">
              {mapConfirmed ? (
                <Badge variant="success-light" className="gap-1">
                  <CheckCircle2 size={12} /> 已确认
                </Badge>
              ) : (
                <Badge variant="warning-light" className="gap-1">
                  <AlertTriangle size={12} /> 尚未确认
                </Badge>
              )}
            </div>
          </div>
          <div
            className={cn(
              "delivery-check-status-box",
              materialsConfirmed ? "is-ready" : "is-pending",
            )}
          >
            <div className="delivery-status-box-label">业务说明素材</div>
            <div className="delivery-status-box-val">
              {materialsConfirmed ? (
                <Badge variant="success-light" className="gap-1">
                  <CheckCircle2 size={12} /> 已确认
                </Badge>
              ) : (
                <Badge variant="warning-light" className="gap-1">
                  <AlertTriangle size={12} /> 尚未确认
                </Badge>
              )}
            </div>
          </div>
        </div>
        {!allPreflightsDone && (
          <p className="delivery-return-hint">
            <AlertCircle size={13} className="inline mr-1" />
            请返回对应步骤，明确确认地图范围和说明素材。
          </p>
        )}
      </div>

      {reasonKeys.length > 0 && (
        <section className="delivery-reasons-wrapper">
          <div className="delivery-reasons-title-row">
            <h4 className="delivery-reasons-title">
              原始未通过项的人工接受理由
            </h4>
            <span className="delivery-reasons-badge">
              {reasonKeys.length} 项需人工确认
            </span>
          </div>
          <p className="delivery-reasons-desc">
            本次验证存在原始未通过项。正式交付须由人工逐项核实业务风险，并填写具体的豁免或接受理由。
          </p>
          <div className="delivery-reasons-stack">
            {Object.entries(reasons).map(([id, reason]) => {
              const check = prep.run.report.checks.find(
                (item) => item.id === id,
              );
              return (
                <div key={id} className="delivery-reason-item-card">
                  <div className="delivery-reason-item-header">
                    <span className="delivery-reason-check-title">
                      {check?.title ?? id}
                    </span>
                    <Status value={check?.status ?? ""} />
                  </div>
                  <Label className="delivery-reason">
                    <span className="sr-only">
                      {check?.title ?? id} 接受理由
                    </span>
                    <Textarea
                      required
                      placeholder="请输入人工接受此项未通过或阻塞的具体业务理由…"
                      value={reason}
                      onChange={(event) => {
                        const values = {
                          ...reasons,
                          [id]: event.target.value,
                        };
                        onReasonsChange(values);
                      }}
                    />
                  </Label>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div
        className={cn(
          "delivery-sign-panel",
          sensitiveInfoReviewed && "is-confirmed",
        )}
      >
        <Label className="delivery-checkbox">
          <input
            type="checkbox"
            checked={sensitiveInfoReviewed}
            onChange={(event) =>
              onSensitiveInfoReviewedChange(event.target.checked)
            }
          />
          <span className="delivery-checkbox-label-text">
            我已检查说明素材和截图中的敏感信息，确认可用于业务说明。
          </span>
        </Label>
      </div>
    </>
  );
}
