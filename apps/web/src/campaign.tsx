import { useState } from "react";
import type {
  Campaign as CampaignData,
  Run as RunData,
} from "@acceptances/api-client";
import { useResource, Status, Load, DeleteButton } from "./client";
import { Run } from "./run";
export function Campaign({
  id,
  runId,
  base,
  navigate,
  onDeleted,
}: {
  id: string;
  runId?: string;
  base: string;
  navigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const campaign = useResource<CampaignData>(`/campaigns/${id}`, revision);
  const runs = useResource<{ items: RunData[] }>(
    `/campaigns/${id}/runs`,
    revision,
  );
  if (!campaign.data) return <Load error={campaign.error} />;
  return (
    <>
      <section>
        <div className="section-heading">
          <h2>{campaign.data.title}</h2>
          <DeleteButton
            path={`/campaigns/${id}`}
            label="需求"
            onDeleted={onDeleted}
          />
        </div>
        <Status value={campaign.data.status} />
        <p>{campaign.data.description}</p>
        <p className="muted">
          每次验证独立保存。局部复验不会自动合并历史结果；新报告需要重新人审。
        </p>
        <button onClick={() => setRevision((r) => r + 1)}>刷新报告</button>
      </section>
      {runId ? (
        <>
          <button onClick={() => navigate(base)}>← 全部验证记录</button>
          <Run
            key={runId}
            id={runId}
            isLatest={campaign.data.latestRunId === runId}
            onChanged={() => setRevision((r) => r + 1)}
            onDeleted={() => {
              setRevision((r) => r + 1);
              navigate(base);
            }}
          />
        </>
      ) : (
        <section>
          <h2>验证记录</h2>
          {!runs.data ? (
            <Load error={runs.error} />
          ) : runs.data.items.length ? (
            <div className="cards">
              {runs.data.items.map((r) => (
                <button
                  className="card"
                  key={r.id}
                  onClick={() => navigate(`${base}/runs/${r.id}`)}
                >
                  <strong>{r.report.title}</strong>
                  <span>
                    {new Date(r.report.verifiedAt).toLocaleString()}{" "}
                    {r.id === campaign.data?.latestRunId
                      ? "· 当前报告"
                      : "· 历史报告"}
                  </span>
                  <Status value={r.status} />
                  <span>本次范围：{r.report.scope}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无验证。请在业务目录执行验证，由 CLI 提交报告与附件。</p>
          )}
        </section>
      )}
    </>
  );
}
