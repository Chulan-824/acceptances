import { useState } from "react";
import type {
  Project as ProjectData,
  Repository,
  Campaign as CampaignData,
} from "@acceptances/api-client";
import {
  useResource,
  request,
  message,
  Status,
  Load,
  DeleteButton,
} from "./client";
import { Campaign } from "./campaign";
export function Project({
  id,
  campaignId,
  runId,
  navigate,
  onDeleted,
}: {
  id: string;
  campaignId?: string;
  runId?: string;
  navigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const project = useResource<ProjectData>(`/projects/${id}`);
  const campaigns = useResource<{ items: CampaignData[] }>(
    `/projects/${id}/campaigns`,
    revision,
  );
  const repositories = useResource<{ items: Repository[] }>(
    `/projects/${id}/repositories`,
  );
  const base = `/projects/${id}`;
  async function create(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    const values = new FormData(form);
    try {
      const item = await request<CampaignData>(`${base}/campaigns`, "POST", {
        title: values.get("title"),
        description: values.get("description"),
      });
      setRevision((r) => r + 1);
      form.reset();
      navigate(`${base}/campaigns/${item.id}`);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!project.data) return <Load error={project.error} />;
  if (campaignId)
    return (
      <>
        <button
          onClick={() => {
            setRevision((r) => r + 1);
            navigate(base);
          }}
        >
          ← {project.data.name}
        </button>
        <Campaign
          key={campaignId}
          id={campaignId}
          runId={runId}
          base={`${base}/campaigns/${campaignId}`}
          navigate={navigate}
          onDeleted={() => {
            setRevision((r) => r + 1);
            navigate(base);
          }}
        />
      </>
    );
  return (
    <>
      <section>
        <div className="section-heading">
          <h2>{project.data.name}</h2>
          <DeleteButton path={base} label="项目" onDeleted={onDeleted} />
        </div>
        <p>{project.data.description}</p>
        <h3>关联代码来源</h3>
        {!repositories.data ? (
          <Load error={repositories.error} />
        ) : repositories.data.items.length ? (
          <ul>
            {repositories.data.items.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong> <code>{r.source}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            尚未关联。在业务目录调用 Acceptances
            skill，选择本项目即可关联；同仓库的 worktree 复用关联。
          </p>
        )}
      </section>
      <section>
        <h2>创建需求交付</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(e.currentTarget);
          }}
        >
          <label>
            需求标题
            <input name="title" required maxLength={200} />
          </label>
          <label>
            需求说明
            <textarea name="description" />
          </label>
          <button disabled={busy}>创建需求</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
      <section>
        <h2>需求交付</h2>
        {!campaigns.data ? (
          <Load error={campaigns.error} />
        ) : campaigns.data.items.length ? (
          <div className="cards">
            {campaigns.data.items.map((c) => (
              <button
                className="card"
                key={c.id}
                onClick={() => navigate(`${base}/campaigns/${c.id}`)}
              >
                <strong>{c.title}</strong>
                <Status value={c.status} />
                <span>{c.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <p>暂无需求。创建需求后，让 Agent 在业务项目中执行验证并提交报告。</p>
        )}
      </section>
    </>
  );
}
