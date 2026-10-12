import { Card } from "./components/ui/card";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { useState } from "react";
import type {
  FeedbackResponse,
  Report,
  Review,
  ReviewCounts as ReviewCountsData,
  ReviewInput,
} from "@acceptances/api-client";
import { message, Status } from "./client";

import { RunLink } from "./run-navigation";

export function ScopeType({ value }: { value?: Report["scopeType"] }) {
  const labels = {
    full: "完整验证",
    partial: "局部验证",
    unknown: "范围未知",
  };
  return <Badge className="badge">{labels[value || "unknown"]}</Badge>;
}

export function ReviewCounts({ counts }: { counts: ReviewCountsData }) {
  return (
    <span className="check-counts" aria-label="人工评审数量">
      <Badge className="badge accepted">{counts.accepted} 通过</Badge>
      <Badge className="badge rejected">{counts.rejected} 不通过</Badge>
      <Badge className="badge pending">{counts.pending} 待审</Badge>
    </span>
  );
}

export function ReviewForm({
  check,
  isVoid,
  disabled = false,
  onSubmit,
}: {
  check?: Report["checks"][number];
  isVoid: boolean;
  disabled?: boolean;
  onSubmit: (input: ReviewInput) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<Review["kind"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasReason = Boolean(body.trim());
  const locked = busy || disabled;
  async function save(kind: Review["kind"]) {
    if (locked) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({ checkId: check?.id, kind, body: body.trim() });
      setBody("");
      setEditing(undefined);
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
      {check && isVoid && (
        <Alert role="note" className="notice">
          本轮已作废，仅可添加评论。
        </Alert>
      )}
      {(!check || editing) && (
        <Card className="review-editor">
          <p className="muted">
            {check
              ? editing === "rejected"
                ? "请说明不通过的理由。"
                : editing === "accepted"
                  ? "验证未通过，请说明人工接受的理由。"
                  : "评论不改变人工判断。"
              : "整轮评论不改变人工状态。没有对应检查项的新问题可在这里说明。"}
          </p>
          <Label>
            {check ? `评审理由或评论 · ${check.title}` : "整轮评论内容"}
            <Textarea
              value={body}
              disabled={locked}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                check ? "填写判断依据或检查项问题" : "对整次交付说点什么…"
              }
            />
          </Label>
          <div className="actions">
            {check && (
              <Button
                type="button"
                disabled={locked}
                onClick={() => setEditing(undefined)}
              >
                取消
              </Button>
            )}
            <Button
              type="button"
              variant={editing === "rejected" ? "destructive" : "default"}
              disabled={
                locked ||
                !hasReason ||
                (isVoid && editing !== "comment" && Boolean(check))
              }
              onClick={() => void save(editing || "comment")}
            >
              {!check
                ? "添加整轮评论"
                : editing === "rejected"
                  ? "确认不通过"
                  : editing === "accepted"
                    ? "确认人工通过"
                    : "保存检查项评论"}
            </Button>
          </div>
        </Card>
      )}
      {check && !editing && (
        <div className="actions check-review-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={locked || isVoid}
            onClick={() => void save("pending")}
          >
            撤回到待审
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={() => setEditing("comment")}
          >
            添加检查项评论
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={locked || isVoid}
            onClick={() => setEditing("rejected")}
          >
            人工不通过
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={locked || isVoid}
            onClick={() =>
              check.status === "passed"
                ? void save("accepted")
                : setEditing("accepted")
            }
          >
            人工通过
          </Button>
        </div>
      )}
      {busy && <p role="status">正在保存…</p>}
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}

export function ReviewHistory({
  reviews,
  responses,
}: {
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
          <Badge className="badge">
            旧规则整轮{review.kind === "accepted" ? "接受" : "拒绝"}
          </Badge>
        ) : review.kind === "pending" ? (
          <Badge className="badge pending">撤回到待审</Badge>
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
