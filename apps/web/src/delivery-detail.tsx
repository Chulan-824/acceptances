import { useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Download,
  ExternalLink,
  ShieldAlert,
  FolderGit2,
  GitCommit,
  Box,
  Layers,
  FileCheck2,
  FileCode,
  Clock,
  Hash,
  AlertTriangle,
} from "lucide-react";
import { request, type DeliverySnapshot } from "@acceptances/api-client";
import {
  Timeline,
  TimelineItem,
  TimelineDate,
  TimelineContent,
  TimelineIndicator,
  TimelineSeparator,
} from "./components/reui/timeline";
import { Frame, FrameHeader, FramePanel } from "./components/reui/frame";
import { Badge } from "./components/reui/badge";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { Alert } from "./components/reui/alert";
import { Disclosure } from "./components/disclosure";
import { Load, message, Status, useResource } from "./client";
import { BusinessDocuments } from "./business-documents";
import { EvidenceContent } from "./evidence";

export function DeliveryDetail({
  id,
  navigate,
}: {
  id: string;
  navigate: (path: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error } = useResource<DeliverySnapshot>(
    "/deliveries/" + encodeURIComponent(id),
    revision,
  );

  async function revoke() {
    if (busy || !reason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await request(
        "/deliveries/" + encodeURIComponent(id) + "/revoke",
        "POST",
        { reason },
      );
      setReason("");
      setRevision((r) => r + 1);
    } catch (failure) {
      setActionError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <main className="delivery-page">
        <div className="section-heading mb-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/deliveries")}
            className="gap-1.5"
          >
            <ArrowLeft size={14} /> 交付版本
          </Button>
        </div>
        <Load error={error} />
      </main>
    );

  const snapshot = data.payload;
  const resources = snapshot.files.map((file) => ({
    path: file.path,
    url:
      "/api/v1/deliveries/" +
      encodeURIComponent(id) +
      "/evidence/" +
      encodeURIComponent(file.path),
  }));

  return (
    <main className="delivery-page">
      <div className="section-heading">
        <div className="flex items-center gap-2">
          <FileCheck2 size={20} className="text-muted" />
          <h1 className="m-0 text-xl font-medium tracking-tight">
            交付快照详情
          </h1>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => navigate("/deliveries")}
          >
            <ArrowLeft size={14} />
            交付版本
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            刷新
          </Button>
        </div>
      </div>

      <div className="delivery-summary-card my-5">
        <div className="delivery-summary-top">
          <div className="delivery-summary-titles">
            <div className="delivery-summary-project">
              <FolderGit2 size={13} className="text-muted" />
              <span>{snapshot.project.name}</span>
            </div>
            <h2 className="delivery-summary-campaign">
              {snapshot.campaign.title}
              <span className="delivery-version-badge">v{data.version}</span>
            </h2>
          </div>
          <div className="delivery-summary-status-cluster">
            <Status value={data.status} />
          </div>
        </div>

        <div className="delivery-archive-meta-row">
          <div className="delivery-archive-meta-item">
            <Clock size={13} className="text-muted" />
            <span>创建时间：{new Date(data.createdAt).toLocaleString()}</span>
          </div>
          <div className="delivery-archive-meta-item font-mono">
            <Hash size={13} className="text-muted" />
            <span>快照摘要：{data.sha256.slice(0, 16)}…</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-3 mt-3 border-t border-border">
          <Button asChild size="sm" variant="default" className="gap-1.5">
            <a
              href={
                "/api/v1/deliveries/" + encodeURIComponent(id) + "/download"
              }
              download
            >
              <Download size={14} />
              下载快照与当前效力记录
            </a>
          </Button>
          {data.sourceRunAvailable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate(
                  "/projects/" +
                    snapshot.project.id +
                    "/campaigns/" +
                    snapshot.campaign.id +
                    "/runs/" +
                    snapshot.run.id,
                )
              }
              className="gap-1.5"
            >
              <ExternalLink size={14} />
              查看来源验证 Run
            </Button>
          )}
          {data.successorId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/deliveries/" + data.successorId)}
              className="gap-1.5"
            >
              <ArrowLeft size={14} />
              查看替代交付
            </Button>
          )}
        </div>
      </div>

      {data.status !== "valid" && (
        <Alert role="note" className="my-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning-dark" />
            <span>
              此交付已失效、撤销或被替代。快照与已有文档仅作为历史保留，不代表当前有效交付。
            </span>
          </div>
        </Alert>
      )}

      {!data.sourceRunAvailable && (
        <Alert role="note" className="my-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning-dark" />
            <span>
              来源验证记录已删除，冻结报告、人审及复制证据仍完整保留。
            </span>
          </div>
        </Alert>
      )}

      <BusinessDocuments delivery={data} />

      <div className="my-6 space-y-4">
        <Disclosure title="冻结范围与审核依据" defaultOpen>
          <div className="p-4 rounded-default bg-surface border border-border space-y-4">
            {snapshot.run.report.scope && (
              <div className="text-sm text-fg leading-relaxed">
                <span className="text-xs text-muted font-medium uppercase tracking-wider block mb-1">
                  范围说明
                </span>
                <p className="m-0 text-fg-secondary">
                  {snapshot.run.report.scope}
                </p>
              </div>
            )}

            <div className="delivery-map-digest">
              <span className="delivery-digest-label">地图校验摘要：</span>
              <code className="delivery-digest-code">
                {snapshot.manifest.map.sha256}
              </code>
            </div>

            <div>
              <div className="text-xs text-muted font-medium uppercase tracking-wider mb-2.5">
                包含功能清单
              </div>
              <div className="delivery-features-stack my-2">
                {snapshot.map.features.map((feature) => {
                  const reqCount = feature.checks.filter(
                    (check) => check.required,
                  ).length;
                  return (
                    <div key={feature.id} className="delivery-feature-block">
                      <div className="delivery-feature-header">
                        <div className="delivery-feature-info">
                          <Layers size={14} className="text-muted" />
                          <strong className="delivery-feature-name">
                            {feature.title}
                          </strong>
                          <code className="delivery-feature-code">
                            {feature.id}
                          </code>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {reqCount} 个必验项
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {snapshot.map.excluded.length > 0 && (
              <div className="delivery-excluded-card">
                <span className="delivery-excluded-tag">排除范围</span>
                <span className="delivery-excluded-content">
                  {snapshot.map.excluded.join("；")}
                </span>
              </div>
            )}

            <div>
              <div className="text-xs text-muted font-medium uppercase tracking-wider mb-2.5">
                检查项原始状态与冻结接受记录
              </div>
              <div className="delivery-checks-table">
                {snapshot.run.report.checks.map((check) => {
                  const hasReason = !!snapshot.exceptionReasons[check.id];
                  return (
                    <div key={check.id} className="delivery-check-row">
                      <div className="delivery-check-header">
                        <span className="delivery-check-name">
                          {check.title}
                        </span>
                        <div className="flex items-center gap-2">
                          <code className="delivery-check-code">
                            {check.id}
                          </code>
                          <Status value={check.status} />
                        </div>
                      </div>
                      {hasReason && (
                        <div className="mt-2 pt-2 border-t border-border/50 text-xs">
                          <span className="font-medium text-warning-dark mr-1">
                            人工接受理由：
                          </span>
                          <span className="text-fg-secondary">
                            {snapshot.exceptionReasons[check.id]}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Disclosure>

        <Disclosure title="代码、构建与复制证据">
          <div className="p-4 rounded-default bg-surface border border-border space-y-4">
            <div>
              <div className="text-xs text-muted font-medium uppercase tracking-wider mb-2.5">
                受验代码库版本
              </div>
              <div className="delivery-version-list">
                {snapshot.run.report.versions.map((version) => (
                  <div
                    key={version.repository}
                    className="delivery-version-item"
                  >
                    <div className="delivery-version-main">
                      <GitCommit size={14} className="text-muted" />
                      <span className="delivery-repo-title">
                        {version.repository}
                      </span>
                      <div className="delivery-commit-pill">
                        <span className="delivery-commit-prefix">Commit</span>
                        <code>{version.commit}</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="delivery-build-row">
              <div className="flex items-center gap-2">
                <Box size={14} className="text-muted" />
                <span className="delivery-build-label">实际构建标识</span>
              </div>
              <div className="delivery-build-value">
                {snapshot.manifest.build.kind === "artifact" ? (
                  <code>{snapshot.manifest.build.id}</code>
                ) : (
                  <span className="text-muted">
                    不适用：{snapshot.manifest.build.reason}
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted font-medium uppercase tracking-wider mb-2.5">
                复制证据文件 ({snapshot.files.length})
              </div>
              <div className="delivery-version-list">
                {snapshot.files.map((file) => {
                  const res = resources.find(
                    (resource) => resource.path === file.path,
                  );
                  const desc = snapshot.run.report.evidence?.find(
                    (item) => item.path === file.path,
                  )?.description;

                  return (
                    <div
                      key={file.path}
                      className="p-3 rounded-default bg-surface-subtle border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode size={14} className="text-muted shrink-0" />
                        <span className="font-medium text-fg truncate">
                          {file.path}
                        </span>
                        {res && (
                          <EvidenceContent
                            url={res.url}
                            name={file.path}
                            description={desc}
                            resources={resources}
                          />
                        )}
                      </div>
                      <code className="delivery-cid-badge shrink-0">
                        SHA: {file.sha256.slice(0, 12)}…
                      </code>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Disclosure>
      </div>

      <Frame className="my-6">
        <FrameHeader className="section-heading p-4 border-b border-border">
          <h2 className="text-base font-medium text-fg m-0">交付效力时间线</h2>
        </FrameHeader>
        <FramePanel className="p-4 sm:p-6">
          <Timeline value={0} className="delivery-events">
            {data.events.map((event, index) => (
              <TimelineItem key={event.id} step={index + 1}>
                <TimelineIndicator />
                <TimelineSeparator />
                <TimelineDate dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString()}
                </TimelineDate>
                <TimelineContent className="text-sm text-fg-secondary">
                  {event.reason}
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </FramePanel>
      </Frame>

      {data.status === "valid" && (
        <Disclosure title="主动撤销交付" className="my-6">
          <div className="p-4 rounded-default bg-surface border border-danger-border/60 space-y-3">
            <div className="flex items-center gap-2 text-danger-dark font-medium text-sm">
              <ShieldAlert size={16} />
              <span>注意：主动撤销后该交付将永久失去有效效力</span>
            </div>
            <Label className="block">
              <span className="text-xs text-muted mb-1 block">
                撤销原因（必填）
              </span>
              <Textarea
                value={reason}
                disabled={busy}
                placeholder="请输入主动撤销此交付的具体业务原因…"
                onChange={(event) => setReason(event.target.value)}
                className="text-sm"
              />
            </Label>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => void revoke()}
              className="gap-1.5"
            >
              <ShieldAlert size={14} />
              确认撤销交付
            </Button>
          </div>
        </Disclosure>
      )}

      {actionError && (
        <Alert variant="destructive" role="alert" className="my-4">
          {actionError}
        </Alert>
      )}
    </main>
  );
}
