import { formatDateTime } from "./lib/date";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Search,
  X,
  Layers,
  FolderGit2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import type { DeliverySummary } from "@acceptances/api-client";
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameFooter,
} from "./components/reui/frame";
import { EmptyState } from "./components/reui/empty-state";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import { Button } from "./components/ui/button";
import { Load, Status, useResource } from "./client";
import { DeliveryDetail } from "./delivery-detail";
import { FreezeDelivery } from "./freeze-delivery";

export function DeliveryWorkspace({
  parts,
  navigate,
}: {
  parts: string[];
  navigate: (path: string) => void;
}) {
  if (parts[1] === "new" && parts[2])
    return (
      <FreezeDelivery key={parts[2]} runId={parts[2]} navigate={navigate} />
    );
  if (parts[1] && parts[1] !== "new")
    return <DeliveryDetail key={parts[1]} id={parts[1]} navigate={navigate} />;
  return <DeliveryArchive navigate={navigate} />;
}

function DeliveryArchive({ navigate }: { navigate: (path: string) => void }) {
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const { data, error } = useResource<{ items: DeliverySummary[] }>(
    "/deliveries",
    revision,
  );

  const term = query.trim().toLocaleLowerCase();
  const items =
    data?.items.filter(
      (item) =>
        (status === "all" || item.status === status) &&
        [item.campaignTitle, item.projectName, `v${item.version}`].some(
          (value) => value.toLocaleLowerCase().includes(term),
        ),
    ) ?? [];

  return (
    <main className="delivery-page">
      <div className="section-heading">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-muted" />
          <h1 className="m-0 text-xl font-medium tracking-tight">交付版本</h1>
        </div>
        <div className="actions">
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft size={14} />
            返回首页
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw size={14} />
            刷新
          </Button>
        </div>
      </div>

      <p className="delivery-page-desc">
        每份快照保存确认时的版本、范围、人工结论和证据。来源删除后仍保留，后续失效或替代与原内容分别记录。
      </p>

      <Frame spacing="none" className="delivery-archive-tools-panel my-5">
        <FrameHeader className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 p-4">
          <div className="flex flex-wrap items-end gap-3 flex-1">
            <Label className="flex-1 min-w-56">
              <span className="text-xs text-muted font-medium mb-1.5 block">
                搜索交付
              </span>
              <div className="relative flex items-center">
                <Search
                  size={14}
                  className="absolute left-3 text-muted pointer-events-none"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索需求名称、所属项目或版本号…"
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </Label>

            <Label className="min-w-40">
              <span className="text-xs text-muted font-medium mb-1.5 block">
                交付效力
              </span>
              <ChoiceSelect
                value={status}
                onValueChange={setStatus}
                aria-label="交付效力筛选"
              >
                {[
                  ["all", "全部状态"],
                  ["valid", "有效"],
                  ["invalidated", "已失效"],
                  ["revoked", "已撤销"],
                  ["superseded", "已被替代"],
                ].map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </ChoiceSelect>
            </Label>

            {(query || status !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
                className="gap-1 h-9"
              >
                <X size={14} />
                清除筛选
              </Button>
            )}
          </div>

          {data && (
            <div className="text-xs text-muted shrink-0 pb-1">
              显示 {items.length} / {data.items.length} 份交付
            </div>
          )}
        </FrameHeader>
      </Frame>

      {!data ? (
        <Load error={error} />
      ) : items.length ? (
        <div className="delivery-list">
          {items.map((item) => (
            <FramePanel key={item.id} className="delivery-archive-card">
              <div className="delivery-archive-card-header">
                <div className="delivery-archive-card-titles">
                  <div className="delivery-archive-project-tag">
                    <FolderGit2 size={13} className="text-muted" />
                    <span>{item.projectName}</span>
                  </div>
                  <h2 className="delivery-archive-campaign-title">
                    {item.campaignTitle}
                    <span className="delivery-version-badge">
                      v{item.version}
                    </span>
                  </h2>
                </div>
                <Status value={item.status} />
              </div>

              <div className="delivery-archive-meta-row">
                <div className="delivery-archive-meta-item">
                  <Clock size={13} className="text-muted" />
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <div className="delivery-archive-meta-item font-mono">
                  <span>快照 ID：{item.id.slice(0, 8)}</span>
                </div>
              </div>

              <FrameFooter className="delivery-archive-card-footer">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/deliveries/" + item.id)}
                  className="gap-1.5"
                >
                  <ShieldCheck size={14} />
                  查看交付与文档
                  <ArrowRight size={13} />
                </Button>
              </FrameFooter>
            </FramePanel>
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            data.items.length ? "没有匹配的交付版本" : "暂无已确认的交付版本"
          }
          description={
            data.items.length
              ? "请调整搜索关键词或交付效力筛选。"
              : "请从需求顶部查看交付准备，条件满足后确认需求交付。"
          }
        />
      )}
    </main>
  );
}
