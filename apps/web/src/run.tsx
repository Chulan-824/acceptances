import { useEffect, useId, useRef, useState } from "react";
import type { ReviewInput, Run as RunData } from "@acceptances/api-client";
import {
  useResource,
  request,
  message,
  Status,
  Load,
  DeleteButton,
} from "./client";
import { Evidence } from "./evidence";
import { Checklist } from "./checklist";
import { CheckCounts } from "./check-counts";
import {
  ReviewCounts,
  ReviewForm,
  ReviewHistory,
  RunLink,
  ScopeType,
  revealTarget,
  type RunNavigation,
} from "./review";
export function Run({
  id,
  isLatest,
  onChanged,
  onDeleted,
  runPath,
  navigate,
}: RunNavigation & {
  id: string;
  isLatest: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const { data: run, error } = useResource<RunData>(
    `/runs/${id}`,
    revision,
    true,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [checkQuery, setCheckQuery] = useState("");
  const [checkStatus, setCheckStatus] = useState("all");
  const [target, setTarget] = useState<{ id: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewBar = useRef<HTMLDivElement>(null);
  const reviewTitle = useId();
  useEffect(() => {
    if (reviewOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [reviewOpen, run]);
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
  useEffect(() => {
    if (target) revealTarget(target.id);
  }, [target]);
  function showTarget(id: string) {
    setCheckQuery("");
    setCheckStatus("all");
    setTarget({ id });
  }
  useEffect(() => {
    if (!run || !location.hash) return;
    try {
      revealTarget(decodeURIComponent(location.hash.slice(1)));
    } catch {
      // Ignore an invalid URL fragment without interrupting report loading.
    }
  }, [run]);
  async function saveReview(input: ReviewInput) {
    await request(`/runs/${id}/reviews`, "POST", input);
    setReviewOpen(false);
    setRevision((value) => value + 1);
    onChanged();
  }
  async function mutate(path: string, payload: unknown) {
    setBusy(true);
    setActionError("");
    try {
      await request(`/runs/${id}/${path}`, "POST", payload);
      setRevision((r) => r + 1);
      onChanged();
      setReason("");
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!run) return <Load error={error} />;
  const report = run.report;
  return (
    <>
      <section className="report-summary" aria-label="报告摘要">
        <div className="section-heading">
          <h2>{report.title}</h2>
          <DeleteButton
            path={`/runs/${id}`}
            label="验证记录"
            onDeleted={onDeleted}
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
          <p className="notice">作废原因：{run.voidReason}</p>
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
            <span className="muted">全部检查项人工通过后，本轮自动通过。</span>
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
          <p className="notice">
            {report.scopeType === "partial"
              ? "局部验证通过仅代表本轮范围。需求整体仍需最新完整验证的全部检查项人工通过。"
              : "本轮范围未知，人工通过后需求整体仍待审。"}
          </p>
        )}
        <h3>代码版本</h3>
        {report.versions?.length ? (
          <ul>
            {report.versions.map((v, i) => (
              <li key={i}>
                <strong>{v.repository || "未知代码来源"}</strong> ·{" "}
                <code>
                  {!v.commit || v.commit === "unknown" ? "版本未知" : v.commit}
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
      </section>
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
              <RunLink
                id={report.followUp.sourceRunId}
                runPath={runPath}
                navigate={navigate}
                onTarget={showTarget}
              >
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
                    runPath={runPath}
                    navigate={navigate}
                    onTarget={showTarget}
                  >
                    查看原反馈 {response.reviewId.slice(0, 8)}
                  </RunLink>
                )}
                <p className="prose">{response.explanation}</p>
                {response.checkIds.length ? (
                  <div className="actions">
                    <span>本轮关联检查项</span>
                    {response.checkIds.map((checkId) => (
                      <a
                        key={checkId}
                        href={`#${encodeURIComponent(`check-${checkId}`)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(
                            `${runPath(id)}#${encodeURIComponent(`check-${checkId}`)}`,
                          );
                          showTarget(`check-${checkId}`);
                        }}
                      >
                        {checkId}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="muted">未关联本轮检查项，处理原因见说明。</p>
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
        onReview={saveReview}
        runPath={runPath}
        navigate={navigate}
        onTarget={showTarget}
        query={checkQuery}
        status={checkStatus}
        onQueryChange={setCheckQuery}
        onStatusChange={setCheckStatus}
      />
      <section>
        <h2>证据附件</h2>
        {report.evidence?.length ? (
          report.evidence.map((item) => (
            <Evidence key={item.path} run={id} item={item} />
          ))
        ) : (
          <p>本次报告未提供附件。</p>
        )}
      </section>
      <section id="run-feedback">
        <h2>整轮评论与历史决定</h2>
        {!isLatest && (
          <p className="notice">
            这是历史报告，对它的决定不会改变需求当前状态。
          </p>
        )}
        <ReviewHistory
          reviews={(run.reviews || []).filter((review) => !review.checkId)}
          responses={run.feedbackResponses}
          runPath={runPath}
          navigate={navigate}
          onTarget={showTarget}
        />
        <button onClick={() => setReviewOpen(true)}>添加整轮评论</button>
        {run.status !== "void" && (
          <details>
            <summary>报告整体有误：作废</summary>
            <label>
              作废原因
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="danger"
              disabled={busy || !reason.trim()}
              onClick={() => void mutate("void", { reason })}
            >
              确认作废
            </button>
          </details>
        )}
        {actionError && <p role="alert">{actionError}</p>}
      </section>
      <div
        ref={reviewBar}
        className="review-bar"
        role="region"
        aria-label="固定评审操作栏"
      >
        <div className="review-bar-context">
          <span>{isLatest ? "当前报告" : "历史报告"}</span>
          <Status value={run.status} />
          <span className="review-bar-title">{report.title}</span>
        </div>
        <div className="actions">
          <a href="#checks-title">逐项评审</a>
          <a href="#run-feedback">整轮反馈</a>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => setReviewOpen(true)}
          >
            添加整轮评论
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="review-dialog"
        aria-labelledby={reviewTitle}
        onCancel={() => setReviewOpen(false)}
        onClose={() => setReviewOpen(false)}
      >
        {reviewOpen && (
          <>
            <div className="section-heading">
              <h2 id={reviewTitle}>添加整轮评论</h2>
              <button autoFocus onClick={() => setReviewOpen(false)}>
                关闭评论
              </button>
            </div>
            <p className="prose">{report.title}</p>
            <p>
              人工状态 <Status value={run.status} />
            </p>
            {!isLatest && (
              <p className="notice">
                这是历史报告，对它的决定不会改变需求当前状态。
              </p>
            )}
            {run.status === "void" && (
              <p className="notice">
                此 Run 已作废，仅可添加补充说明。作废原因：{run.voidReason}
              </p>
            )}
            <ReviewForm isVoid={run.status === "void"} onSubmit={saveReview} />
          </>
        )}
      </dialog>
    </>
  );
}
