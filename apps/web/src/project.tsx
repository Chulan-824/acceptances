import { formatDateTime } from "./lib/date";
import { EmptyState } from "./components/reui/empty-state";
import { Frame, FrameHeader, FramePanel } from "./components/reui/frame";
import { WorkspacePanels } from "./components/workspace-panels";
import type { ReactNode } from "react";
import { Alert } from "./components/reui/alert";
import { DropdownMenuItem } from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import { useState } from "react";
import type {
  Project as ProjectData,
  Repository,
} from "@acceptances/api-client";
import { useResource, Status, Load } from "./client";
import {
  DeleteButton,
  DeletionFeedback,
  DeletionNotices,
} from "./deletion-controls";
import { useCampaignRun } from "./campaign-run";
import { Campaign } from "./campaign";
import { ActionMenu, Icon, PanelButton } from "./workspace-controls";
import "./workbench.css";
const statuses = [
  { value: "all", label: "全部" },
  { value: "pending", label: "整体待评审" },
  { value: "accepted", label: "完整范围已验收" },
  { value: "rejected", label: "最新一轮人工不通过" },
];
export function Project({
  id,
  projects,
  projectsError,
  campaignId,
  navigate,
}: {
  id: string;
  projects?: ProjectData[];
  projectsError?: string;
  campaignId?: string;
  navigate: (path: string) => void;
}) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const project = useResource<ProjectData>(`/projects/${id}`, revision);
  const { view, actions } = useCampaignRun();
  const campaigns = view.campaigns;
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
    void actions.refreshCampaigns();
  }
  const sidebar = (
    <aside className="workspace-deliveries" aria-label="需求交付导航">
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
      <Label className="workspace-project-select">
        当前项目
        <ChoiceSelect
          value={id}
          disabled={!projects}
          onValueChange={(value) => navigate(`/projects/${value}`)}
        >
          {!projects?.some((item) => item.id === id) && (
            <SelectItem value={id}>
              {project.data?.name || "正在加载项目…"}
            </SelectItem>
          )}
          {projects?.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </ChoiceSelect>
      </Label>
      {projectsError && (
        <Alert variant="destructive" role="alert">
          {projectsError}
        </Alert>
      )}
      <div className="section-heading workspace-sidebar-heading">
        <h2>需求交付</h2>
        <ActionMenu label="需求更多操作" icon="more">
          <div className="menu-content">
            <DropdownMenuItem asChild>
              <Button onClick={() => void actions.refreshCampaigns()}>
                <Icon name="refresh" />
                刷新列表
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Button onClick={() => navigate("/")}>所有项目</Button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Button onClick={() => navigate(base)}>项目设置</Button>
            </DropdownMenuItem>
          </div>
        </ActionMenu>
      </div>
      <div className="sidebar-search-row">
        <Label className="search-field">
          <span className="sr-only">搜索需求</span>
          <Icon name="search" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索需求"
          />
        </Label>
        <ActionMenu label="需求状态筛选" icon="filter" className="filter-menu">
          <div className="menu-content">
            <Label>
              需求状态筛选
              <ChoiceSelect
                value={status}
                onValueChange={(value) => setStatus(value)}
              >
                {statuses.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}{" "}
                    {item.value === "all"
                      ? items.length
                      : items.filter(
                          (campaign) => campaign.status === item.value,
                        ).length}
                  </SelectItem>
                ))}
              </ChoiceSelect>
            </Label>
          </div>
        </ActionMenu>
      </div>
      {campaigns.data && campaigns.error && (
        <Alert role="alert">
          需求列表刷新失败：{campaigns.error}
          <Button onClick={() => void actions.refreshCampaigns()}>
            重试列表
          </Button>
        </Alert>
      )}
      {!campaigns.data ? (
        <Load error={campaigns.error} />
      ) : (
        <>
          <p className="muted" role="status">
            显示 {filtered.length} / {items.length} 个需求
          </p>
          <div className="navigation-list">
            {filtered.map((campaign) => (
              <Button
                className="navigation-item campaign-list-item"
                title={`${campaign.title} · ${campaign.description || "暂无说明"}`}
                key={campaign.id}
                aria-current={campaignId === campaign.id ? "page" : undefined}
                onClick={() => navigate(`${base}/campaigns/${campaign.id}`)}
              >
                <span className={`campaign-state ${campaign.status}`}>
                  <Status value={campaign.status} context="campaign" />
                </span>
                <strong>{campaign.title}</strong>
                <time dateTime={campaign.createdAt}>
                  {formatDateTime(campaign.createdAt, "MM-DD")}
                </time>
              </Button>
            ))}
          </div>
          {!filtered.length && (
            <EmptyState
              compact
              title={items.length ? "没有匹配的需求" : "暂无需求"}
              description={
                items.length
                  ? "请调整搜索或状态筛选。"
                  : "先在业务目录执行真实验证，再通过 CLI 提交报告与附件。"
              }
            />
          )}
        </>
      )}
    </aside>
  );
  const renderLayout = (main: ReactNode, right: ReactNode) => (
    <WorkspacePanels
      left={sidebar}
      main={main}
      right={right}
      leftCollapsed={leftCollapsed}
      rightCollapsed={rightCollapsed}
      onLeftCollapsedChange={setLeftCollapsed}
      onRightCollapsedChange={setRightCollapsed}
    />
  );
  const target = {
    kind: "project" as const,
    projectId: id,
    name: project.data?.name || id,
  };
  if (view.deletions[`project:${id}`]?.presence === "missing")
    return renderLayout(
      <main className="workspace-main">
        <DeletionFeedback target={target} navigate={navigate} />
      </main>,
      null,
    );
  return campaignId ? (
    <Campaign
      key={campaignId}
      id={campaignId}
      renderLayout={renderLayout}
      onToggleHistory={() => setRightCollapsed((value) => !value)}
      base={`${base}/campaigns/${campaignId}`}
      navigate={navigate}
    />
  ) : (
    renderLayout(
      <main className="workspace-main" aria-label="项目管理">
        <DeletionNotices destination={base} />
        <DeletionFeedback target={target} navigate={navigate} />
        {!project.data ? (
          <Load error={project.error} />
        ) : (
          <Frame asChild variant="ghost" spacing="none" className="bg-surface">
            <section>
              <FrameHeader className="section-heading">
                <h1>{project.data.name}</h1>
                <div className="actions">
                  <Button onClick={refresh}>刷新项目</Button>
                  <DeleteButton target={target} />
                </div>
              </FrameHeader>
              <FramePanel variant="flat">
                <p className="prose">{project.data.description}</p>
                <h2>关联代码来源</h2>
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
              </FramePanel>
            </section>
          </Frame>
        )}
      </main>,
      <aside className="workspace-history" aria-label="工作台说明">
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
      </aside>,
    )
  );
}
