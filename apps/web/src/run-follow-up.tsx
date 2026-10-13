import type { Run as RunData } from "@acceptances/api-client";
import { RunLink } from "./run-navigation";

export function RunFollowUp({ run, id }: { run: RunData; id: string }) {
  const report = run.report;
  return (
    <>
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
                  <p className="muted">未关联本轮检查项，处理原因见说明。</p>
                )}
              </article>
            ))
          ) : (
            <p className="muted">本轮未填写反馈响应。</p>
          )}
        </section>
      )}
    </>
  );
}
