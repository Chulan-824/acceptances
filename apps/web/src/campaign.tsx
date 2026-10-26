import { formatDateTime } from "./lib/date";
import {
  Timeline,
  TimelineItem,
  TimelineIndicator,
  TimelineSeparator,
} from "./components/reui/timeline";
import { FramePanel } from "./components/reui/frame";
import { Badge } from "./components/reui/badge";
import type { ReactNode } from "react";
import { DropdownMenuItem } from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Status, Load } from "./client";
import { Alert } from "./components/reui/alert";
import {
  DeleteButton,
  DeletionFeedback,
  DeletionNotices,
} from "./deletion-controls";
import { useCampaignRun } from "./campaign-run";
import { Run } from "./run";
import { CampaignDelivery } from "./campaign-delivery";
import { CampaignPRD } from "./campaign-prd";
import { ActionMenu, Icon, PanelButton } from "./workspace-controls";

export function Campaign({
  id,
  renderLayout,
  onToggleHistory,
  base,
  navigate,
}: {
  id: string;
  renderLayout: (main: ReactNode, right: ReactNode) => ReactNode;
  onToggleHistory: () => void;
  base: string;
  navigate: (path: string) => void;
}) {
  const { view, actions } = useCampaignRun();
  const { campaign, runs, selectedRunId: selectedRun } = view;
  const runCount = runs.data?.items.length ?? 0;
  const target = {
    kind: "campaign" as const,
    projectId: view.scope.projectId!,
    campaignId: id,
    name: campaign.data?.title || id,
  };
  const deletion = view.deletions[`campaign:${id}`];
  const refresh = () => void actions.refresh();
  return renderLayout(
    <>
      <main
        className="workspace-main has-review-bar"
        aria-label="需求与验证报告"
      >
        <DeletionNotices destination={base} />
        <DeletionFeedback target={target} navigate={navigate} />
        {view.campaigns.status === "missing" ? (
          <Alert role="alert">
            该项目已不存在。
            <Button onClick={() => navigate("/")}>返回首页</Button>
          </Alert>
        ) : deletion?.presence === "missing" ? null : campaign.status ===
          "missing" ? (
          <Alert role="alert">
            该需求已不存在。
            <Button
              onClick={() => navigate(`/projects/${view.scope.projectId}`)}
            >
              返回项目
            </Button>
          </Alert>
        ) : !campaign.data ? (
          <section>
            <Load error={campaign.error} />
            {campaign.error && <Button onClick={refresh}>重试刷新</Button>}
          </section>
        ) : (
          <>
            <FramePanel asChild variant="flat">
              <section className="campaign-heading">
                <div className="section-heading">
                  <h1>{campaign.data.title}</h1>
                  <ActionMenu label="需求操作" icon="more">
                    <div className="menu-content">
                      <DropdownMenuItem asChild>
                        <Button onClick={refresh}>刷新报告</Button>
                      </DropdownMenuItem>
                      <DeleteButton menuItem target={target} />
                    </div>
                  </ActionMenu>
                </div>
                <div className="campaign-status-line">
                  <span>需求评审</span>
                  <Status value={campaign.data.status} context="campaign" />
                  <span className="muted">
                    创建人：{campaign.data.createdBy?.username || "历史记录"}
                  </span>
                </div>
                <p className="prose">
                  {campaign.data.description || "暂无需求说明。"}
                </p>
              </section>
            </FramePanel>
            <CampaignPRD key={id} campaignId={id} />
            <CampaignDelivery navigate={navigate} />
            {campaign.error && (
              <Alert role="alert">
                需求状态刷新失败：{campaign.error}
                <Button onClick={refresh}>重试刷新</Button>
              </Alert>
            )}
            {selectedRun ? (
              <Run
                key={selectedRun}
                id={selectedRun}
                isLatest={view.isLatest}
                campaignPath={base}
                runPath={(targetRun) => `${base}/runs/${targetRun}`}
                navigate={navigate}
              />
            ) : runs.status !== "ready" ? (
              <section>
                <Load error={runs.error} />
                {runs.error && <Button onClick={refresh}>重试刷新</Button>}
              </section>
            ) : (
              <section>
                <h2>验证报告</h2>
                <p>暂无验证。请在业务目录执行验证，由 CLI 提交报告与附件。</p>
              </section>
            )}
          </>
        )}
      </main>
    </>,
    campaign.status === "missing" ||
      view.campaigns.status === "missing" ? null : (
      <>
        <aside className="workspace-history" aria-label="运行记录">
          <div className="section-heading workspace-sidebar-heading">
            <h2>
              <Icon name="history" />
              运行记录{" "}
              <Badge className="tab-count">
                {runs.data?.items.length ?? "—"}
              </Badge>
            </h2>
            <PanelButton
              side="right"
              collapsed={false}
              onClick={onToggleHistory}
            />
          </div>

          {runs.error && runs.data && (
            <Alert role="alert">
              运行记录刷新失败：{runs.error}
              <Button onClick={refresh}>重试刷新</Button>
            </Alert>
          )}
          {!runs.data ? (
            <Load error={runs.error} />
          ) : runs.data.items.length ? (
            <Timeline value={0} className="navigation-list run-timeline">
              {runs.data.items.map((run, index) => (
                <TimelineItem key={run.id} step={index + 1}>
                  <TimelineIndicator />
                  <TimelineSeparator />
                  <Button
                    className="navigation-item run-list-item"
                    aria-current={selectedRun === run.id ? "page" : undefined}
                    onClick={() => navigate(`${base}/runs/${run.id}`)}
                  >
                    <span className="section-heading">
                      <strong>第 {runCount - index} 轮</strong>
                      {run.id === campaign.data?.latestRunId && (
                        <span className="muted">最新</span>
                      )}
                      <Status value={run.status} context="run" />
                      <time dateTime={run.report.verifiedAt}>
                        {formatDateTime(run.report.verifiedAt, "MM-DD HH:mm")}
                      </time>
                    </span>
                    <span>{run.report.title}</span>
                    <span className="muted">
                      {run.reviewCounts.accepted}/{run.report.checks.length}{" "}
                      已验收 · {run.reviewCounts.pending} 待审
                      {run.reviewCounts.rejected
                        ? ` · ${run.reviewCounts.rejected} 不通过`
                        : ""}
                    </span>
                  </Button>
                </TimelineItem>
              ))}
            </Timeline>
          ) : (
            <p className="muted">提交报告后，这里会显示运行历史。</p>
          )}
        </aside>
      </>
    ),
  );
}
