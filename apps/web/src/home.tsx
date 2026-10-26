import { formatDateTime } from "./lib/date";
import { EmptyState } from "./components/reui/empty-state";
import {
  FramePanel,
  Frame,
  FrameHeader,
  FrameFooter,
} from "./components/reui/frame";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowRight,
  Folder,
  LayoutGrid,
  List,
  Search,
  RefreshCw,
  Layers,
  Clock3,
  CircleCheck,
  CircleX,
} from "lucide-react";
import type {
  DashboardItem,
  Project,
  ReviewStatus,
} from "@acceptances/api-client";
import { useResource, Status } from "./client";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Alert } from "./components/reui/alert";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import { HomeCreate } from "./home-create";
import { useCampaignRun } from "./campaign-run";
import { DeletionNotices } from "./deletion-controls";

const filters = [
  { value: "all", label: "全部", icon: Layers },
  { value: "pending", label: "整体待评审", icon: Clock3 },
  { value: "accepted", label: "完整范围已验收", icon: CircleCheck },
  { value: "rejected", label: "最新一轮人工不通过", icon: CircleX },
] as const;
const resultLabels = {
  passed: "通过",
  failed: "失败",
  blocked: "阻塞",
  skipped: "未执行",
};
const scopeLabels = {
  full: "完整验证",
  partial: "局部验证",
  unknown: "范围未知",
};

