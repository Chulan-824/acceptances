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
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { Disclosure } from "./components/disclosure";

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
                  <Disclosure title={<>受验代码与实际构建</>} defaultOpen>
                    <ul>
                      {(prep.run.report.versions ?? []).map((version) => (
                        <li key={version.repository}>
                          {version.repository} · <code>{version.commit}</code> ·
                          {version.dirty === false ? "已提交" : "未提交或未知"}
                        </li>
                      ))}
                    </ul>
                    {prep.manifest && (
                      <p>
                        构建：
                        {prep.manifest.build.kind === "artifact"
                          ? prep.manifest.build.id
                          : "不适用：" + prep.manifest.build.reason}
                      </p>
                    )}
                  </Disclosure>
                </StepperContent>
                <StepperContent value={2} forceMount>
                  {!prep.map && <p>需求地图尚未就绪，请先补齐交付准备条件。</p>}
                  {prep.map && (
                    <Disclosure title={<>需求地图与必验范围</>} defaultOpen>
                      <ul>
                        {prep.map.features.map((feature) => (
                          <li key={feature.id}>
                            <strong>{feature.title}</strong> ·{" "}
                            <code>{feature.id}</code>
                            <ul>
                              {feature.checks
                                .filter((check) => check.required)
                                .map((check) => (
                                  <li key={check.id}>
                                    {check.title} · <code>{check.id}</code> ·{" "}
                                    {check.expected}
                                  </li>
                                ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                      {prep.map.excluded.length > 0 && (
                        <p>排除范围：{prep.map.excluded.join("；")}</p>
                      )}
                      <p className="muted">
                        地图摘要：<code>{prep.manifest?.map.sha256}</code>
                      </p>
                    </Disclosure>
                  )}
                  <Label className="delivery-checkbox">
                    <input
                      type="checkbox"
                      checked={mapConfirmed}
                      onChange={(event) =>
                        setMapConfirmed(event.target.checked)
                      }
                    />
                    我确认所选地图版本及必验范围准确、完整。
                  </Label>
                </StepperContent>
                <StepperContent value={3} forceMount>
                  {!prep.materials && (
                    <p>说明素材尚未就绪，请先补齐交付准备条件。</p>
                  )}
                  {prep.materials && (
                    <Disclosure title={<>业务说明素材</>} defaultOpen>
                      {prep.materials.features.map((feature) => (
                        <section key={feature.featureId}>
                          <h3>
                            {prep.map?.features.find(
                              (item) => item.id === feature.featureId,
                            )?.title ?? feature.featureId}
                          </h3>
                          <p>{feature.summary}</p>
                          <p>角色：{feature.roles.join("、")}</p>
                          <p>
                            前提：
                            {feature.prerequisites.join("；") ||
                              "未声明额外前提"}
                          </p>
                          <ol>
                            {feature.steps.map((step, index) => (
                              <li key={index}>
                                {step.instruction} · {step.expected}
                              </li>
                            ))}
                          </ol>
                          <p>
                            限制：
                            {feature.limitations.join("；") || "未声明额外限制"}
                          </p>
                          {feature.screenshots.map((screenshot) => (
                            <figure
                              key={
                                screenshot.path +
                                "-" +
                                screenshot.checkIds.join(",")
                              }
                            >
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
                              <figcaption>
                                {screenshot.caption} ·{" "}
                                {screenshot.checkIds.join("、")}
                              </figcaption>
                            </figure>
                          ))}
                          {feature.screenshotOmissionReason && (
                            <p>截图说明：{feature.screenshotOmissionReason}</p>
                          )}
                        </section>
                      ))}
                    </Disclosure>
                  )}
                  <Label className="delivery-checkbox">
                    <input
                      type="checkbox"
                      checked={materialsConfirmed}
                      onChange={(event) =>
                        setMaterialsConfirmed(event.target.checked)
                      }
                    />
                    我已审阅功能说明、操作步骤、角色前提、限制和对应截图。
                  </Label>
                </StepperContent>
                <StepperContent value={4} forceMount>
                  <h3>最终冻结确认</h3>
                  <p>
                    来源 Run：<code>{prep.run.id}</code>
                  </p>
                  <p>
                    地图范围：{mapConfirmed ? "已确认" : "尚未确认"} ·
                    说明素材：{materialsConfirmed ? "已确认" : "尚未确认"}
                  </p>
                  {(!mapConfirmed || !materialsConfirmed) && (
                    <p className="muted">
                      请返回对应步骤，明确确认地图范围和说明素材。
                    </p>
                  )}
                  {Object.keys(reasons).length > 0 && (
                    <section>
                      <h3>原始未通过项的人工接受理由</h3>
                      {Object.entries(reasons).map(([id, reason]) => {
                        const check = prep.run.report.checks.find(
                          (item) => item.id === id,
                        );
                        return (
                          <Label key={id} className="delivery-reason">
                            {check?.title ?? id} ·{" "}
                            <Status value={check?.status ?? ""} />
                            <Textarea
                              required
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
                        );
                      })}
                    </section>
                  )}

                  <Label className="delivery-checkbox">
                    <input
                      type="checkbox"
                      checked={sensitiveInfoReviewed}
                      onChange={(event) =>
                        setSensitiveInfoReviewed(event.target.checked)
                      }
                    />
                    我已检查说明素材和截图中的敏感信息，确认可用于业务说明。
                  </Label>
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
