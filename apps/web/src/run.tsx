import { FramePanel } from "./components/reui/frame";
import { Badge } from "./components/reui/badge";
import { Alert } from "./components/reui/alert";
import { RunFollowUp } from "./run-follow-up";
import { BulkAcceptanceDialog } from "./bulk-acceptance-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Disclosure } from "./components/disclosure";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { useEffect, useRef, useState } from "react";
import type { ReviewInput } from "@acceptances/api-client";
import { Status, Load } from "./client";
import { DeleteButton, DeletionFeedback } from "./deletion-controls";
import { useCampaignRun } from "./campaign-run";
import { Evidence } from "./evidence";
import { Checklist } from "./checklist";
import { CheckCounts } from "./check-counts";
import { Icon } from "./workspace-controls";
import { ReviewCounts, ReviewForm, ReviewHistory, ScopeType } from "./review";
import {
  RunNavigationProvider,
  useRunNavigation,
  type RunNavigation,
} from "./run-navigation";
export function Run({
  id,
  isLatest,
  campaignPath,
  runPath,
  navigate,
}: RunNavigation & {
  id: string;
  isLatest: boolean;
  campaignPath: string;
}) {
  const { view, actions } = useCampaignRun();
  const { data: run, error } = view.run;
  const target = {
    kind: "run" as const,
    projectId: view.scope.projectId!,
    campaignId: view.scope.campaignId!,
    runId: id,
    name: run?.report.title || id,
  };
  const deletion = view.operation?.deletion;
  const busy = view.writeLocked;
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const {
    tab,
    setTab,
    checkQuery,
    setCheckQuery,
    checkStatus,
    setCheckStatus,
    humanStatus,
    setHumanStatus,
    showTarget,
    missingTarget,
    returnToOverview,
    reportTop,
    targetNotice,
  } = useRunNavigation(run);
  const deliveryTrigger = useRef<HTMLButtonElement>(null);
  const reviewBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = reviewBar.current;
    const workspace = bar?.closest<HTMLElement>(".workspace");
    if (!bar || !workspace) return;
    const measure = () =>
      workspace.style.setProperty(
        "--review-bar-height",
        `${bar.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    measure();
    return () => {
      observer.disconnect();
      workspace.style.removeProperty("--review-bar-height");
    };
  }, [run?.id]);
  async function saveReview(input: ReviewInput) {
    const result = await actions.review(input);
    if (result.kind === "committed") setDeliveryOpen(false);
    return result;
  }
  async function mutate() {
    setActionError("");
    const result = await actions.voidRun(reason);
    if (result.kind === "committed") setReason("");
    else setActionError(result.message);
  }
  async function acceptAll() {
    setDeliveryError("");
    const result = await actions.acceptAll();
    if (result.kind === "committed") setDeliveryOpen(false);
    else setDeliveryError(result.message);
  }
  if (view.run.status === "missing" && deletion)
    return <DeletionFeedback target={target} navigate={navigate} />;
  if (view.run.status === "missing")
    return (
      <Alert role="alert">
        该验证记录已删除。
        {!deletion && view.operation?.result?.kind === "unknown" && (
          <p>此前提交结果未确认；当前记录已不存在。</p>
        )}
        <Button
          onClick={() => {
            void actions.recoverCampaign();
            navigate(campaignPath);
          }}
        >
          返回需求
        </Button>
      </Alert>
    );
  if (!run && deletion)
    return <DeletionFeedback target={target} navigate={navigate} />;
  if (!run)
    return view.operation?.phase === "submitting" ? (
      <p role="status">正在保存此验证记录，请等待结果。</p>
    ) : (
      <FramePanel asChild variant="flat">
        <section>
          <Load error={error} />
          {!deletion && error && (
            <Button onClick={() => void actions.refresh()}>重试刷新</Button>
          )}
        </section>
      </FramePanel>
    );
  const report = run.report;
  return (
    <RunNavigationProvider value={{ runPath, navigate }}>
      <DeletionFeedback target={target} navigate={navigate} />
      {!deletion && view.operation?.result?.kind === "unknown" && (
        <Alert role="alert">
          提交结果未知，请核对当前记录和评审历史后再决定是否重试。
          {view.operation.result.message}
        </Alert>
      )}
      {!deletion && error && (
        <Alert role="alert">
          {view.operation?.result?.kind === "committed"
            ? "已保存，状态刷新失败"
            : "状态刷新失败"}
          ：{error}
          <Button onClick={() => void actions.refresh()}>重试刷新</Button>
        </Alert>
      )}
      {!deletion && view.operation?.phase === "checking" && !error && (
        <p role="status">
          {view.operation.result?.kind === "committed"
            ? "已保存，正在刷新状态…"
            : "正在核对当前状态…"}
        </p>
      )}

      <div className="report-version-line" ref={reportTop}>
        {report.versions?.map((version, index) => (
          <span key={index} title={`${version.repository} · ${version.commit}`}>
            <Icon name="file" />
            <code>
              {version.commit && version.commit !== "unknown"
                ? version.commit.slice(0, 8)
                : "版本未知"}
            </code>
            <span className="muted">
              {version.dirty === null
                ? "改动未知"
                : version.dirty
                  ? "有未提交改动"
                  : "无未提交改动"}
            </span>
          </span>
        ))}
        <span>
          {isLatest ? "当前报告" : "历史报告"}{" "}
          <Status value={run.status} context="run" />
        </span>
      </div>
      {missingTarget && (
        <Alert role="alert" ref={targetNotice}>
          <p>目标不存在或已不可用</p>
          <Button onClick={returnToOverview}>返回本轮概览</Button>
        </Alert>
      )}
      <Disclosure
        className="report-summary"
        aria-label="报告摘要"
        title={
          <>
            <span>报告信息</span>
            <span className="report-name">{report.title}</span>
            <ScopeType value={report.scopeType} />
            <Icon name="chevron" />
          </>
        }
      >
        <div className="report-summary-body">
          <div className="section-heading">
            <h2>{report.title}</h2>
            <DeleteButton target={target} disabled={busy} />
          </div>
          <p>
            已归档 · {isLatest ? "当前报告" : "历史报告"} · 人工状态{" "}
            <Status value={run.status} context="run" />
          </p>
          <p className="muted">
            保存成功不代表验证通过或人工接受。报告与附件不可原地修改。
          </p>
          {run.status === "void" && (
            <Alert role="note" className="notice">
              作废原因：{run.voidReason}
            </Alert>
          )}
          <FramePanel asChild variant="subtle">
            <div className="report-metrics">
              <div>
                <span className="muted">原始验证结果 · 仅本次</span>
                <CheckCounts checks={report.checks} />
              </div>
              <div>
                <span className="muted">证据附件</span>
                <strong>{report.evidence?.length ?? 0} 个</strong>
              </div>
              <div className="latest-decision">
                <span className="muted">人工评审进度 · 仅本次</span>
                <ReviewCounts counts={run.reviewCounts} />
                <span className="muted">
                  全部检查项人工通过即为本轮已验收，需求交付需另行确认。
                </span>
              </div>
            </div>
          </FramePanel>
          <p className="prose">{report.description}</p>
          <dl>
            <dt>本次验证范围</dt>
            <dd>
              <ScopeType value={report.scopeType} /> {report.scope}
            </dd>
            <dt>验证时间</dt>
            <dd>{new Date(report.verifiedAt).toLocaleString()}</dd>
            <dt>验证环境</dt>
            <dd>
              {!report.environment || report.environment === "unknown"
                ? "未知"
                : report.environment}
            </dd>
          </dl>
          {report.scopeType !== "full" && (
            <Alert role="note" className="notice">
              {report.scopeType === "partial"
                ? "局部验证通过仅代表本轮范围。需求整体仍需最新完整验证的全部检查项人工通过。"
                : "本轮范围未知，人工通过仅代表本轮，不能代表需求整体通过。"}
            </Alert>
          )}
          <h3>代码版本</h3>
          {report.versions?.length ? (
            <ul>
              {report.versions.map((v, i) => (
                <li key={i}>
                  <strong>{v.repository || "未知代码来源"}</strong> ·{" "}
                  <code>
                    {!v.commit || v.commit === "unknown"
                      ? "版本未知"
                      : v.commit}
                  </code>{" "}
                  ·{" "}
                  {v.dirty === null
                    ? "未提交改动未知"
                    : v.dirty
                      ? "存在未提交改动"
                      : "无未提交改动"}
                </li>
              ))}
            </ul>
          ) : (
            <p>代码版本与未提交改动：未知</p>
          )}
        </div>
      </Disclosure>
      {run.status === "void" && (
        <Alert role="note" className="report-notice notice">
          本轮已作废：{run.voidReason}
        </Alert>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(value as "discussion" | "checks" | "files")
        }
      >
        <TabsList className="report-tabs" aria-label="报告视图">
          {(
            [
              {
                value: "discussion",
                label: "讨论",
                icon: "comment",
                count: run.reviews.filter(
                  (review) => !review.checkId && review.kind === "comment",
                ).length,
              },
              {
                value: "checks",
                label: "检查清单",
                icon: "checks",
                count: report.checks.length,
              },
              {
                value: "files",
                label: "文件",
                icon: "file",
                count: report.evidence?.length ?? 0,
              },
            ] as const
          ).map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              id={`report-tab-${item.value}`}
            >
              <Icon name={item.icon} />
              {item.label}
              <Badge className="tab-count">{item.count}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          forceMount
          value="checks"
          id="report-panel-checks"
          className="report-panel"
          hidden={tab !== "checks"}
        >
          <RunFollowUp run={run} id={id} />
          <Checklist
            run={run}
            disabled={busy}
            onReview={saveReview}
            query={checkQuery}
            status={checkStatus}
            humanStatus={humanStatus}
            onHumanStatusChange={setHumanStatus}
            onQueryChange={setCheckQuery}
            onStatusChange={setCheckStatus}
          />
        </TabsContent>
        <TabsContent
          forceMount
          value="files"
          id="report-panel-files"
          className="report-panel"
          hidden={tab !== "files"}
        >
          <section className="file-section">
            <h2 className="sr-only">证据附件</h2>
            <div className="file-grid">
              {report.evidence?.length ? (
                report.evidence.map((item) => (
                  <Evidence
                    key={item.path}
                    run={id}
                    item={item}
                    resources={report.evidence}
                    gallery
                  />
                ))
              ) : (
                <p>本次报告未提供附件。</p>
              )}
            </div>
          </section>
        </TabsContent>
        <TabsContent
          forceMount
          value="discussion"
          id="report-panel-discussion"
          className="report-panel"
          hidden={tab !== "discussion"}
        >
          <FramePanel asChild variant="flat">
            <section id="run-feedback">
              <div className="section-heading">
                <h2>整轮评论与历史决定</h2>
                <Status value={run.status} context="run" />
              </div>
              <ReviewHistory
                reviews={(run.reviews || []).filter(
                  (review) => !review.checkId,
                )}
                responses={run.feedbackResponses}
              />
              <ReviewForm
                isVoid={run.status === "void"}
                disabled={busy}
                onSubmit={saveReview}
              />
              {run.status !== "void" && (
                <Disclosure title={<>报告整体有误：作废</>}>
                  <Label>
                    作废原因
                    <Textarea
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Label>
                  <Button
                    variant="destructive"
                    disabled={busy || !reason.trim()}
                    onClick={() => void mutate()}
                  >
                    确认作废
                  </Button>
                </Disclosure>
              )}
              {actionError && (
                <Alert variant="destructive" role="alert">
                  {actionError}
                </Alert>
              )}
            </section>
          </FramePanel>
        </TabsContent>
      </Tabs>
      <div
        ref={reviewBar}
        className="review-bar"
        role="region"
        aria-label="固定评审操作栏"
      >
        <div className="review-bar-context">
          <span>{isLatest ? "当前报告" : "历史报告"}</span>
          <Status value={run.status} context="run" />
          <span className="review-bar-title">
            已验收 {run.reviewCounts.accepted} / {report.checks.length} 项，剩余{" "}
            {run.reviewCounts.pending} 项待审
            {run.reviewCounts.rejected
              ? `，${run.reviewCounts.rejected} 项不通过`
              : ""}
          </span>
        </div>
        <div className="actions">
          <Button variant="ghost" onClick={() => showTarget("checks-title")}>
            逐项评审
          </Button>
          <Button variant="ghost" onClick={() => showTarget("run-feedback")}>
            讨论
          </Button>
          <Button
            variant="default"
            ref={deliveryTrigger}
            disabled={
              busy ||
              run.status === "void" ||
              run.status === "accepted" ||
              !report.checks.length
            }
            onClick={() => {
              setDeliveryError("");
              setDeliveryOpen(true);
            }}
          >
            {run.status === "accepted" ? "本轮已验收" : "全部人工通过"}
          </Button>
        </div>
      </div>
      <BulkAcceptanceDialog
        run={run}
        busy={busy}
        open={deliveryOpen}
        error={deliveryError}
        trigger={deliveryTrigger}
        onOpenChange={setDeliveryOpen}
        onConfirm={acceptAll}
      />
    </RunNavigationProvider>
  );
}
