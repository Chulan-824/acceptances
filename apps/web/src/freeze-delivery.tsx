import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Check,
  ShieldCheck,
  AlertCircle,
  FileCheck2,
  FolderGit2,
} from "lucide-react";
import {
  RequestError,
  request,
  type DeliveryPreparation,
  type DeliverySnapshot,
  type FreezeDeliveryInput,
} from "@acceptances/api-client";
import { Load, message, Status, useResource } from "./client";
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
import { Alert } from "./components/reui/alert";
import { Badge } from "./components/reui/badge";
import { Button } from "./components/ui/button";
import {
  StepCodeAndBuild,
  StepMapAndScope,
} from "./freeze-delivery-step-baseline";
import {
  StepBusinessMaterials,
  StepFinalConfirmation,
} from "./freeze-delivery-step-review";

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
        <div className="flex items-center gap-2">
          <FileCheck2 size={20} className="text-muted" />
          <h1 className="m-0 text-xl font-medium tracking-tight">
            确认需求交付
          </h1>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => navigate("/deliveries")}
          >
            <ArrowLeft size={14} />
            交付版本
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
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

  const stepTitles = ["代码与构建", "地图与范围", "说明素材", "最终确认"];

  return (
    <>
      <div className="delivery-summary-card">
        <div className="delivery-summary-top">
          <div className="delivery-summary-titles">
            <div className="delivery-summary-project">
              <FolderGit2 size={13} className="text-muted" />
              <span>{prep.project.name}</span>
            </div>
            <h2 className="delivery-summary-campaign">{prep.campaign.title}</h2>
          </div>
          <div className="delivery-summary-status-cluster">
            <Status value={prep.run.status} context="run" />
            <Badge variant="outline" className="text-xs font-normal">
              {prep.run.report.checks.length} 项检查
            </Badge>
          </div>
        </div>
        <p className="delivery-summary-footnote">
          本次冻结保存指定
          Run，不合并历史结果。改判、撤回、作废或删除来源会使交付失效，原快照内容保留。
        </p>
      </div>

      {prep.issues.length > 0 && (
        <Alert variant="destructive" role="alert" className="my-4">
          <div className="flex items-center gap-2 font-medium mb-1.5">
            <AlertCircle size={16} />
            <span>交付准备尚未完成，请在项目侧完成以下条件：</span>
          </div>
          <ul className="list-disc pl-5 my-2 space-y-1 text-sm">
            {prep.issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
          <p className="text-xs text-muted mb-0">
            已发布报告不能补挂附件，也不能为补材料伪造验证 Run。
          </p>
        </Alert>
      )}

      <Frame className="delivery-wizard" ref={wizard}>
        <Stepper
          value={step}
          indicators={{
            completed: <Check size={12} strokeWidth={2.5} />,
          }}
        >
          <StepperNav
            aria-label="交付确认步骤"
            className="delivery-stepper-nav"
          >
            {stepTitles.map((title, index) => {
              const currentStepNumber = index + 1;
              const isCompleted =
                index === 0
                  ? step > 1
                  : index === 1
                    ? mapConfirmed
                    : index === 2
                      ? materialsConfirmed
                      : false;

              return (
                <StepperItem
                  key={title}
                  step={currentStepNumber}
                  completed={isCompleted}
                  disabled
                >
                  <StepperTrigger className="disabled:cursor-default disabled:opacity-100">
                    <StepperIndicator>{currentStepNumber}</StepperIndicator>
                    <StepperTitle>{title}</StepperTitle>
                  </StepperTrigger>
                  {index < 3 && <StepperSeparator />}
                </StepperItem>
              );
            })}
          </StepperNav>

          <FramePanel>
            <StepperPanel>
              <fieldset
                disabled={busy || unknown}
                className="delivery-confirmation"
              >
                <legend className="sr-only">冻结确认</legend>

                <StepperContent value={1} forceMount>
                  <StepCodeAndBuild prep={prep} />
                </StepperContent>

                <StepperContent value={2} forceMount>
                  <StepMapAndScope
                    prep={prep}
                    mapConfirmed={mapConfirmed}
                    onMapConfirmedChange={setMapConfirmed}
                  />
                </StepperContent>

                <StepperContent value={3} forceMount>
                  <StepBusinessMaterials
                    prep={prep}
                    materialsConfirmed={materialsConfirmed}
                    onMaterialsConfirmedChange={setMaterialsConfirmed}
                  />
                </StepperContent>

                <StepperContent value={4} forceMount>
                  <StepFinalConfirmation
                    prep={prep}
                    mapConfirmed={mapConfirmed}
                    materialsConfirmed={materialsConfirmed}
                    sensitiveInfoReviewed={sensitiveInfoReviewed}
                    onSensitiveInfoReviewedChange={setSensitiveInfoReviewed}
                    reasons={reasons}
                    onReasonsChange={(vals) => {
                      setReasons(vals);
                      onDraft(vals);
                    }}
                  />
                </StepperContent>
              </fieldset>
            </StepperPanel>
          </FramePanel>

          {error && (
            <Alert variant="destructive" role="alert" className="mx-6 mb-4">
              {error}
            </Alert>
          )}

          <FrameFooter className="wizard-actions flex-row items-center justify-between">
            <span role="status" className="text-xs text-muted font-medium">
              第 {step} / 4 步
            </span>
            <div className="actions flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || unknown || step === 1}
                onClick={() => goToStep(step - 1)}
              >
                <ArrowLeft size={14} />
                上一步
              </Button>
              {step < 4 ? (
                <Button
                  size="sm"
                  disabled={busy || unknown}
                  onClick={() => goToStep(step + 1)}
                >
                  下一步
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || (!unknown && !ready)}
                  onClick={() => void freeze()}
                >
                  {busy ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      正在保存交付…
                    </>
                  ) : unknown ? (
                    <>
                      <RefreshCw size={14} />
                      重试原交付确认
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={14} />
                      确认交付并保存快照
                    </>
                  )}
                </Button>
              )}
            </div>
          </FrameFooter>
        </Stepper>
      </Frame>
    </>
  );
}
