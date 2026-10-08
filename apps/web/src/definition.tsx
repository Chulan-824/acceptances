import { useEffect, useState } from "react";
import { api, record, text, errorMessage, type RecordValue } from "./client";
export function Definition({
  project,
  campaign,
  plan,
  target,
}: {
  project: string;
  campaign: string;
  plan: string;
  target: string;
}) {
  const [documents, setDocuments] = useState<RecordValue>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!plan || !target) return;
    void Promise.all([
      api.GET(
        "/api/v1/projects/{projectId}/campaigns/{campaignId}/plans/{planId}",
        {
          params: {
            path: { projectId: project, campaignId: campaign, planId: plan },
          },
        },
      ),
      api.GET(
        "/api/v1/projects/{projectId}/campaigns/{campaignId}/targets/{targetId}",
        {
          params: {
            path: {
              projectId: project,
              campaignId: campaign,
              targetId: target,
            },
          },
        },
      ),
    ])
      .then(([p, t]) => {
        if (!active) return;
        if (p.error || t.error) setError(errorMessage(p.error || t.error));
        else
          setDocuments({
            plan: record(p.data?.data),
            target: record(t.data?.data),
          });
      })
      .catch(() => {
        if (active) setError("固定定义快照不可用。");
      });
    return () => {
      active = false;
    };
  }, [project, campaign, plan, target]);
  return (
    <details>
      <summary>只读定义与目标快照</summary>
      {error && <p role="alert">{error}</p>}
      {Object.entries(documents).map(([kind, value]) => (
        <article key={kind}>
          <h3>
            {kind} · {text(record(value).id)}
          </h3>
          <pre>{JSON.stringify(value, null, 2)}</pre>
        </article>
      ))}
    </details>
  );
}
