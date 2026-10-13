import { Badge } from "./components/ui/badge";
import { Alert } from "./components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Disclosure } from "./components/disclosure";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { useEffect, useRef, useState } from "react";
import type { ReviewInput } from "@acceptances/api-client";
import { Status, Load, DeleteButton } from "./client";
import { useCampaignRun } from "./campaign-run";
import { Evidence } from "./evidence";
import { Checklist } from "./checklist";
import { CheckCounts } from "./check-counts";
import { Icon } from "./workspace-controls";
import { ReviewCounts, ReviewForm, ReviewHistory, ScopeType } from "./review";
import {
  RunLink,
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
  if (view.run.status === "missing")
    return (
      <Alert role="alert">
        该验证记录已删除。
        {view.operation?.result?.kind === "unknown" && (
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
  if (!run)
    return view.operation?.phase === "submitting" ? (
      <p role="status">正在保存此验证记录，请等待结果。</p>
    ) : (
      <section>
        <Load error={error} />
        {error && (
          <Button onClick={() => void actions.refresh()}>重试刷新</Button>
        )}
      </section>
    );
  const report = run.report;
  const rejectedIDs = new Set(
    run.checkReviews
      .filter((item) => item.status === "rejected")
      .map((item) => item.checkId),
  );
  const rejectedChecks = report.checks.filter((check) =>
    rejectedIDs.has(check.id),
  );
  const exceptionalChecks = report.checks.filter(
    (check) => check.status !== "passed",
  );
  return (
    <RunNavigationProvider value={{ runPath, navigate }}>
      {view.operation?.result?.kind === "unknown" && (
        <Alert role="alert">
          提交结果未知，请核对当前记录和评审历史后再决定是否重试。
          {view.operation.result.message}
        </Alert>
      )}
      {error && (
        <Alert role="alert">
          {view.operation?.result?.kind === "committed"
            ? "已保存，状态刷新失败"
            : "状态刷新失败"}
          ：{error}
          <Button onClick={() => void actions.refresh()}>重试刷新</Button>
        </Alert>
      )}
      {view.operation?.phase === "checking" && !error && (
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
          {isLatest ? "当前报告" : "历史报告"} <Status value={run.status} />
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
            <DeleteButton
              path={`/runs/${id}`}
              label="验证记录"
              disabled={busy}
              commands={{
                preview: actions.previewDeleteRun,
                remove: actions.deleteRun,
              }}
            />
          </div>
          <p>
            已归档 · {isLatest ? "当前报告" : "历史报告"} · 人工状态{" "}
            <Status value={run.status} />
          </p>
          <p className="muted">
            保存成功不代表验证通过或人工接受。报告与附件不可原地修改。
          </p>
          {run.status === "void" && (
            <Alert role="note" className="notice">
              作废原因：{run.voidReason}
            </Alert>
          )}
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
              <span className="muted">全部检查项人工通过即为本轮交付。</span>
            </div>
          </div>
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
      {!isLatest && (
        <Alert role="note" className="report-notice notice">
          这是历史报告，对它的决定不会改变需求当前状态。
        </Alert>
      )}
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
          {report.followUp && (
            <section id="follow-up" aria-label="反馈处理与复验来源">
              <h2>反馈处理与复验来源</h2>
              <p>
                来源 Run：{" "}
                {run.sourceRunAvailable === false ? (
                  <span>
                    来源已删除 · <code>{report.followUp.sourceRunId}</code>
                  </span>
                ) : (
                  <RunLink id={report.followUp.sourceRunId}>
                    {report.followUp.sourceRunId}
                  </RunLink>
                )}
              </p>
              <p className="muted">
                处理说明保留 Agent 本次声明，本轮仍需独立人工评审。
              </p>
              {report.followUp.responses.length ? (
                report.followUp.responses.map((response) => (
                  <article className="check" key={response.reviewId}>
                    {run.sourceRunAvailable === false ? (
                      <span>
                        原反馈已删除 · <code>{response.reviewId}</code>
                      </span>
                    ) : (
                      <RunLink
                        id={report.followUp!.sourceRunId}
                        target={`feedback-${response.reviewId}`}
                      >
                        查看原反馈 {response.reviewId.slice(0, 8)}
                      </RunLink>
                    )}
                    <p className="prose">{response.explanation}</p>
                    {response.checkIds.length ? (
                      <div className="actions">
                        <span>本轮关联检查项</span>
                        {response.checkIds.map((checkId) => (
                          <RunLink
                            key={checkId}
                            id={id}
                            target={`check-${checkId}`}
                          >
                            {checkId}
                          </RunLink>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">
                        未关联本轮检查项，处理原因见说明。
                      </p>
                    )}
                  </article>
                ))
              ) : (
                <p className="muted">本轮未填写反馈响应。</p>
              )}
            </section>
          )}
          <Checklist
            run={run}
            disabled={busy}
            onReview={saveReview}
            query={checkQuery}
            status={checkStatus}
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
                  <Evidence key={item.path} run={id} item={item} gallery />
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
          <section id="run-feedback">
            <div className="section-heading">
              <h2>整轮评论与历史决定</h2>
              <Status value={run.status} />
            </div>
            {!isLatest && (
              <Alert role="note" className="notice">
                这是历史报告，对它的决定不会改变需求当前状态。
              </Alert>
            )}
            <ReviewHistory
              reviews={(run.reviews || []).filter((review) => !review.checkId)}
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
          <Status value={run.status} />
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
            {run.status === "accepted" ? "本轮已交付" : "一键交付"}
          </Button>
        </div>
      </div>
      <Dialog
        open={deliveryOpen}
        onOpenChange={(open) => {
          if (!busy) setDeliveryOpen(open);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            deliveryTrigger.current?.focus();
          }}
          className="review-dialog"
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogDescription className="sr-only">
            确认本轮全部检查项人工通过，原始验证结果与历史判断保留。
          </DialogDescription>
          <>
            <div className="section-heading">
              <DialogTitle>确认本轮交付</DialogTitle>
              <Button
                autoFocus
                disabled={busy}
                onClick={() => setDeliveryOpen(false)}
              >
                取消
              </Button>
            </div>
            <p className="prose">{report.title}</p>
            <p>
              人工状态 <Status value={run.status} />
            </p>
            {!isLatest && (
              <Alert role="note" className="notice">
                这是历史报告，对它的决定不会改变需求当前状态。
              </Alert>
            )}
            {run.status === "void" && (
              <Alert role="note" className="notice">
                此 Run 已作废，仅可添加补充说明。作废原因：{run.voidReason}
              </Alert>
            )}
            <p>
              本轮共 {report.checks.length}{" "}
              项，确认后全部人工通过，不受当前搜索或筛选影响。
            </p>
            <ReviewCounts counts={run.reviewCounts} />
            {rejectedChecks.length > 0 && (
              <Alert role="note" className="notice">
                <p>
                  以下 {rejectedChecks.length}{" "}
                  项已有人工不通过判断，将改为通过，原判断保留在历史中。
                </p>
                <ul>
                  {rejectedChecks.map((check) => (
                    <li key={check.id}>
                      {check.id} · {check.title}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {exceptionalChecks.length > 0 && (
              <Alert role="note" className="notice">
                <p>
                  以下项目原始验证未通过。确认交付表示你仍同意这些项目，无需填写理由；原始结果保持不变。
                </p>
                <ul>
                  {exceptionalChecks.map((check) => (
                    <li key={check.id}>
                      {check.id} · {check.title} <Status value={check.status} />
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {report.scopeType !== "full" && (
              <Alert role="note" className="notice">
                {report.scopeType === "partial"
                  ? "本轮为局部验证"
                  : "本轮范围未知"}
                ，交付仅代表本轮范围，不能代表需求整体通过。
              </Alert>
            )}
            <p className="muted">
              已通过项保留当前判断。本轮交付后仍可逐项改判或撤回。
            </p>
            {deliveryError && (
              <Alert variant="destructive" role="alert">
                {deliveryError}
              </Alert>
            )}
            {busy && <p role="status">正在交付…</p>}
            <div className="actions">
              <Button
                variant="default"
                disabled={
                  busy || run.status === "void" || run.status === "accepted"
                }
                onClick={() => void acceptAll()}
              >
                确认交付
              </Button>
            </div>
          </>
        </DialogContent>
      </Dialog>
    </RunNavigationProvider>
  );
}
