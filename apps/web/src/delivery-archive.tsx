import type { DeliverySummary } from "@acceptances/api-client";
import { Load, Status, useResource } from "./client";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
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
  const { data, error } = useResource<{ items: DeliverySummary[] }>(
    "/deliveries",
    revision,
  );
  return (
    <main className="delivery-page">
      <div className="section-heading">
        <h1>交付归档</h1>
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
      {!data ? (
        <Load error={error} />
      ) : data.items.length ? (
        <div className="delivery-list">
          {data.items.map((item) => (
            <Card key={item.id} className="delivery-card">
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
            </Card>
          ))}
        </div>
      ) : (
        <p>还没有正式冻结的交付。完成本轮人工审核后，可从验证记录进入冻结。</p>
      )}
    </main>
  );
}