export function Home({
  projects,
  loadError,
  onRetry,
  navigate,
  onCreated,
}: {
  projects?: Project[];
  loadError?: string;
  onRetry: () => void;
  navigate: (path: string) => void;
  onCreated: (project: Project) => void;
}) {
  const { view } = useCampaignRun();
  const [createOpen, setCreateOpen] = useState(true);
  const [revision, setRevision] = useState(0);
  const dashboard = useResource<{ items: DashboardItem[] }>(
    "/dashboard",
    revision + view.dashboardRevision,
  );
  const [projectId, setProjectId] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ReviewStatus>("all");
  const [compact, setCompact] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const scoped = (dashboard.data?.items || [])
    .filter(
      (item) =>
        (projectId === "all" || item.projectId === projectId) &&
        view.deletions[`project:${item.projectId}`]?.presence !== "missing" &&
        view.deletions[`campaign:${item.id}`]?.presence !== "missing",
    )
    .map((item) =>
      view.deletions[`run:${item.latestRunId}`]?.presence === "missing"
        ? {
            ...item,
            latestRunId: "",
            latestRun: null,
            status: "pending" as const,
          }
        : item,
    );
  const counts = { all: scoped.length, pending: 0, accepted: 0, rejected: 0 };
  for (const item of scoped) counts[item.status]++;
  const term = query.trim().toLocaleLowerCase();
  const visible = scoped.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      [
        item.title,
        item.description,
        item.projectName,
        ...(item.latestRun?.versions.flatMap((v) => [v.repository, v.commit]) ||
          []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
  );
  function follow(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(path);
  }
  function refresh() {
    setRevision((v) => v + 1);
    onRetry();
  }
  return (
    <div className="home-page">
      <a className="home-skip" href="#home-content">
        跳转至看板内容
      </a>
      <main
        className="home-container home-content"
        id="home-content"
        tabIndex={-1}
      >
        <DeletionNotices destination="/" />
        <div className="home-page-heading">
          <h1>交付看板</h1>
          <Button
            variant="default"
            onClick={() => {
              setCreateOpen(true);
              requestAnimationFrame(() => {
                document
                  .getElementById("home-name")
                  ?.scrollIntoView({ block: "center" });
                document.getElementById("home-name")?.focus();
              });
            }}
          >
            创建项目 <ArrowRight size={14} />
          </Button>
        </div>
        <div className="home-stats" aria-label="需求状态统计">
          {filters.map(({ value, label, icon: MetricIcon }) => (
            <FramePanel key={value} asChild>
              <div className={`home-stat ${value}`}>
                <div className="home-stat-label">
                  <span>
                    {value === "all" ? "需求交付" : label}
                    <span className="sr-only">数量</span>
                  </span>
                  <MetricIcon size={15} />
                </div>
                <strong>{dashboard.data ? counts[value] : "—"}</strong>
                <p>
                  {value === "all"
                    ? "按最新验证记录与人工评审汇总状态"
                    : value === "accepted"
                      ? "最新完整验证已通过全部人工评审"
                      : value === "pending"
                        ? "待完成全部人工评审或补充完整验证"
                        : "存在未通过的人工评审判断"}
                </p>
              </div>
            </FramePanel>
          ))}
        </div>
        <div className="home-layout">
          <Frame asChild variant="ghost" spacing="none">
            <section className="home-board" aria-label="需求交付看板">
              <FrameHeader asChild>
                <div className="home-toolbar">
                  <div className="home-toolbar-title">
                    <h2>需求交付看板</h2>
                    <span>{dashboard.data ? scoped.length : "—"} 个需求</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="刷新看板"
                      onClick={refresh}
                    >
                      <RefreshCw size={14} />
                    </Button>
                  </div>
                  <Button
                    variant="default"
                    onClick={() => navigate("/deliveries")}
                  >
                    交付版本 <ArrowRight size={14} />
                  </Button>
                  <div className="home-tools">
                    <Label className="home-search">
                      <Search size={14} />
                      <Input
                        ref={searchInput}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="搜索需求"
                        placeholder="搜索需求、代码仓库或提交哈希 (⌘K)"
                      />
                    </Label>
                    <div
                      className="home-filters"
                      role="group"
                      aria-label="需求状态筛选"
                    >
                      {filters.map((f) => (
                        <Button
                          key={f.value}
                          variant="ghost"
                          aria-pressed={status === f.value}
                          onClick={() => setStatus(f.value)}
                        >
                          {f.label} {dashboard.data ? counts[f.value] : "—"}
                        </Button>
                      ))}
                    </div>
                    <div
                      className="home-view"
                      role="group"
                      aria-label="视图模式"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="卡片视图"
                        aria-pressed={!compact}
                        onClick={() => setCompact(false)}
                      >
                        <LayoutGrid size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="紧凑列表"
                        aria-pressed={compact}
                        onClick={() => setCompact(true)}
                      >
                        <List size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              </FrameHeader>
              <p className="home-result-count" role="status">
                {dashboard.data
                  ? `显示 ${visible.length} / ${scoped.length} 个需求 · 统计范围：${projectId === "all" ? "全部项目" : "当前项目"}`
                  : dashboard.error
                    ? "看板加载失败"
                    : "正在加载看板…"}
              </p>
              {dashboard.error && (
                <Alert variant="destructive">
                  {dashboard.error}
                  <Button onClick={() => setRevision((v) => v + 1)}>
                    重试看板
                  </Button>
                </Alert>
              )}
              {dashboard.data && !visible.length && (
                <EmptyState
                  title={
                    scoped.length ? "未找到匹配的需求交付" : "暂无需求交付记录"
                  }
                  description={
                    scoped.length
                      ? "请尝试调整搜索关键词或状态筛选条件。"
                      : "创建项目后，在本地业务代码目录执行验证并归档报告，相关需求交付将呈现在此。"
                  }
                  actions={
                    scoped.length > 0 ? (
                      <Button
                        onClick={() => {
                          setQuery("");
                          setStatus("all");
                        }}
                      >
                        重置搜索与筛选条件
                      </Button>
                    ) : undefined
                  }
                />
              )}
              <div
                className={`home-deliverables ${compact ? "is-compact" : ""}`}
              >
                {visible.map((item) => (
                  <DeliveryCard
                    key={item.id}
                    item={item}
                    compact={compact}
                    follow={follow}
                  />
                ))}
              </div>
            </section>
          </Frame>
          <aside className="home-sidebar" aria-label="项目管理与接入">
            <FramePanel asChild>
              <div className="home-side-card">
                <h2>项目</h2>
                <Label className="home-project-filter">
                  项目范围
                  <ChoiceSelect
                    value={projectId}
                    onValueChange={setProjectId}
                    disabled={!projects}
                  >
                    <SelectItem value="all">全部项目</SelectItem>
                    {projects?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </ChoiceSelect>
                </Label>
                {loadError && (
                  <Alert variant="destructive">
                    {loadError}
                    <Button onClick={onRetry}>重试项目列表</Button>
                  </Alert>
                )}
                {!projects && !loadError && <p role="status">正在加载项目…</p>}
                {projects?.length === 0 && (
                  <p>暂无项目，请先在下方创建项目。</p>
                )}
                <ul className="home-project-list">
                  {projects?.map((p) => (
                    <li key={p.id}>
                      <a
                        href={`/projects/${p.id}`}
                        onClick={(e) => follow(e, `/projects/${p.id}`)}
                      >
                        <Folder size={16} />
                        <span>{p.name}</span>
                        <ArrowRight size={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </FramePanel>
            <HomeCreate
              onCreated={onCreated}
              open={createOpen}
              setOpen={setCreateOpen}
            />
            <FramePanel asChild>
              <div className="home-side-card home-guide">
                <h2>开始验收</h2>
                <ol>
                  <li>在下方创建项目，关联本地业务代码目录。</li>
                  <li>
                    在业务目录使用 Agent 运行 <code>Acceptances-Cl</code>{" "}
                    执行验证并归档报告。
                  </li>
                  <li>打开需求详情，核对多模态证据并逐项记录人工评审结论。</li>
                </ol>
                <p>
                  实际验证结果与人工判断相互独立；局部验证通过不代表需求整体通过。
                </p>
              </div>
            </FramePanel>
          </aside>
        </div>
        <footer className="home-footer">
          <span>Acceptances · 本机验收工具</span>
          <span>保存验证事实，查看证据，作出人工判断。</span>
        </footer>
      </main>
    </div>
  );
}
function DeliveryCard({
  item,
  compact,
  follow,
}: {
  item: DashboardItem;
  compact: boolean;
  follow: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}) {
  const run = item.latestRun;
  const path = `/projects/${item.projectId}/campaigns/${item.id}${run ? `/runs/${run.id}` : ""}`;
  const deliveryPath = item.delivery
    ? `/deliveries/${encodeURIComponent(item.delivery.id)}`
    : null;
  return (
    <FramePanel asChild>
      <article className="home-delivery">
        <div className="home-delivery-top">
          <div className="home-delivery-state">
            <span>需求</span>
            <Status value={item.status} context="campaign" />
            <span className="home-project-tag">{item.projectName}</span>
          </div>
          {run && (
            <span className="home-evidence-count">
              {run.evidenceCount} 份证据
            </span>
          )}
        </div>
        <h3>
          <a href={path} onClick={(e) => follow(e, path)}>
            {item.title}
            <ArrowRight size={15} />
          </a>
        </h3>
        {!compact && (
          <p className="home-delivery-description">
            {item.description || "暂无需求说明"}
          </p>
        )}
        {run ? (
          <>
            <div className="home-run-meta">
              <span>最新验证</span>
              <Status value={run.status} context="run" />
              <span>{scopeLabels[run.scopeType]}</span>
              <time dateTime={run.verifiedAt}>
                {formatDateTime(run.verifiedAt, "MM-DD HH:mm")}
              </time>
            </div>
            <div
              className="home-check-counts"
              aria-label="各状态检查项数量统计"
            >
              {Object.entries(resultLabels).map(([key, label]) => (
                <span key={key} className={key}>
                  {run.counts[key as keyof typeof resultLabels]} {label}
                </span>
              ))}
            </div>
            {!compact && (
              <ul className="home-mini-checks">
                {run.checks.map((check) => (
                  <li key={check.id}>
                    <span className={check.status}>
                      {resultLabels[check.status]}
                    </span>
                    <span title={check.title}>{check.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="home-run-meta">等待首次验证归档</p>
        )}
        <FrameFooter asChild>
          <div className="home-delivery-footer">
            <div className="home-versions">
              {run?.versions.map((v, i) => (
                <span key={i} title={`${v.repository} · ${v.commit}`}>
                  <span>{v.repository}</span>
                  <code>
                    {v.commit === "unknown" ? "版本未知" : v.commit.slice(0, 8)}
                  </code>
                  <span>
                    {v.dirty === null
                      ? "改动未知"
                      : v.dirty
                        ? "含未提交改动"
                        : ""}
                  </span>
                </span>
              ))}
            </div>
            <div className="home-delivery-actions">
              <Button asChild size="sm" variant="default">
                <a href={path} onClick={(e) => follow(e, path)}>
                  {run ? "查看报告" : "查看需求"}
                  <ArrowRight size={13} />
                </a>
              </Button>
              {item.delivery && deliveryPath && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={deliveryPath}
                    onClick={(e) => follow(e, deliveryPath)}
                  >
                    {item.delivery.status === "valid"
                      ? "查看交付"
                      : "查看历史交付"}
                    <ArrowRight size={13} />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </FrameFooter>
      </article>
    </FramePanel>
  );
}
