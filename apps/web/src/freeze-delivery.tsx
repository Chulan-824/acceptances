import { Frame, FramePanel, FrameFooter } from "./components/reui/frame";
import {
  Stepper,
  StepperNav,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperPanel,
  StepperContent,
} from "./components/reui/stepper";
import { useRef, useState } from "react";
import {
  RequestError,
  request,
  type DeliveryPreparation,
  type DeliverySnapshot,
  type FreezeDeliveryInput,
} from "@acceptances/api-client";
import { Load, message, Status, useResource } from "./client";
import { Alert } from "./components/reui/alert";
import { Badge } from "./components/reui/badge";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { Disclosure } from "./components/disclosure";
import { cn } from "./lib/utils";

export function FreezeDelivery({
  runId,
  navigate,
}: {
  runId: string;
  navigate: (path: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { data, error } = useResource<DeliveryPreparation>(
    "/runs/" + encodeURIComponent(runId) + "/delivery-preparation",
    revision,
  );
  return (
    <main className="delivery-page">
      <div className="section-heading">
        <h1>确认需求交付</h1>
        <div className="actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => navigate("/deliveries")}
          >
            交付版本
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((r) => r + 1)}
          >
            刷新审核依据
          </Button>
        </div>
      </div>
      {!data ? (
        <Load error={error} />
      ) : (
        <FreezeConfirmation
          key={data.token}
          prep={data}
          draft={draft}
          onDraft={setDraft}
          onBusy={setBusy}
          navigate={navigate}
        />
      )}
    </main>
  );
}

function FreezeConfirmation({
  prep,
  draft,
  onDraft,
  onBusy,
  navigate,
}: {
  prep: DeliveryPreparation;
  draft: Record<string, string>;
  onDraft: (values: Record<string, string>) => void;
  onBusy: (busy: boolean) => void;
  navigate: (path: string) => void;
}) {
  const [step, setStep] = useState(1);
  const wizard = useRef<HTMLDivElement>(null);
  function goToStep(next: number) {
    setStep(next);
    requestAnimationFrame(() =>
      wizard.current
        ?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')
        ?.focus(),
    );
  }
  const [mapConfirmed, setMapConfirmed] = useState(false);
  const [materialsConfirmed, setMaterialsConfirmed] = useState(false);
  const [sensitiveInfoReviewed, setSensitiveInfoReviewed] = useState(false);
  const [reasons, setReasons] = useState(() =>
    Object.fromEntries(
      Object.entries(prep.exceptionReasons).map(([id, reason]) => [
        id,
        draft[id] ?? reason,
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unknown, setUnknown] = useState(false);
  const submitted = useRef<FreezeDeliveryInput | null>(null);
  const submitting = useRef(false);
  const ready =
    prep.eligible &&
    mapConfirmed &&
    materialsConfirmed &&
    sensitiveInfoReviewed &&
    Object.values(reasons).every((reason) => reason.trim());
  async function freeze() {
    if (submitting.current || (!submitted.current && !ready)) return;
    submitting.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    submitted.current ??= {
      requestId: crypto.randomUUID(),
      token: prep.token,
      mapConfirmed,
      materialsConfirmed,
      sensitiveInfoReviewed,
      exceptionReasons: reasons,
    };
    try {
      const snapshot = await request<DeliverySnapshot>(
        "/runs/" + encodeURIComponent(prep.run.id) + "/deliveries",
        "POST",
        submitted.current,
      );
      navigate("/deliveries/" + snapshot.id);
    } catch (failure) {
      const uncertain =
        failure instanceof RequestError && failure.phase !== "response";
      setUnknown(uncertain);
      setError(
        uncertain
          ? "提交结果未知，请查看交付版本，或按原内容重试。" + message(failure)
          : message(failure),
      );
      if (!uncertain) submitted.current = null;
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <>
      <h2>{prep.campaign.title}</h2>
      <p>
        {prep.project.name} · <Status value={prep.run.status} context="run" /> ·{" "}
        {prep.run.report.checks.length} 项检查
      </p>
      <p className="muted">
        本次冻结保存指定
        Run，不合并历史结果。改判、撤回、作废或删除来源会使交付失效，原快照内容保留。
      </p>
      {prep.issues.length > 0 && (
        <Alert variant="destructive" role="alert">
          <p>交付准备尚未完成，请在项目侧完成以下条件：</p>
          <ul>
            {prep.issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
          <p>已发布报告不能补挂附件，也不能为补材料伪造验证 Run。</p>
        </Alert>
      )}
      <Frame className="delivery-wizard" ref={wizard}>
        <Stepper value={step}>
          <StepperNav aria-label="交付确认步骤">
            {["代码与构建", "地图与范围", "说明素材", "最终确认"].map(
              (title, index) => (
                <StepperItem
                  key={title}
                  step={index + 1}
                  completed={
                    index === 0
                      ? step > 1
                      : index === 1
                        ? mapConfirmed
                        : index === 2
                          ? materialsConfirmed
                          : false
                  }
                  disabled
                >
                  <StepperTrigger className="disabled:cursor-default disabled:opacity-100">
                    <StepperIndicator>{index + 1}</StepperIndicator>
                    <StepperTitle>{title}</StepperTitle>
                  </StepperTrigger>
                  {index < 3 && <StepperSeparator />}
                </StepperItem>
              ),
            )}
          </StepperNav>
          <FramePanel>
            <StepperPanel>
              <fieldset
                disabled={busy || unknown}
                className="delivery-confirmation"
              >
                <legend className="sr-only">冻结确认</legend>
                <StepperContent value={1} forceMount>
                  <div className="delivery-step-intro">
                    <span className="delivery-step-meta">
                      第一步 · 基线凭据
                    </span>
                    <h3 className="delivery-step-heading">
                      受验代码与实际构建
                    </h3>
                    <p className="delivery-step-desc">
                      核对本次验证绑定的代码版本与实际构建产物。所有代码须干净已提交，构建产物须与本次验证一致。
                    </p>
                  </div>
                  <Disclosure title={<>受验代码与实际构建</>} defaultOpen>
                    <div className="delivery-versions-card">
                      <div className="delivery-section-subtitle">
                        受验代码仓库与提交
                      </div>
                      <div className="delivery-version-list">
                        {(prep.run.report.versions ?? []).map((version) => (
                          <div
                            key={version.repository}
                            className="delivery-version-item"
                          >
                            <div className="delivery-version-main">
                              <span className="delivery-repo-title">
                                {version.repository}
                              </span>
                              <div className="delivery-commit-pill">
                                <span className="delivery-commit-prefix">
                                  Commit
                                </span>
                                <code>{version.commit}</code>
                              </div>
                            </div>
                            <div className="delivery-version-status">
                              {version.dirty === false ? (
                                <Badge variant="success-light">已提交</Badge>
                              ) : (
                                <Badge variant="warning-light">
                                  未提交或未知
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {prep.manifest && (
                      <div className="delivery-build-card">
                        <div className="delivery-build-label">实际构建</div>
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
                    )}
                  </Disclosure>
                </StepperContent>
                <StepperContent value={2} forceMount>
                  <div className="delivery-step-intro">
                    <span className="delivery-step-meta">
                      第二步 · 范围覆盖
                    </span>
                    <h3 className="delivery-step-heading">
                      需求地图与必验范围
                    </h3>
                    <p className="delivery-step-desc">
                      确认交付包含地图中声明的所有功能及其必验项。排除范围须明确公示并经人工核对。
                    </p>
                  </div>
                  {!prep.map && (
                    <div className="delivery-missing-notice">
                      <p>需求地图尚未就绪，请先补齐交付准备条件。</p>
                    </div>
                  )}
                  {prep.map && (
                    <Disclosure title={<>需求地图与必验范围</>} defaultOpen>
                      <div className="delivery-features-stack">
                        {prep.map.features.map((feature) => {
                          const requiredChecks = feature.checks.filter(
                            (check) => check.required,
                          );
                          return (
                            <div
                              key={feature.id}
                              className="delivery-feature-block"
                            >
                              <div className="delivery-feature-header">
                                <div className="delivery-feature-info">
                                  <strong className="delivery-feature-name">
                                    {feature.title}
                                  </strong>
                                  <code className="delivery-feature-code">
                                    {feature.id}
                                  </code>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-xs font-normal"
                                >
                                  {requiredChecks.length} 项必验
                                </Badge>
                              </div>
                              <div className="delivery-checks-table">
                                {requiredChecks.map((check) => (
                                  <div
                                    key={check.id}
                                    className="delivery-check-row"
                                  >
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
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {prep.map.excluded.length > 0 && (
                        <div className="delivery-excluded-card">
                          <span className="delivery-excluded-tag">
                            排除范围
                          </span>
                          <span className="delivery-excluded-content">
                            {prep.map.excluded.join("；")}
                          </span>
                        </div>
                      )}
                      <div className="delivery-map-digest">
                        <span className="delivery-digest-label">
                          地图摘要：
                        </span>
                        <code className="delivery-digest-code">
                          {prep.manifest?.map.sha256}
                        </code>
                      </div>
                    </Disclosure>
                  )}
                  <div
                    className={cn(
                      "delivery-sign-panel",
                      mapConfirmed && "is-confirmed",
                    )}
                  >
                    <Label className="delivery-checkbox flex-row items-center gap-3 cursor-pointer mb-0">
                      <input
                        type="checkbox"
                        checked={mapConfirmed}
                        onChange={(event) =>
                          setMapConfirmed(event.target.checked)
                        }
                      />
                      <span className="delivery-checkbox-label-text">
                        我确认所选地图版本及必验范围准确、完整。
                      </span>
                    </Label>
                  </div>
                </StepperContent>
                <StepperContent value={3} forceMount>
                  <div className="delivery-step-intro">
                    <span className="delivery-step-meta">
                      第三步 · 业务素材
                    </span>
                    <h3 className="delivery-step-heading">业务说明素材</h3>
                    <p className="delivery-step-desc">
                      审阅面向业务人员的功能说明、操作步骤、角色前提、限制条件与真实验证截图。
                    </p>
                  </div>
                  {!prep.materials && (
                    <div className="delivery-missing-notice">
                      <p>说明素材尚未就绪，请先补齐交付准备条件。</p>
                    </div>
                  )}
                  {prep.materials && (
                    <Disclosure title={<>业务说明素材</>} defaultOpen>
                      <div className="delivery-materials-stack">
                        {prep.materials.features.map((feature) => (
                          <section
                            key={feature.featureId}
                            className="delivery-material-card"
                          >
                            <div className="delivery-material-top">
                              <h3 className="delivery-material-title">
                                {prep.map?.features.find(
                                  (item) => item.id === feature.featureId,
                                )?.title ?? feature.featureId}
                              </h3>
                              <p className="delivery-material-summary">
                                {feature.summary}
                              </p>
                            </div>

                            <div className="delivery-material-meta-grid">
                              <div className="delivery-meta-item">
                                <span className="delivery-meta-label">
                                  角色
                                </span>
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
                                <span className="delivery-meta-label">
                                  前提
                                </span>
                                <span className="delivery-meta-value">
                                  {feature.prerequisites.join("；") ||
                                    "未声明额外前提"}
                                </span>
                              </div>
                              <div className="delivery-meta-item">
                                <span className="delivery-meta-label">
                                  限制
                                </span>
                                <span className="delivery-meta-value">
                                  {feature.limitations.join("；") ||
                                    "未声明额外限制"}
                                </span>
                              </div>
                            </div>

                            <div className="delivery-instructions-box">
                              <div className="delivery-instructions-label">
                                操作步骤
                              </div>
                              <ol className="delivery-instructions-list">
                                {feature.steps.map((step, index) => (
                                  <li
                                    key={index}
                                    className="delivery-instruction-item"
                                  >
                                    <span className="delivery-step-index">
                                      {index + 1}
                                    </span>
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
                                    key={
                                      screenshot.path +
                                      "-" +
                                      screenshot.checkIds.join(",")
                                    }
                                    className="delivery-figure-item"
                                  >
                                    <div className="delivery-figure-img-wrap">
                                      <img
                                        loading="lazy"
                                        src={
                                          "/api/v1/runs/" +
                                          encodeURIComponent(prep.run.id) +
                                          "/evidence/" +
                                          encodeURIComponent(screenshot.path)
                                        }
                                        alt={screenshot.caption}
                                      />
                                    </div>
                                    <figcaption className="delivery-figure-caption">
                                      <span className="delivery-caption-title">
                                        {screenshot.caption}
                                      </span>
                                      <div className="delivery-caption-checks">
                                        <span className="delivery-checks-intro">
                                          对应检查：
                                        </span>
                                        {screenshot.checkIds.map((cid) => (
                                          <code
                                            key={cid}
                                            className="delivery-cid-badge"
                                          >
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
                    <Label className="delivery-checkbox flex-row items-center gap-3 cursor-pointer mb-0">
                      <input
                        type="checkbox"
                        checked={materialsConfirmed}
                        onChange={(event) =>
                          setMaterialsConfirmed(event.target.checked)
                        }
                      />
                      <span className="delivery-checkbox-label-text">
                        我已审阅功能说明、操作步骤、角色前提、限制和对应截图。
                      </span>
                    </Label>
                  </div>
                </StepperContent>
                <StepperContent value={4} forceMount>
                  <div className="delivery-step-intro">
                    <span className="delivery-step-meta">
                      第四步 · 签署与冻结
                    </span>
                    <h3 className="delivery-step-heading">最终冻结确认</h3>
                    <p className="delivery-step-desc">
                      完成交付签署前置门禁审查。确认后将为本次 Run
                      产生正式的不可变交付快照版本。
                    </p>
                  </div>

                  <div className="delivery-preflight-card">
                    <div className="delivery-preflight-header">
                      <span className="delivery-preflight-title">
                        交付前置核对清单
                      </span>
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
                        <div className="delivery-status-box-label">
                          地图与必验范围
                        </div>
                        <div className="delivery-status-box-val">
                          {mapConfirmed ? (
                            <Badge variant="success-light">已确认</Badge>
                          ) : (
                            <Badge variant="warning-light">尚未确认</Badge>
                          )}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "delivery-check-status-box",
                          materialsConfirmed ? "is-ready" : "is-pending",
                        )}
                      >
                        <div className="delivery-status-box-label">
                          业务说明素材
                        </div>
                        <div className="delivery-status-box-val">
                          {materialsConfirmed ? (
                            <Badge variant="success-light">已确认</Badge>
                          ) : (
                            <Badge variant="warning-light">尚未确认</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {(!mapConfirmed || !materialsConfirmed) && (
                      <p className="delivery-return-hint">
                        请返回对应步骤，明确确认地图范围和说明素材。
                      </p>
                    )}
                  </div>

                  {Object.keys(reasons).length > 0 && (
                    <section className="delivery-reasons-wrapper">
                      <div className="delivery-reasons-title-row">
                        <h4 className="delivery-reasons-title">
                          原始未通过项的人工接受理由
                        </h4>
                        <span className="delivery-reasons-badge">
                          {Object.keys(reasons).length} 项需人工确认
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
                                    setReasons(values);
                                    onDraft(values);
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
                    <Label className="delivery-checkbox flex-row items-center gap-3 cursor-pointer mb-0">
                      <input
                        type="checkbox"
                        checked={sensitiveInfoReviewed}
                        onChange={(event) =>
                          setSensitiveInfoReviewed(event.target.checked)
                        }
                      />
                      <span className="delivery-checkbox-label-text">
                        我已检查说明素材和截图中的敏感信息，确认可用于业务说明。
                      </span>
                    </Label>
                  </div>
                </StepperContent>
              </fieldset>
            </StepperPanel>
          </FramePanel>
          {error && (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          )}
          <FrameFooter className="wizard-actions flex-row">
            <p role="status" className="muted">
              第 {step} / 4 步
            </p>
            <div className="actions">
              <Button
                variant="outline"
                disabled={busy || unknown || step === 1}
                onClick={() => goToStep(step - 1)}
              >
                上一步
              </Button>
              {step < 4 ? (
                <Button
                  disabled={busy || unknown}
                  onClick={() => goToStep(step + 1)}
                >
                  下一步
                </Button>
              ) : (
                <Button
                  disabled={busy || (!unknown && !ready)}
                  onClick={() => void freeze()}
                >
                  {busy
                    ? "正在保存交付…"
                    : unknown
                      ? "重试原交付确认"
                      : "确认交付并保存快照"}
                </Button>
              )}
            </div>
          </FrameFooter>
        </Stepper>
      </Frame>
    </>
  );
}
