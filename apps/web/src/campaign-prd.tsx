import { useEffect, useState, useSyncExternalStore } from "react";
import type { PRDImport, PRDManifest } from "@acceptances/api-client";
import { request } from "./client";
import { useCurrentUser } from "./auth";
import {
  createPRDController,
  prdErrorMessage,
} from "./campaign-prd-controller";
import { formatDateTime } from "./lib/date";
import { FilePreview } from "./file-preview";
import { FrameHeader, FramePanel } from "./components/reui/frame";
import { Alert } from "./components/reui/alert";
import { Badge } from "./components/reui/badge";
import { FormField } from "./components/reui/form-field";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Spinner } from "./components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

const sharingNotice =
  "确认导入后，所有平台登录用户均可阅读此文档副本。Lark 原文撤权或删除不会自动清除平台快照。";
const activeStatuses = new Set(["queued", "fetching", "ready"]);
function taskLabel(task: PRDImport) {
  const labels: Record<string, string> = {
    queued: "等待本机领取",
    fetching: "正在从 Lark 读取",
    ready: "待确认共享",
    confirmed: "已导入共享",
    failed: "导入失败",
    cancelled: "已取消",
    expired: "已过期",
  };
  if (task.status === "fetching" && task.phase === "uploading")
    return "正在回传内容";
  if (task.status === "fetching" && task.phase === "resources")
    return "正在读取图片与嵌入资源";
  return labels[task.status] || "正在查询导入状态";
}
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function CampaignPRD({ campaignId }: { campaignId: string }) {
  const user = useCurrentUser();
  const [controller] = useState(() =>
    createPRDController({
      campaignId,
      userId: user.id,
      request,
      storage: browserStorage(),
    }),
  );
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const task = view.task;
  const taskActive = !!task && activeStatuses.has(task.status);
  const reading = task?.status === "queued" || task?.status === "fetching";
  const selected = view.snapshots.items.find(
    (item) => item.id === view.selectedSnapshotId,
  );
  const current = view.snapshots.items.find(
    (item) => item.id === view.snapshots.currentSnapshotId,
  );
  const online = view.connectors.filter((item) => item.online);
  const editingLocked = view.busy || taskActive || view.creationUnknown;
  const errors = [view.error, view.readError].filter(Boolean);
  useEffect(() => {
    void controller.load();
    const timer = setInterval(() => void controller.load(), 15_000);
    return () => {
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (!taskActive) return;
    const timer = setInterval(() => void controller.poll(), 2_000);
    return () => clearInterval(timer);
  }, [controller, taskActive]);
  const prefix = `prd-${campaignId}`;
  return (
    <FramePanel asChild variant="outline">
      <section className="campaign-delivery space-y-4" aria-label="需求 PRD">
        <FrameHeader asChild>
          <div className="section-heading">
            <h2>需求 PRD</h2>
            <div className="flex flex-wrap items-center gap-2">
              {taskActive && <Badge>{taskLabel(task)}</Badge>}
              <Button variant="outline" onClick={() => setOpen(true)}>
                {taskActive || view.creationUnknown
                  ? "查看导入进度"
                  : current
                    ? "重新导入 PRD"
                    : "从 Lark 导入"}
              </Button>
            </div>
          </div>
        </FrameHeader>
        {!current && (
          <p className="muted">
            尚未导入 PRD。通过本人电脑上已授权的 Lark CLI
            读取文档，为后续需求分析保留内容。
          </p>
        )}
        {view.notice && <p role="status">{view.notice}</p>}
        {errors.length > 0 && !open && (
          <Alert variant="destructive" role="alert">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
            <Button variant="outline" onClick={() => void controller.load()}>
              重试刷新
            </Button>
          </Alert>
        )}
        {view.loading && !view.snapshots.items.length && (
          <p role="status">正在读取 PRD 状态…</p>
        )}
        {view.snapshots.items.length > 0 && (
          <>
            <FormField id={`${prefix}-version`} label="已导入版本">
              <Select
                value={view.selectedSnapshotId}
                onValueChange={controller.selectSnapshot}
              >
                <SelectTrigger id={`${prefix}-version`} aria-label="已导入版本">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.snapshots.items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.id === view.snapshots.currentSnapshotId
                        ? "当前 · "
                        : "历史 · "}
                      修订 {item.manifest.revisionId} ·{" "}
                      {formatDateTime(item.createdAt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {selected && (
              <div className="space-y-3">
                <p className="muted">
                  确认人：{selected.createdBy?.username || "历史记录"} ·{" "}
                  {selected.id === view.snapshots.currentSnapshotId
                    ? "当前 PRD"
                    : "历史快照，阅读不会改变当前 PRD"}
                </p>
                <PRDContent
                  manifest={selected.manifest}
                  base={`/api/v1/prd-snapshots/${encodeURIComponent(selected.id)}`}
                  sourceURL={selected.sourceUrl}
                />
              </div>
            )}
          </>
        )}
        <p className="muted">
          PRD
          快照是需求输入，导入不改变验证或验收结论。需求分析、测试用例生成待后续接入。
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>从 Lark 导入 PRD</DialogTitle>
              <DialogDescription>
                由你选择的本人电脑读取文档，预览确认后保存为需求的共享快照。关闭窗口不会取消已发起的任务。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void controller.startImport();
              }}
            >
              <p className="muted">{sharingNotice}</p>
              <FormField
                id={`${prefix}-url`}
                label="Lark 文档 URL"
                description="支持 Docx，或实际文档为 Docx 的 Wiki 链接；始终读取全文。"
              >
                <Input
                  id={`${prefix}-url`}
                  type="url"
                  required
                  value={view.url}
                  disabled={editingLocked}
                  onChange={(event) => controller.setURL(event.target.value)}
                  placeholder="https://团队.feishu.cn/docx/…"
                />
              </FormField>
              <FormField
                id={`${prefix}-connector`}
                label="读取电脑"
                description="只显示当前平台账号的连接器，不会转交其他成员读取。"
              >
                <Select
                  value={view.connectorId}
                  onValueChange={controller.selectConnector}
                  disabled={editingLocked}
                >
                  <SelectTrigger
                    id={`${prefix}-connector`}
                    aria-label="读取电脑"
                  >
                    <SelectValue placeholder="选择本人的在线电脑" />
                  </SelectTrigger>
                  <SelectContent>
                    {view.connectors.map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.id}
                        disabled={!item.online}
                      >
                        {item.name} · {item.online ? "在线" : "离线"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {!online.length && !taskActive && (
                <Alert role="status">
                  <p>
                    暂无在线连接器。请在自己的电脑登录平台
                    CLI，并运行下方命令，然后刷新状态。Lark CLI
                    需保持个人账号授权。
                  </p>
                  <code className="block break-all">
                    acceptances lark connect --url {window.location.origin}
                  </code>
                </Alert>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${prefix}-sharing`}
                  checked={view.shared}
                  disabled={view.busy}
                  onCheckedChange={(value) =>
                    controller.acknowledgeSharing(value === true)
                  }
                />
                <Label htmlFor={`${prefix}-sharing`} className="mb-0 leading-6">
                  我有权将文档复制到平台，并知晓确认后的全员共享与快照保留规则。
                </Label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  aria-busy={view.busy || reading}
                  disabled={
                    view.busy ||
                    taskActive ||
                    (!view.creationUnknown &&
                      !online.some((item) => item.id === view.connectorId)) ||
                    !view.shared
                  }
                >
                  {(view.busy || reading) && <Spinner aria-hidden="true" />}
                  {reading
                    ? "读取中…"
                    : view.creationUnknown
                      ? "恢复本次导入请求"
                      : "读取文档"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={view.loading || view.busy}
                  onClick={() => void controller.load()}
                >
                  刷新状态
                </Button>
                {view.connectorId && !taskActive && !view.creationUnknown && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={view.busy}
                    onClick={() => void controller.disconnect(view.connectorId)}
                  >
                    断开此连接器
                  </Button>
                )}
              </div>
            </form>
            {errors.length > 0 && (
              <Alert variant="destructive" role="alert">
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </Alert>
            )}
            {view.notice && <p role="status">{view.notice}</p>}
            {task && (
              <section
                className="space-y-4 border-t border-border pt-4"
                aria-label="本次导入"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3>本次导入</h3>
                  <Badge>{taskLabel(task)}</Badge>
                  {taskActive && (
                    <Button
                      variant="ghost"
                      disabled={view.busy || view.confirmUnknown}
                      onClick={() => void controller.cancel()}
                    >
                      取消本次导入
                    </Button>
                  )}
                </div>
                {reading && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted"
                  >
                    <Spinner aria-hidden="true" />
                    {taskLabel(task)}。请保持本机连接器在线。
                  </p>
                )}
                {task.status === "ready" && task.manifest && (
                  <>
                    <PRDContent
                      manifest={task.manifest}
                      base={`/api/v1/prd-imports/${encodeURIComponent(task.id)}`}
                      sourceURL={task.url}
                    />
                    {task.manifest.completeness === "partial" && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${prefix}-partial`}
                          checked={view.acceptPartial}
                          disabled={view.busy}
                          onCheckedChange={(value) =>
                            controller.acceptPartial(value === true)
                          }
                        />
                        <Label
                          htmlFor={`${prefix}-partial`}
                          className="mb-0 leading-6"
                        >
                          我已审阅上述缺失内容，仍确认导入。这些缺口会保留到共享快照中。
                        </Label>
                      </div>
                    )}
                    {view.conflict ? (
                      <Button
                        disabled={view.busy || view.loading}
                        onClick={() =>
                          void controller.refreshConfirmationBase()
                        }
                      >
                        刷新当前版本后重新确认
                      </Button>
                    ) : view.confirmUnknown ? (
                      <Button
                        disabled={view.busy}
                        onClick={() => void controller.poll()}
                      >
                        查询导入结果
                      </Button>
                    ) : (
                      <Button
                        disabled={
                          view.busy ||
                          !view.shared ||
                          (task.manifest.completeness === "partial" &&
                            !view.acceptPartial)
                        }
                        onClick={() => void controller.confirm()}
                      >
                        {view.busy && <Spinner aria-hidden="true" />}
                        确认导入并共享
                      </Button>
                    )}
                  </>
                )}
                {task.status === "confirmed" && (
                  <p>已保存为共享快照，可在需求的 PRD 版本中阅读。</p>
                )}
              </section>
            )}
          </DialogContent>
        </Dialog>
      </section>
    </FramePanel>
  );
}

