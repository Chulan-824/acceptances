import { useState, type ReactNode } from "react";
import type {
  FeedbackResponse,
  Report,
  Review,
  ReviewCounts as ReviewCountsData,
  ReviewInput,
} from "@acceptances/api-client";
import { message, Status } from "./client";

export interface RunNavigation {
  runPath: (id: string) => string;
  navigate: (path: string) => void;
  onTarget?: (id: string) => void;
}

export function revealTarget(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  let ancestor: HTMLElement | null = target;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  target.scrollIntoView();
}

export function RunLink({
  id,
  target,
  children,
  runPath,
  navigate,
  onTarget,
}: RunNavigation & {
  id: string;
  target?: string;
  children: ReactNode;
}) {
  const href = `${runPath(id)}${target ? `#${encodeURIComponent(target)}` : ""}`;
  return (
    <a
      href={href}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigate(href);
        if (target) {
          if (onTarget) onTarget(target);
          else revealTarget(target);
        }
      }}
    >
      {children}
    </a>
  );
}

export function ScopeType({ value }: { value?: Report["scopeType"] }) {
  const labels = {
    full: "完整验证",
    partial: "局部验证",
    unknown: "范围未知",
  };
  return <span className="badge">{labels[value || "unknown"]}</span>;
}

export function ReviewCounts({ counts }: { counts: ReviewCountsData }) {
  return (
    <span className="check-counts" aria-label="人工评审数量">
      <span className="badge accepted">{counts.accepted} 通过</span>
      <span className="badge rejected">{counts.rejected} 不通过</span>
      <span className="badge pending">{counts.pending} 待审</span>
    </span>
  );
}

export function ReviewForm({
  check,
  isVoid,
  onSubmit,
}: {
  check?: Report["checks"][number];
  isVoid: boolean;
  onSubmit: (input: ReviewInput) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasReason = Boolean(body.trim());
  async function save(kind: Review["kind"]) {
    setBusy(true);
    setError("");
    try {
      await onSubmit({ checkId: check?.id, kind, body: body.trim() });
      setBody("");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="check-review-form"
      aria-label={check ? `人工评审 ${check.title}` : "整轮评论"}
      onSubmit={(event) => event.preventDefault()}
    >
      {check ? (
        <>
          <h3>人工评审</h3>
          <p className="muted">
            {check.status === "passed"
              ? "不通过和评论须填写内容；通过、撤回可不填理由。"
              : "验证未通过，人工通过或不通过均须填写理由；撤回理由可选。"}
            评论不改变人工判断。
          </p>
          {isVoid && <p className="notice">本轮已作废，仅可添加评论。</p>}
        </>
      ) : (
        <p className="muted">
          整轮评论不改变人工状态。没有对应检查项的新问题可在这里说明。
        </p>
      )}
      <label>
        {check ? `评审理由或评论 · ${check.title}` : "整轮评论内容"}
        <textarea
          value={body}
          disabled={busy}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            check ? "填写判断依据或检查项问题" : "填写整体情况或新问题"
          }
        />
      </label>
      <div className="actions">
        {check && (
          <>
            <button
              type="button"
              className="primary-button"
              disabled={
                busy || isVoid || (check.status !== "passed" && !hasReason)
              }
              onClick={() => void save("accepted")}
            >
              人工通过
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || isVoid || !hasReason}
              onClick={() => void save("rejected")}
            >
              人工不通过
            </button>
            <button
              type="button"
              disabled={busy || isVoid}
              onClick={() => void save("pending")}
            >
              撤回到待审
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy || !hasReason}
          onClick={() => void save("comment")}
        >
          {check ? "添加检查项评论" : "添加整轮评论"}
        </button>
      </div>
      {busy && <p role="status">正在保存…</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function ReviewHistory({
  reviews,
  responses,
  runPath,
  navigate,
  onTarget,
}: RunNavigation & {
  reviews: Review[];
  responses: FeedbackResponse[];
}) {
  return reviews.length ? (
    reviews.map((review) => (
      <article
        className="check feedback-entry"
        id={`feedback-${review.id}`}
        key={review.id}
      >
        {review.legacy ? (
          <span className="badge">
            旧规则整轮{review.kind === "accepted" ? "接受" : "拒绝"}
          </span>
        ) : review.kind === "pending" ? (
          <span className="badge pending">撤回到待审</span>
        ) : (
          <Status value={review.kind} />
        )}
        <time dateTime={review.createdAt}>
          {new Date(review.createdAt).toLocaleString()}
        </time>
        {review.body && <p className="prose">{review.body}</p>}
        {review.legacy && (
          <p className="muted">历史决定不计入当前逐项人工评审。</p>
        )}
        {responses
          .filter((response) => response.reviewId === review.id)
          .map((response) => (
            <div className="feedback-response" key={response.runId}>
              <RunLink
                id={response.runId}
                target={
                  response.checkIds.length
                    ? `check-${response.checkIds[0]}`
                    : "follow-up"
                }
                runPath={runPath}
                navigate={navigate}
                onTarget={onTarget}
              >
                查看后续复验 {response.runId.slice(0, 8)}
              </RunLink>
              <p className="prose">{response.explanation}</p>
              <p className="muted">
                {response.checkIds.length
                  ? `关联本次检查项：${response.checkIds.join("、")}`
                  : "没有关联检查项，处理原因见说明。"}
              </p>
            </div>
          ))}
      </article>
    ))
  ) : (
    <p className="muted">尚无人工反馈。</p>
  );
}
