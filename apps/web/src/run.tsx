import { useEffect, useState } from "react";
import {
  api,
  record,
  rows,
  text,
  errorMessage,
  type RecordValue,
} from "./client";
import { Evidence } from "./evidence";
export function Run({
  project,
  run,
  revision,
  navigate,
}: {
  project: string;
  run: string;
  revision: string;
  navigate: (path: string) => void;
}) {
  const [details, setDetails] = useState<RecordValue>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/projects/{projectId}/runs/{runId}", {
        params: { path: { projectId: project, runId: run } },
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(errorMessage(error));
        else if (data) setDetails(record(data.data));
      })
      .catch(() => {
        if (active) setError("执行批次不可用。");
      });
    return () => {
      active = false;
    };
  }, [project, run]);
  return (
    <section>
      <h2>执行批次</h2>
      <code>{run}</code>
      {error && <p role="alert">{error}</p>}
      <p>
        <button
          onClick={() =>
            navigate(
              `/projects/${project}/campaigns/${text(details.campaignId)}`,
            )
          }
        >
          返回交付活动
        </button>
      </p>
      <ul>
        {rows(details.revisions).map((r) => (
          <li key={text(r.id)}>
            <button
              onClick={() =>
                navigate(
                  `/projects/${project}/runs/${run}/revisions/${text(r.id)}`,
                )
              }
            >
              {text(r.id)} · {text(r.phase)}
            </button>
          </li>
        ))}
      </ul>
      {revision && (
        <Evidence
          key={revision}
          project={project}
          result={{ runId: run, revisionId: revision }}
        />
      )}
    </section>
  );
}
