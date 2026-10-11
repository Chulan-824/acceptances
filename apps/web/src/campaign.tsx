import { useState } from "react";
import type {
  Campaign as CampaignData,
  Run as RunData,
} from "@acceptances/api-client";
import { useResource, Status, Load, DeleteButton } from "./client";
import { Run } from "./run";
import { CheckCounts } from "./check-counts";
import { ReviewCounts, ScopeType } from "./review";
export function Campaign({
  id,
  runId,
  base,
  navigate,
  onDeleted,
  onChanged,
}: {
  id: string;
  runId?: string;
  base: string;
  navigate: (path: string) => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const campaign = useResource<CampaignData>(
    `/campaigns/${id}`,
    revision,
    true,
  );
  const runs = useResource<{ items: RunData[] }>(
    `/campaigns/${id}/runs`,
    revision,
    true,
  );
  const selectedRun =
    runId || campaign.data?.latestRunId || runs.data?.items[0]?.id;
  function refresh() {
    setRevision((value) => value + 1);
    onChanged();
  }
  return (
    <>
      <main
        className="workspace-main has-review-bar"
        aria-label="需求与验证报告"
      >
        {!campaign.data ? (
          <Load error={campaign.error} />
        ) : (
          <>
            <section className="campaign-heading">
              <div className="section-heading">
                <h2>{campaign.data.title}</h2>
                <Status value={campaign.data.status} />
              </div>
              <p className="prose">
                {campaign.data.description || "暂无需求说明。"}
              </p>
              <p className="muted">
                每次验证独立保存。局部复验不会自动合并历史结果；新报告需要重新人审。
              </p>
              <div className="actions">
                <button onClick={refresh}>刷新报告</button>
                <DeleteButton
                  path={`/campaigns/${id}`}
                  label="需求"
                  onDeleted={onDeleted}
                />
              </div>
            </section>
            {selectedRun ? (
              <Run
                key={selectedRun}
                id={selectedRun}
                isLatest={campaign.data.latestRunId === selectedRun}
                onChanged={refresh}
                runPath={(targetRun) => `${base}/runs/${targetRun}`}
                navigate={navigate}
                onDeleted={() => {
                  refresh();
                  navigate(base);
                }}
              />
            ) : (
              <section>
                <h2>验证报告</h2>
                <p>暂无验证。请在业务目录执行验证，由 CLI 提交报告与附件。</p>
              </section>
            )}
          </>
        )}
      </main>
      <aside className="workspace-history" aria-label="运行记录">
        <div className="section-heading workspace-sidebar-heading">
          <h2>运行记录</h2>
          <span className="muted">{runs.data?.items.length ?? "—"} 次</span>
        </div>
        <p className="muted">选择一次验证，查看当次证据和人工反馈。</p>
        {!runs.data ? (
          <Load error={runs.error} />
        ) : runs.data.items.length ? (
          <div className="navigation-list">
            {runs.data.items.map((run) => (
              <button
                key={run.id}
                className="navigation-item"
                aria-current={selectedRun === run.id ? "page" : undefined}
                onClick={() => navigate(`${base}/runs/${run.id}`)}
              >
                <span className="section-heading">
                  <strong>
                    {run.id === campaign.data?.latestRunId
                      ? "最新验证"
                      : "历史验证"}
                  </strong>
                  <Status value={run.status} />
                </span>
                <span>{run.report.title}</span>
                <time>{new Date(run.report.verifiedAt).toLocaleString()}</time>
                <span className="muted">{run.report.scope}</span>
                <ScopeType value={run.report.scopeType} />
                <CheckCounts checks={run.report.checks} />
                <span className="muted">人工评审</span>
                <ReviewCounts counts={run.reviewCounts} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">提交报告后，这里会显示运行历史。</p>
        )}
      </aside>
    </>
  );
}
