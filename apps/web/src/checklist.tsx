import type { WriteResult } from "./campaign-run-controller";
import { Alert } from "./components/ui/alert";
import { Disclosure } from "./components/disclosure";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import { useState } from "react";
import type {
  Report,
  Review,
  ReviewInput,
  ReviewStatus,
  Run as RunData,
} from "@acceptances/api-client";
import { Status } from "./client";
import { Evidence } from "./evidence";
import { Icon } from "./workspace-controls";
import { ReviewForm, ReviewHistory } from "./review";

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
  onQueryChange,
  onStatusChange,
}: {
  run: RunData;
  disabled: boolean;
  onReview: (input: ReviewInput) => Promise<WriteResult>;
  query: string;
  status: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}) {
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
      [check.id, check.title, check.expected, check.actual].some((text) =>
        text.toLocaleLowerCase().includes(search),
      ),
  );
  return (
    <section aria-labelledby="checks-title">
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
        </div>
      </div>
      <p className="muted" role="status">
        显示 {checks.length} / {report.checks.length} 项
      </p>
      {checks.map((check) => (
        <CheckItem
          key={check.id}
          number={report.checks.indexOf(check) + 1}
          check={check}
          run={run.id}
          evidence={evidence}
          humanStatus={humanStates.get(check.id) || "pending"}
          reviews={reviews.get(check.id) || []}
          responses={run.feedbackResponses}
          isVoid={run.status === "void"}
          disabled={disabled}
          onReview={onReview}
        />
      ))}
      {!checks.length && (
        <p>
          {report.checks.length
            ? "没有匹配的检查项，请调整搜索或状态筛选。"
            : "本次报告没有检查项。"}
        </p>
      )}
    </section>
  );
}

function CheckItem({
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
              {check.evidence.map((path) => {
                const item = evidence.get(path);
                return item ? (
                  <Evidence key={path} run={run} item={item} inline />
                ) : (
                  <Alert role="note" key={path} className="notice">
                    附件清单中未找到 {path}。
                  </Alert>
                );
              })}
            </div>
          ) : (
            <p className="muted">此检查项未关联附件。</p>
          ))}
        <ReviewForm
          check={check}
          isVoid={isVoid}
          disabled={disabled}
          onSubmit={onReview}
        />
        <Disclosure title={<>评审历史 · {reviews.length} 条</>}>
          <ReviewHistory reviews={reviews} responses={responses} />
        </Disclosure>
      </div>
    </Disclosure>
  );
}
