import { useState } from "react";
import { request, type DeliverySnapshot } from "@acceptances/api-client";
import { Load, message, Status, useResource } from "./client";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { Disclosure } from "./components/disclosure";
import { BusinessDocuments } from "./business-documents";

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
        <Button onClick={() => navigate("/deliveries")}>交付归档</Button>
        <Load error={error} />
      </main>
    );
  const snapshot = data.payload;
  return (
    <main className="delivery-page">
      <div className="section-heading">
        <h1>
          {snapshot.campaign.title} · 交付 v{data.version}
        </h1>
        <div className="actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => navigate("/deliveries")}
          >
            交付归档
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((r) => r + 1)}
          >
            刷新
          </Button>
        </div>
      </div>
      <p>
        {snapshot.project.name} · <Status value={data.status} /> ·{" "}
        {new Date(data.createdAt).toLocaleString()}
      </p>
      {data.status !== "valid" && (
        <Alert role="note">
          此交付已失效、撤销或被替代。快照与已有说明仅作为历史保留，不代表当前有效交付。
        </Alert>
      )}
      {!data.sourceRunAvailable && (
        <Alert role="note">
          来源验证记录已删除，冻结报告、人审及复制证据仍完整保留。
        </Alert>
      )}
      {data.successorId && (
        <Button
          variant="outline"
          onClick={() => navigate("/deliveries/" + data.successorId)}
        >
          查看替代交付
        </Button>
      )}
      <p>
        冻结内容摘要：<code>{data.sha256}</code>
      </p>
      <div className="actions">
        <a href={"/api/v1/deliveries/" + encodeURIComponent(id) + "/download"}>
          下载快照与当前效力记录
        </a>
        {data.sourceRunAvailable && (
          <Button
            variant="outline"
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
          >
            查看来源验证
          </Button>
        )}
      </div>
      <BusinessDocuments delivery={data} />
      <Disclosure title={<>冻结范围与审核依据</>} defaultOpen>
        <p>{snapshot.run.report.scope}</p>
        <p>
          地图摘要：<code>{snapshot.manifest.map.sha256}</code>
        </p>
        <ul>
          {snapshot.map.features.map((feature) => (
            <li key={feature.id}>
              {feature.title} · <code>{feature.id}</code> ·{" "}
              {feature.checks.filter((check) => check.required).length} 个必验项
            </li>
          ))}
        </ul>
        {snapshot.map.excluded.length > 0 && (
          <p>排除范围：{snapshot.map.excluded.join("；")}</p>
        )}
        <ul>
          {snapshot.run.report.checks.map((check) => (
            <li key={check.id}>
              {check.title} · 原始 <Status value={check.status} /> ·
              冻结时人工接受
              {snapshot.exceptionReasons[check.id] && (
                <p>具体接受理由：{snapshot.exceptionReasons[check.id]}</p>
              )}
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title={<>代码、构建与复制证据</>}>
        <ul>
          {snapshot.run.report.versions.map((version) => (
            <li key={version.repository}>
              {version.repository} · <code>{version.commit}</code>
            </li>
          ))}
        </ul>
        <p>
          实际构建：
          {snapshot.manifest.build.kind === "artifact"
            ? snapshot.manifest.build.id
            : "不适用：" + snapshot.manifest.build.reason}
        </p>
        <ul>
          {snapshot.files.map((file) => (
            <li key={file.path}>
              <a
                href={
                  "/api/v1/deliveries/" +
                  encodeURIComponent(id) +
                  "/evidence/" +
                  encodeURIComponent(file.path) +
                  "?download=1"
                }
              >
                {file.path}
              </a>
              {" · "}
              <code>{file.sha256}</code>
            </li>
          ))}
        </ul>
      </Disclosure>
      <section>
        <h2>交付效力记录</h2>
        <ol>
          {data.events.map((event) => (
            <li key={event.id}>
              {new Date(event.createdAt).toLocaleString()} · {event.reason}
            </li>
          ))}
        </ol>
      </section>
      {data.status === "valid" && (
        <Disclosure title={<>主动撤销交付</>}>
          <Label>
            撤销原因
            <Textarea
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Label>
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() => void revoke()}
          >
            确认撤销交付
          </Button>
        </Disclosure>
      )}
      {actionError && (
        <Alert variant="destructive" role="alert">
          {actionError}
        </Alert>
      )}
    </main>
  );
}
