import { EmptyState } from "./components/reui/empty-state";
import { Frame, FrameHeader } from "./components/reui/frame";
import type { WriteResult } from "./campaign-run-controller";
import { Alert } from "./components/reui/alert";
import { Disclosure } from "./components/disclosure";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import { useEffect, useRef, useState } from "react";
import type {
  Report,
  Review,
  ReviewInput,
  ReviewStatus,
  Run as RunData,
} from "@acceptances/api-client";
import { Status } from "./client";
import { Evidence, isImageEvidence } from "./evidence";
import { Icon } from "./workspace-controls";
import { Button } from "./components/ui/button";
import { ReviewForm, ReviewHistory, type ReviewDraft } from "./review";

const statuses = [
  { value: "all", label: "全部" },
  { value: "passed", label: "通过" },
  { value: "failed", label: "失败" },
  { value: "blocked", label: "阻塞" },
  { value: "skipped", label: "未执行" },
];

export function Checklist({
  run,
  disabled,
  onReview,
  query,
  status,
  humanStatus,
  onHumanStatusChange,
  onQueryChange,
  onStatusChange,
}: {
  run: RunData;
  disabled: boolean;
  onReview: (input: ReviewInput) => Promise<WriteResult>;
  query: string;
  status: string;
  humanStatus: string;
  onHumanStatusChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [advance, setAdvance] = useState<{
    checkId: string;
    query: string;
    status: string;
    humanStatus: string;
  }>();
  const revealed = useRef<typeof advance>(undefined);
  const report = run.report;
  const evidence = new Map(report.evidence?.map((item) => [item.path, item]));
  const humanStates = new Map(
    run.checkReviews.map((item) => [item.checkId, item.status]),
  );
  const reviews = new Map<string, Review[]>();
  for (const review of run.reviews || []) {
    if (!review.checkId) continue;
    const history = reviews.get(review.checkId) || [];
    history.push(review);
    reviews.set(review.checkId, history);
  }
  const search = query.trim().toLocaleLowerCase();
  const checks = report.checks.filter(
    (check) =>
      (status === "all" || check.status === status) &&
      (humanStatus === "all" ||
        (humanStates.get(check.id) || "pending") === humanStatus) &&
      [check.id, check.title, check.expected, check.actual].some((text) =>
        text.toLocaleLowerCase().includes(search),
      ),
  );
  const sourceIndex = report.checks.findIndex(
    (check) => check.id === advance?.checkId,
  );
  const remaining = checks.filter(
    (check) =>
      check.id !== advance?.checkId && humanStates.get(check.id) !== "accepted",
  );
  const nextCheckId = (
    remaining.find((check) => report.checks.indexOf(check) > sourceIndex) ||
    remaining[0]
  )?.id;
  const confirmed = Boolean(
    advance &&
    !disabled &&
    advance.query === query &&
    advance.status === status &&
    advance.humanStatus === humanStatus &&
    humanStates.get(advance.checkId) === "accepted",
  );
  const complete = confirmed && !nextCheckId;
  useEffect(() => {
    if (!confirmed || !nextCheckId || revealed.current === advance) return;
    const element = document.getElementById(`check-${nextCheckId}`);
    if (!element || element.closest("[hidden]")) return;
    element.dispatchEvent(new Event("reveal-disclosure"));
    const frame = requestAnimationFrame(() => {
      element
        .querySelector<HTMLButtonElement>("[data-slot=collapsible-trigger]")
        ?.focus({ preventScroll: true });
      element.scrollIntoView({ block: "start" });
      revealed.current = advance;
    });
    return () => cancelAnimationFrame(frame);
  }, [advance, confirmed, nextCheckId]);
  async function review(input: ReviewInput) {
    setAdvance(undefined);
    const result = await onReview(input);
    if (
      result.kind === "committed" &&
      input.kind === "accepted" &&
      input.checkId
    )
      setAdvance({ checkId: input.checkId, query, status, humanStatus });
    return result;
  }
  return (
    <Frame asChild variant="ghost" spacing="none" className="bg-surface">
      <section aria-labelledby="checks-title">
        <FrameHeader asChild>
          <div className="section-heading checklist-heading">
            <h2 id="checks-title">验收检查清单</h2>
            <div className="checklist-tools">
              <Label className="search-field">
                <span className="sr-only">搜索检查项</span>
                <Icon name="search" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="搜索检查项"
                />
              </Label>
              <Label>
                <span className="sr-only">原始验证结果筛选</span>
                <ChoiceSelect
                  aria-label="原始验证结果筛选"
                  value={status}
                  onValueChange={(value) => onStatusChange(value)}
                >
                  {statuses.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}{" "}
                      {item.value === "all"
                        ? report.checks.length
                        : report.checks.filter(
                            (check) => check.status === item.value,
                          ).length}
                    </SelectItem>
                  ))}
                </ChoiceSelect>
              </Label>
              <Label>
                <span className="sr-only">人工评审状态筛选</span>
                <ChoiceSelect
                  aria-label="人工评审状态筛选"
                  value={humanStatus}
                  onValueChange={onHumanStatusChange}
                >
                  {[
                    ["all", "全部人工状态"],
                    ["pending", "待审"],
                    ["accepted", "人工通过"],
                    ["rejected", "人工不通过"],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}{" "}
                      {value === "all"
                        ? report.checks.length
                        : report.checks.filter(
                            (check) =>
                              (humanStates.get(check.id) || "pending") ===
                              value,
                          ).length}
                    </SelectItem>
                  ))}
                </ChoiceSelect>
              </Label>
              {(query || status !== "all" || humanStatus !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onQueryChange("");
                    onStatusChange("all");
                    onHumanStatusChange("all");
                  }}
                >
                  清除筛选
                </Button>
              )}
            </div>
          </div>
        </FrameHeader>
        <p className="muted" role="status">
          显示 {checks.length} / {report.checks.length} 项
        </p>
        {checks.map((check) => (
          <CheckItem
            key={check.id}
            draft={drafts[check.id]}
            onDraftChange={(draft) =>
              setDrafts((values) => ({ ...values, [check.id]: draft }))
            }
            number={report.checks.indexOf(check) + 1}
            check={check}
            run={run.id}
            evidence={evidence}
            humanStatus={humanStates.get(check.id) || "pending"}
            reviews={reviews.get(check.id) || []}
            responses={run.feedbackResponses}
            isVoid={run.status === "void"}
            disabled={disabled}
            onReview={review}
          />
        ))}
        {complete && (
          <Alert role="status">当前筛选内的检查项已全部人工通过。</Alert>
        )}
        {!checks.length && (
          <EmptyState
            compact
            title={
              report.checks.length ? "没有匹配的检查项" : "本次报告没有检查项"
            }
            description={
              report.checks.length
                ? "请调整关键词、原始验证结果或人工状态。"
                : "报告保存的原始内容中没有检查项。"
            }
          />
        )}
      </section>
    </Frame>
  );
}

