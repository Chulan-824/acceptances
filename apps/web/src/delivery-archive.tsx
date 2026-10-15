import { Frame, FrameHeader, FramePanel } from "./components/reui/frame";
import { EmptyState } from "./components/reui/empty-state";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import type { DeliverySummary } from "@acceptances/api-client";
import { Load, Status, useResource } from "./client";
import { Button } from "./components/ui/button";

import { useState } from "react";
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
        <h1>交付版本</h1>
        <div className="actions">
          <Button variant="outline" onClick={() => navigate("/")}>
            返回首页
          </Button>
          <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
            刷新
          </Button>
        </div>
      </div>
      <p className="muted">
        每份快照保存确认时的版本、范围、人工结论和证据。来源删除后仍保留，
        后续失效或替代与原内容分别记录。
      </p>
      <Frame spacing="sm" className="delivery-archive-tools">
        <FrameHeader className="flex-row flex-wrap items-end gap-3">
          <Label>
            搜索交付
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="需求、项目或版本"
            />
          </Label>
          <Label>
            交付效力
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
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              清除筛选
            </Button>
          )}
        </FrameHeader>
      </Frame>
      {data && (
        <p className="muted" role="status">
          显示 {items.length} / {data.items.length} 份交付
        </p>
      )}
      {!data ? (
        <Load error={error} />
      ) : items.length ? (
        <div className="delivery-list">
          {items.map((item) => (
            <FramePanel key={item.id} className="delivery-card">
              <div className="section-heading">
                <h2>
                  {item.campaignTitle} · v{item.version}
                </h2>
                <Status value={item.status} />
              </div>
              <p>
                {item.projectName} · {new Date(item.createdAt).toLocaleString()}
              </p>
              <Button onClick={() => navigate("/deliveries/" + item.id)}>
                查看交付与业务说明
              </Button>
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