function PRDContent({
  manifest,
  base,
  sourceURL,
}: {
  manifest: PRDManifest;
  base: string;
  sourceURL: string;
}) {
  const fileURL = (name: string) => `${base}/files/${encodeURIComponent(name)}`;
  const resources = manifest.files.map((file) => ({
    path: file.name,
    url: fileURL(file.name),
  }));
  const missing = manifest.resources.filter((item) => item.status !== "saved");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{manifest.title}</strong>
        <Badge>
          {manifest.completeness === "partial"
            ? "存在缺失内容"
            : "支持范围内完整"}
        </Badge>
      </div>
      {manifest.resources.some((item) => item.kind === "sheet") && (
        <p className="muted text-sm">
          Sheet
          读取单元格显示值，包含隐藏行列；样式、合并、公式定义及图形对象不在本次文本读取范围。
        </p>
      )}
      {manifest.resources
        .filter(
          (item) =>
            item.kind === "sheet" && item.status === "saved" && item.filename,
        )
        .map((item) => (
          <FilePreview
            key={item.reference}
            name={item.filename!}
            url={fileURL(item.filename!)}
            label={`查看 Sheet 原值：${item.name || item.sheetId}`}
            description={`独立修订 ${item.revisionId}，按物理行列归档的单元格显示值。`}
          />
        ))}
      <p className="muted">
        修订 {manifest.revisionId} · 读取于 {formatDateTime(manifest.fetchedAt)}{" "}
        · 已保存 {manifest.resources.length - missing.length}/
        {manifest.resources.length} 个资源
      </p>
      <div className="flex flex-wrap gap-2">
        <FilePreview
          name="document.md"
          url={fileURL("document.md")}
          resources={resources}
          label="预览正文与图片"
          description="保留读取时的内容；复杂布局可能与原文不同。"
        />
        <FilePreview
          name="source.json"
          url={fileURL("source.json")}
          label="查看结构原文"
          description="已排除评论的文档结构副本。"
        />
        <a
          className="inline-flex items-center px-2 text-sm underline"
          href={sourceURL}
          target="_blank"
          rel="noreferrer"
        >
          打开 Lark 原文
        </a>
      </div>
      {manifest.resources.some(
        (item) => item.status === "saved" && item.kind === "html",
      ) && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="HTML 附件"
        >
          {manifest.resources
            .filter((item) => item.status === "saved" && item.kind === "html")
            .map((item) => (
              <div key={item.reference} className="flex items-center gap-2">
                <FilePreview
                  name={item.name || item.filename!}
                  url={fileURL(item.filename!)}
                  htmlPreviewURL={`${fileURL(item.filename!)}?preview=1`}
                  label={`预览 ${item.name || "HTML 附件"}`}
                  description="静态预览，已禁用脚本、表单、链接跳转和外部资源。原文件保留，可单独下载。"
                />
                <a
                  className="px-2 text-sm underline"
                  href={`${fileURL(item.filename!)}?download=1`}
                >
                  下载原 HTML
                </a>
              </div>
            ))}
        </div>
      )}
      {manifest.warnings.length > 0 && (
        <Alert role="status">
          <p>导入范围与缺失提示</p>
          <ul className="list-disc pl-5">
            {manifest.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                {warning.message}
                {warning.blockId ? `，位置 ${warning.blockId}` : ""}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {missing.length > 0 && (
        <ul className="list-disc pl-5 text-sm" aria-label="未导入资源">
          {missing.map((item, index) => (
            <li key={`${item.reference}-${index}`}>
              {item.name || item.kind}：
              {item.reason === "LARK_SCOPE_REQUIRED" && item.kind === "sheet"
                ? "缺少 Sheet 只读权限 sheets:spreadsheet:read；需应用审批通过并完成本机个人授权后重新导入。"
                : item.reason?.startsWith("LARK_")
                  ? prdErrorMessage(item.reason)
                  : item.reason || "未保存，需回原文查看"}
              {item.blockId ? `，位置 ${item.blockId}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
