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
import { FilterBar } from "./filter-bar";
const statuses = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审" },
  { value: "accepted", label: "已接受" },
  { value: "rejected", label: "已拒绝" },
];
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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const project = useResource<ProjectData>(`/projects/${id}`, revision);
  const campaigns = useResource<{ items: CampaignData[] }>(
    `/projects/${id}/campaigns`,
    revision,
  );
  const repositories = useResource<{ items: Repository[] }>(
    `/projects/${id}/repositories`,
    revision,
  );
  const base = `/projects/${id}`;
  const items = campaigns.data?.items || [];
  const search = query.trim().toLocaleLowerCase();
  const filtered = items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      `${item.title} ${item.description}`.toLocaleLowerCase().includes(search),
  );
  function refresh() {
    setRevision((value) => value + 1);
  }
  async function create(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    const values = new FormData(form);
    try {
      const item = await request<CampaignData>(`${base}/campaigns`, "POST", {
        title: values.get("title"),
        description: values.get("description"),
      });
      refresh();
      form.reset();
      setQuery("");
      setStatus("all");
      navigate(`${base}/campaigns/${item.id}`);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <aside className="workspace-deliveries" aria-label="需求交付导航">
        <div className="section-heading">
          <h2>需求交付</h2>
          <button className="compact-button" onClick={refresh}>
            刷新列表
          </button>
        </div>
        <p className="workspace-project-name">
          {project.data?.name || "正在加载项目…"}
        </p>
        <button
          className="project-overview"
          aria-current={!campaignId ? "page" : undefined}
          onClick={() => navigate(base)}
        >
          项目管理 / 创建需求
        </button>
        <label className="search-field">
          搜索需求
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="标题或需求说明"
          />
        </label>
        <FilterBar
          label="需求状态筛选"
          value={status}
          onChange={setStatus}
          options={statuses.map((item) => ({
            ...item,
            count:
              item.value === "all"
                ? items.length
                : items.filter((campaign) => campaign.status === item.value)
                    .length,
          }))}
        />
        {!campaigns.data ? (
          <Load error={campaigns.error} />
        ) : (
          <>
            <p className="muted" role="status">
              显示 {filtered.length} / {items.length} 个需求
            </p>
            <div className="navigation-list">
              {filtered.map((campaign) => (
                <button
                  className="navigation-item"
                  key={campaign.id}
                  aria-current={campaignId === campaign.id ? "page" : undefined}
                  onClick={() => navigate(`${base}/campaigns/${campaign.id}`)}
                >
                  <strong>{campaign.title}</strong>
                  <Status value={campaign.status} />
                  <span className="muted">
                    {campaign.description || "暂无说明"}
                  </span>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <p className="muted">
                {items.length
                  ? "没有匹配的需求，请调整搜索或状态筛选。"
                  : "暂无需求。进入项目管理，创建第一项需求交付。"}
              </p>
            )}
          </>
        )}
      </aside>
      {campaignId ? (
        <Campaign
          key={campaignId}
          id={campaignId}
          runId={runId}
          base={`${base}/campaigns/${campaignId}`}
          navigate={navigate}
          onChanged={refresh}
          onDeleted={() => {
            refresh();
            navigate(base);
          }}
        />
      ) : (
        <>
          <main className="workspace-main" aria-label="项目管理">
            {!project.data ? (
              <Load error={project.error} />
            ) : (
              <section>
                <div className="section-heading">
                  <h2>{project.data.name}</h2>
                  <div className="actions">
                    <button onClick={refresh}>刷新项目</button>
                    <DeleteButton
                      path={base}
                      label="项目"
                      onDeleted={onDeleted}
                    />
                  </div>
                </div>
                <p className="prose">{project.data.description}</p>
                <h3>关联代码来源</h3>
                {!repositories.data ? (
                  <Load error={repositories.error} />
                ) : repositories.data.items.length ? (
                  <ul>
                    {repositories.data.items.map((repository) => (
                      <li key={repository.id}>
                        <strong>{repository.name}</strong>{" "}
                        <code>{repository.source}</code>
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
            )}
            <section>
              <h2>创建需求交付</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void create(event.currentTarget);
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
                <button className="primary-button" disabled={busy}>
                  创建需求
                </button>
              </form>
              {error && <p role="alert">{error}</p>}
            </section>
          </main>
          <aside className="workspace-history" aria-label="工作台说明">
            <h2>开始验收</h2>
            <p className="muted">选择左侧需求，即可在这里查看它的运行历史。</p>
            <p className="muted">
              先在业务目录执行真实验证，再通过 CLI 提交报告与附件。
            </p>
          </aside>
        </>
      )}
    </div>
  );
}