function CheckItem({
  draft,
  onDraftChange,
  number,
  check,
  run,
  evidence,
  humanStatus,
  reviews,
  responses,
  isVoid,
  disabled,
  onReview,
}: {
  draft?: ReviewDraft;
  onDraftChange: (draft: ReviewDraft) => void;
  number: number;
  check: Report["checks"][number];
  run: string;
  evidence: Map<string, Report["evidence"][number]>;
  humanStatus: ReviewStatus;
  reviews: Review[];
  responses: RunData["feedbackResponses"];
  isVoid: boolean;
  disabled: boolean;
  onReview: (input: ReviewInput) => Promise<WriteResult>;
}) {
  const [expanded, setExpanded] = useState(humanStatus !== "accepted");
  const [moreExpanded, setMoreExpanded] = useState(false);
  const images = (check.evidence || []).filter(
    (path) => evidence.has(path) && isImageEvidence(path),
  );
  const others = (check.evidence || []).filter(
    (path) => evidence.has(path) && !isImageEvidence(path),
  );
  const missing = (check.evidence || []).filter((path) => !evidence.has(path));
  async function review(input: ReviewInput) {
    const result = await onReview(input);
    if (result.kind === "committed" && input.kind === "accepted")
      setExpanded(false);
    return result;
  }
  return (
    <Disclosure
      className="check-item"
      id={`check-${check.id}`}
      aria-label={`检查项 ${check.title}`}
      open={expanded}
      onOpenChange={setExpanded}
      title={
        <>
          <span className="check-title">
            <code title={check.id}>C{number}</code> {check.title}
          </span>
          <span className="check-meta">
            <span>
              验证 <Status value={check.status} />
            </span>
            <span>
              人工 <Status value={humanStatus} />
            </span>
            <span className="muted">{check.evidence?.length || 0} 个附件</span>
          </span>
          <Icon name="chevron" />
        </>
      }
    >
      <div className="check-body">
        <dl>
          <dt>预期</dt>
          <dd className="prose">{check.expected}</dd>
          <dt>实际</dt>
          <dd className="prose">{check.actual}</dd>
        </dl>
        {expanded &&
          (check.evidence?.length ? (
            <div className="inline-evidence">
              {images.map((path) => (
                <Evidence
                  key={path}
                  run={run}
                  item={evidence.get(path)!}
                  inline
                />
              ))}
              {missing.map((path) => (
                <Alert role="note" key={path} className="notice">
                  附件清单中未找到 {path}。
                </Alert>
              ))}
              {others.length > 0 && (
                <Disclosure
                  open={moreExpanded}
                  onOpenChange={setMoreExpanded}
                  title={<>更多附件（{others.length}）</>}
                >
                  {moreExpanded && (
                    <div className="inline-evidence">
                      {others.map((path) => (
                        <Evidence
                          key={path}
                          run={run}
                          item={evidence.get(path)!}
                          inline
                        />
                      ))}
                    </div>
                  )}
                </Disclosure>
              )}
            </div>
          ) : (
            <p className="muted">此检查项未关联附件。</p>
          ))}
        <ReviewForm
          draft={draft}
          onDraftChange={onDraftChange}
          check={check}
          humanStatus={humanStatus}
          isVoid={isVoid}
          disabled={disabled}
          onSubmit={review}
        />
        <Disclosure title={<>评审历史 · {reviews.length} 条</>}>
          <ReviewHistory reviews={reviews} responses={responses} />
        </Disclosure>
      </div>
    </Disclosure>
  );
}
