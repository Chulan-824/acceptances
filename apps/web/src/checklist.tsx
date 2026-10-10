import { useState } from "react";
import type { Report } from "@acceptances/api-client";
import { Status } from "./client";
import { Evidence } from "./evidence";
import { FilterBar } from "./filter-bar";

const statuses = [
  { value: "all", label: "全部" },
  { value: "passed", label: "通过" },
  { value: "failed", label: "失败" },
  { value: "blocked", label: "阻塞" },
  { value: "skipped", label: "未执行" },
];

export function Checklist({ run, report }: { run: string; report: Report }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const evidence = new Map(report.evidence?.map((item) => [item.path, item]));
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="标题、预期或实际结果"
        />
      </label>
      <FilterBar
        label="检查项状态筛选"
        value={status}
        onChange={setStatus}
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
        <CheckItem key={check.id} check={check} run={run} evidence={evidence} />
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
}: {
  check: Report["checks"][number];
  run: string;
  evidence: Map<string, Report["evidence"][number]>;
}) {
  const [expanded, setExpanded] = useState(check.status !== "passed");
  return (
    <details
      className="check-item"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="check-title">
          <code>{check.id}</code> {check.title}
        </span>
        <span className="check-meta">
          <Status value={check.status} />
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
      </div>
    </details>
  );
}
