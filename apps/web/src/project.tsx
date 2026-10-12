import { useEffect, useState } from "react";
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
import {
  ActionMenu,
  Icon,
  PanelButton,
  PanelResize,
  workspaceStyle,
} from "./workspace-controls";
import "./workbench.css";
const statuses = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审" },
  { value: "accepted", label: "通过" },
  { value: "rejected", label: "不通过" },
];
export function Project({
  id,
  projects,
  projectsError,
  campaignId,
  runId,
  navigate,
  onDeleted,
}: {
  id: string;
  projects?: ProjectData[];
  projectsError?: string;
  campaignId?: string;
  runId?: string;
  navigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    Math.max(1120, window.innerWidth),
  );
  useEffect(() => {
    const resize = () => setViewportWidth(Math.max(1120, window.innerWidth));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);
  const requestedLeft = leftCollapsed ? 48 : leftWidth;
  const requestedRight = rightCollapsed ? 48 : rightWidth;
  const scale = Math.min(
    1,
    (viewportWidth - 480) / (requestedLeft + requestedRight),
  );
  const visibleLeft = Math.floor(requestedLeft * scale);
  const visibleRight = Math.floor(requestedRight * scale);
  function resizePanel(side: "left" | "right", value: number) {
    const opposite = side === "left" ? visibleRight : visibleLeft;
    const width = Math.round(
      Math.max(
        200,
        Math.min(
          side === "left" ? 400 : 440,
          value,
          viewportWidth - opposite - 480,
        ),
      ),
    );
    if (side === "left") {
      setLeftWidth(width);
      if (!rightCollapsed) setRightWidth(visibleRight);
    } else {
      setRightWidth(width);
      if (!leftCollapsed) setLeftWidth(visibleLeft);
    }
  }
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
    <div
      className={`workspace acceptance-workbench${leftCollapsed ? " left-collapsed" : ""}${rightCollapsed ? " right-collapsed" : ""}`}
      style={workspaceStyle(visibleLeft, visibleRight)}
    >
      {leftCollapsed && (
        <aside className="panel-rail" aria-label="需求列表已收起">
          <PanelButton
            side="left"
            collapsed
            onClick={() => setLeftCollapsed(false)}
          />
          <span>需求</span>
        </aside>
      )}
      <aside
        className="workspace-deliveries"
        aria-label="需求交付导航"
        hidden={leftCollapsed}
      >
        <nav className="workspace-home" aria-label="项目导航">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
            }}
          >
            <span className="workspace-brand" aria-hidden="true">
              A
            </span>
            <span>Acceptances</span>
          </a>
          <PanelButton
            side="left"
            collapsed={false}
            onClick={() => setLeftCollapsed(true)}
          />
        </nav>
        <label className="workspace-project-select">
          当前项目
          <select
            value={id}
            disabled={!projects}
            onChange={(event) => navigate(`/projects/${event.target.value}`)}
          >
            {!projects?.some((item) => item.id === id) && (
              <option value={id}>
                {project.data?.name || "正在加载项目…"}
              </option>
            )}
            {projects?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {projectsError && <p role="alert">{projectsError}</p>}
        <div className="section-heading workspace-sidebar-heading">
          <h2>需求交付</h2>
          <ActionMenu label="需求更多操作" icon="more">
            <div className="menu-content">
              <button onClick={refresh}>
                <Icon name="refresh" />
                刷新列表
              </button>
              <button onClick={() => navigate("/")}>所有项目</button>
              <button onClick={() => navigate(base)}>
                项目设置 / 创建需求
              </button>
            </div>
          </ActionMenu>
        </div>
        <div className="sidebar-search-row">
          <label className="search-field">
            <span className="sr-only">搜索需求</span>
            <Icon name="search" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索需求"
            />
          </label>
          <ActionMenu
            label="需求状态筛选"
            icon="filter"
            className="filter-menu"
          >
            <div className="menu-content">
              <label>
                需求状态筛选
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  {statuses.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}{" "}
                      {item.value === "all"
                        ? items.length
                        : items.filter(
                            (campaign) => campaign.status === item.value,
                          ).length}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </ActionMenu>
        </div>
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
                  className="navigation-item campaign-list-item"
                  title={`${campaign.title} · ${campaign.description || "暂无说明"}`}
                  key={campaign.id}
                  aria-current={campaignId === campaign.id ? "page" : undefined}
                  onClick={() => navigate(`${base}/campaigns/${campaign.id}`)}
                >
                  <span className={`campaign-state ${campaign.status}`}>
                    <Status value={campaign.status} />
                  </span>
                  <strong>{campaign.title}</strong>
                  <time dateTime={campaign.createdAt}>
                    {new Date(campaign.createdAt).toLocaleDateString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </time>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <p className="muted">
                {items.length
                  ? "没有匹配的需求，请调整搜索或状态筛选。"
                  : "暂无需求。进入项目设置，创建第一项需求交付。"}
              </p>
            )}
          </>
        )}
      </aside>
      {!leftCollapsed && (
        <PanelResize
          side="left"
          width={visibleLeft}
          onChange={(value) => resizePanel("left", value)}
        />
      )}
      {campaignId ? (
        <Campaign
          key={campaignId}
          id={campaignId}
          runId={runId}
          historyCollapsed={rightCollapsed}
          onToggleHistory={() => setRightCollapsed((value) => !value)}
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
          <aside
            className="workspace-history"
            aria-label="工作台说明"
            hidden={rightCollapsed}
          >
            <PanelButton
              side="right"
              collapsed={false}
              onClick={() => setRightCollapsed(true)}
            />
            <h2>开始验收</h2>
            <p className="muted">选择左侧需求，即可在这里查看它的运行历史。</p>
            <p className="muted">
              先在业务目录执行真实验证，再通过 CLI 提交报告与附件。
            </p>
          </aside>
        </>
      )}
      {!rightCollapsed && (
        <PanelResize
          side="right"
          width={visibleRight}
          onChange={(value) => resizePanel("right", value)}
        />
      )}
      {rightCollapsed && (
        <aside className="panel-rail history-rail" aria-label="运行记录已收起">
          <PanelButton
            side="right"
            collapsed
            onClick={() => setRightCollapsed(false)}
          />
          <span>运行记录</span>
        </aside>
      )}
    </div>
  );
}
