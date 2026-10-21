import type { Run } from "@acceptances/api-client";
import { evidenceURL } from "@acceptances/api-client";
import { Alert } from "./components/reui/alert";
import { Disclosure } from "./components/disclosure";
import { CheckCounts } from "./check-counts";
import { ReviewHistory } from "./review";

export function ConsolidatedRuns({
  run,
  runPath,
}: {
  run: Run;
  runPath: (id: string) => string;
}) {
  if (!run.consolidatedRuns?.length) return null;
  return (
    <Disclosure
      title={`合并归档 · ${run.consolidatedRuns.length} 份早期记录`}
      aria-label="合并归档"
    >
      <p>
        本需求以当前完整报告作为一轮验收。早期验证保留原时间、结果与附件，不计为独立轮次，不参与当前结果计算。
      </p>
      <ul>
        {run.consolidatedRuns.map((c) => (
          <li key={c.id}>
            <a href={runPath(c.sourceRunId)}>{c.title}</a>
            <p>
              {new Date(c.verifiedAt).toLocaleString()} · {c.evidenceCount}{" "}
              个原始附件
            </p>
            <p>{c.reason}</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function ConsolidatedRunArchive({
  run,
  runPath,
}: {
  run: Run;
  runPath: (id: string) => string;
}) {
  const c = run.consolidatedInto!;
  return (
    <section aria-label="合并后的早期验证记录">
      <Alert role="note">
        本报告已作为早期记录合并留档，不计为独立验收轮次。
        <a href={runPath(c.primaryRunId)}>前往当前验收报告</a>
      </Alert>
      <h2>{run.report.title}</h2>
      <p>原验证时间：{new Date(run.report.verifiedAt).toLocaleString()}</p>
      <p>{c.reason}</p>
      <CheckCounts checks={run.report.checks} />
      <p>{run.report.description}</p>
      <p>原验证范围：{run.report.scope}</p>
      <p>原验证环境：{run.report.environment}</p>
      <Disclosure title={`原始附件 · ${run.report.evidence.length} 个`}>
        <ul>
          {run.report.evidence.map((e) => (
            <li key={e.path}>
              <a
                href={evidenceURL(run.id, e.path)}
                target="_blank"
                rel="noreferrer"
              >
                {e.path}
              </a>{" "}
              · {e.description}
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title={`原始检查项 · ${run.report.checks.length} 项`}>
        {run.report.checks.map((check) => (
          <section key={check.id}>
            <h3>{check.title}</h3>
            <p>原始结果：{check.status}</p>
            <p>预期：{check.expected}</p>
            <p>实际：{check.actual}</p>
            <ul>
              {check.evidence.map((path) => (
                <li key={path}>
                  <a
                    href={evidenceURL(run.id, path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {path}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Disclosure>
      <ReviewHistory reviews={run.reviews} responses={run.feedbackResponses} />
    </section>
  );
}
