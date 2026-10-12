import { useState } from "react";
import type {
  Campaign as CampaignData,
  Run as RunData,
} from "@acceptances/api-client";
import { useResource, Status, Load, DeleteButton } from "./client";
import { Run } from "./run";
import { ActionMenu, Icon, PanelButton } from "./workspace-controls";

export function Campaign({
  id,
  runId,
  historyCollapsed,
  onToggleHistory,
  base,
  navigate,
  onDeleted,
  onChanged,
}: {
  id: string;
  runId?: string;
  historyCollapsed: boolean;
  onToggleHistory: () => void;
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
  const runCount = runs.data?.items.length ?? 0;
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
                <ActionMenu label="需求操作" icon="more">
                  <div className="menu-content">
                    <button onClick={refresh}>刷新报告</button>
                    <DeleteButton
                      path={`/campaigns/${id}`}
                      label="需求"
                      onDeleted={onDeleted}
                    />
                  </div>
                </ActionMenu>
              </div>
              <div className="campaign-status-line">
                <Status value={campaign.data.status} />
                <span className="muted">每轮独立保存与评审</span>
              </div>
              <p className="prose">
                {campaign.data.description || "暂无需求说明。"}
              </p>
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
      <aside
        className="workspace-history"
        aria-label="运行记录"
        hidden={historyCollapsed}
      >
        <div className="section-heading workspace-sidebar-heading">
          <h2>
            <Icon name="history" />
            运行记录{" "}
            <span className="tab-count">{runs.data?.items.length ?? "—"}</span>
          </h2>
          <PanelButton
            side="right"
            collapsed={false}
            onClick={onToggleHistory}
          />
        </div>

        {!runs.data ? (
          <Load error={runs.error} />
        ) : runs.data.items.length ? (
          <div className="navigation-list">
            {runs.data.items.map((run, index) => (
              <button
                key={run.id}
                className="navigation-item run-list-item"
                aria-current={selectedRun === run.id ? "page" : undefined}
                onClick={() => navigate(`${base}/runs/${run.id}`)}
              >
                <span className="section-heading">
                  <strong>第 {runCount - index} 轮</strong>
                  {run.id === campaign.data?.latestRunId && (
                    <span className="muted">最新</span>
                  )}
                  <Status value={run.status} />
                  <time dateTime={run.report.verifiedAt}>
                    {new Date(run.report.verifiedAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                <span>{run.report.title}</span>
                <span className="muted">
                  {run.reviewCounts.accepted}/{run.report.checks.length} 已验收
                  · {run.reviewCounts.pending} 待审
                  {run.reviewCounts.rejected
                    ? ` · ${run.reviewCounts.rejected} 不通过`
                    : ""}
                </span>
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
