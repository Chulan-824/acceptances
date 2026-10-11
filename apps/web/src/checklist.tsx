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
import { FilterBar } from "./filter-bar";
import { ReviewForm, ReviewHistory, type RunNavigation } from "./review";

const statuses = [
  { value: "all", label: "全部" },
  { value: "passed", label: "通过" },
  { value: "failed", label: "失败" },
  { value: "blocked", label: "阻塞" },
  { value: "skipped", label: "未执行" },
];

export function Checklist({
  run,
  onReview,
  runPath,
  navigate,
  onTarget,
  query,
  status,
  onQueryChange,
  onStatusChange,
}: RunNavigation & {
  run: RunData;
  onReview: (input: ReviewInput) => Promise<void>;
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
      <div className="section-heading">
        <h2 id="checks-title">检查项（仅本次）</h2>
        <span className="muted">{report.checks.length} 项检查</span>
      </div>
      <label className="search-field">
        搜索检查项
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="标题、预期或实际结果"
        />
      </label>
      <FilterBar
        label="原始验证结果筛选"
        value={status}
        onChange={onStatusChange}
        options={statuses.map((item) => ({
          ...item,
          count:
            item.value === "all"
              ? report.checks.length
              : report.checks.filter((check) => check.status === item.value)
                  .length,
        }))}
      />
      <p className="muted" role="status">
        显示 {checks.length} / {report.checks.length} 项
      </p>
      {checks.map((check) => (
        <CheckItem
          key={check.id}
          check={check}
          run={run.id}
          evidence={evidence}
          humanStatus={humanStates.get(check.id) || "pending"}
          reviews={reviews.get(check.id) || []}
          responses={run.feedbackResponses}
          isVoid={run.status === "void"}
          onReview={onReview}
          runPath={runPath}
          navigate={navigate}
          onTarget={onTarget}
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
  check,
  run,
  evidence,
  humanStatus,
  reviews,
  responses,
  isVoid,
  onReview,
  runPath,
  navigate,
  onTarget,
}: RunNavigation & {
  check: Report["checks"][number];
  run: string;
  evidence: Map<string, Report["evidence"][number]>;
  humanStatus: ReviewStatus;
  reviews: Review[];
  responses: RunData["feedbackResponses"];
  isVoid: boolean;
  onReview: (input: ReviewInput) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(
    check.status !== "passed" || humanStatus === "pending",
  );
  return (
    <details
      className="check-item"
      id={`check-${check.id}`}
      aria-label={`检查项 ${check.title}`}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="check-title">
          <code>{check.id}</code> {check.title}
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
      </summary>
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
                  <p key={path} className="notice">
                    附件清单中未找到 {path}。
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="muted">此检查项未关联附件。</p>
          ))}
        <ReviewForm check={check} isVoid={isVoid} onSubmit={onReview} />
        <details>
          <summary>评审历史 · {reviews.length} 条</summary>
          <ReviewHistory
            reviews={reviews}
            responses={responses}
            runPath={runPath}
            navigate={navigate}
            onTarget={onTarget}
          />
        </details>
      </div>
    </details>
  );
}
