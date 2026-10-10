import { useEffect, useId, useRef, useState } from "react";
import type { Run as RunData } from "@acceptances/api-client";
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
export function Run({
  id,
  isLatest,
  onChanged,
  onDeleted,
}: {
  id: string;
  isLatest: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const { data: run, error } = useResource<RunData>(`/runs/${id}`, revision);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewTitle = useId();
  useEffect(() => {
    if (reviewOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [reviewOpen, run]);
  async function mutate(path: string, payload: unknown) {
    setBusy(true);
    setActionError("");
    try {
      await request(`/runs/${id}/${path}`, "POST", payload);
      if (path === "reviews") setReviewOpen(false);
      setRevision((r) => r + 1);
      onChanged();
      if (path === "reviews") setBody("");
      else setReason("");
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!run) return <Load error={error} />;
  const report = run.report;
  const latestDecision = run.reviews?.reduce<
    RunData["reviews"][number] | undefined
  >(
    (latest, review) =>
      review.kind !== "comment" &&
      (!latest || new Date(review.createdAt) >= new Date(latest.createdAt))
        ? review
        : latest,
    undefined,
  );
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
            <span className="muted">检查结果 · 仅本次</span>
            <CheckCounts checks={report.checks} />
          </div>
          <div>
            <span className="muted">证据附件</span>
            <strong>{report.evidence?.length ?? 0} 个</strong>
          </div>
          <div className="latest-decision">
            <span className="muted">最近人工决定 · 此 Run</span>
            {latestDecision ? (
              <>
                <Status value={latestDecision.kind} />
                <time dateTime={latestDecision.createdAt}>
                  {new Date(latestDecision.createdAt).toLocaleString()}
                </time>
                {latestDecision.body && (
                  <p className="prose">{latestDecision.body}</p>
                )}
              </>
            ) : (
              <span>尚无接受或拒绝决定</span>
            )}
          </div>
        </div>
        <p className="prose">{report.description}</p>
        <dl>
          <dt>本次验证范围</dt>
          <dd>{report.scope}</dd>
          <dt>验证时间</dt>
          <dd>{new Date(report.verifiedAt).toLocaleString()}</dd>
          <dt>验证环境</dt>
          <dd>
            {!report.environment || report.environment === "unknown"
              ? "未知"
              : report.environment}
          </dd>
        </dl>
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
      <Checklist run={id} report={report} />
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
        <h2>人工反馈与补充说明</h2>
        {!isLatest && (
          <p className="notice">
            这是历史报告，对它的决定不会改变需求当前状态。
          </p>
        )}
        {run.reviews?.length ? (
          run.reviews.map((review) => (
            <article className="check" key={review.id}>
              <Status value={review.kind} />
              <time>{new Date(review.createdAt).toLocaleString()}</time>
              <p className="prose">{review.body}</p>
            </article>
          ))
        ) : (
          <p>尚无反馈。</p>
        )}
        <button onClick={() => setReviewOpen(true)}>录入人工反馈</button>
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
      <div className="review-bar" role="region" aria-label="固定评审操作栏">
        <div className="review-bar-context">
          <span>{isLatest ? "当前报告" : "历史报告"}</span>
          <Status value={run.status} />
          <span className="review-bar-title">{report.title}</span>
        </div>
        <div className="actions">
          <a href="#run-feedback">查看反馈</a>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => setReviewOpen(true)}
          >
            评审此 Run
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
              <h2 id={reviewTitle}>评审此 Run</h2>
              <button autoFocus onClick={() => setReviewOpen(false)}>
                关闭评审
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
            <label>
              反馈内容
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="补充说明、纠错或人工决定的依据"
              />
            </label>
            <div className="actions">
              <button
                disabled={busy || !body.trim()}
                onClick={() =>
                  void mutate("reviews", { kind: "comment", body })
                }
              >
                添加补充说明
              </button>
              <button
                disabled={busy || run.status === "void"}
                onClick={() =>
                  void mutate("reviews", { kind: "accepted", body })
                }
              >
                接受此 Run
              </button>
              <button
                disabled={busy || run.status === "void"}
                onClick={() =>
                  void mutate("reviews", { kind: "rejected", body })
                }
              >
                拒绝此 Run
              </button>
            </div>
            {busy && <p role="status">正在保存评审…</p>}
            {actionError && <p role="alert">{actionError}</p>}
          </>
        )}
      </dialog>
    </>
  );
}
