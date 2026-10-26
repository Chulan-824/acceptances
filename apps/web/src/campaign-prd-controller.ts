import type {
  LarkConnector,
  PRDImport,
  PRDSnapshot,
  PRDSnapshotList,
} from "@acceptances/api-client";

type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
interface PendingImport {
  url: string;
  connectorId: string;
  clientRequestId: string;
  taskId?: string;
}
interface PRDView {
  connectors: LarkConnector[];
  snapshots: PRDSnapshotList;
  task?: PRDImport;
  url: string;
  connectorId: string;
  shared: boolean;
  acceptPartial: boolean;
  loading: boolean;
  busy: boolean;
  creationUnknown: boolean;
  conflict: boolean;
  confirmUnknown: boolean;
  error: string;
  readError: string;
  notice: string;
  selectedSnapshotId: string;
}

const errors: Record<string, string> = {
  CONNECTOR_OFFLINE: "本机连接器已离线，请启动后刷新。",
  CONNECTOR_NOT_FOUND: "找不到本人连接器，请重新连接并刷新。",
  CONNECTOR_AUTH_REQUIRED: "连接器身份已失效，请在本机重新连接。",
  PRD_IMPORT_NOT_FOUND: "导入任务不存在或不属于当前账号。",
  PRD_IMPORT_EXPIRED: "导入任务已过期，请重新导入。",
  PRD_IMPORT_CANCELLED: "导入任务已取消。",
  PRD_CLAIM_INVALID: "本机任务领取已失效，请重新导入。",
  PRD_ALREADY_CONFIRMED: "此任务已经确认，请刷新共享版本。",
  PRD_REQUEST_CONFLICT: "本次请求内容不一致，请刷新后重新发起。",
  PRD_RESULT_CONFLICT: "读取结果发生冲突，请重新导入。",
  PRD_PARTIAL_CONFIRMATION_REQUIRED: "请先审阅并明确接受缺失内容。",
  SOURCE_MISMATCH: "当前需求已有另一份 PRD，首期不支持直接替换来源。",
  IMPORT_INCONSISTENT: "同一修订的读取结果不一致，请稍后重新读取。",
  PRD_REVISION_STALE: "这是旧修订，不能替代当前较新的 PRD。",
  INVALID_PRD_RESULT: "读取内容未通过完整性校验，请重新导入。",
  INVALID_PRD_URL: "请使用有效的 Lark Docx 或 Wiki 文档 HTTPS 链接。",
  LARK_AUTH_REQUIRED: "本机 Lark 授权已失效，请在本机重新授权。",
  LARK_SCOPE_REQUIRED: "本机 Lark 授权缺少读取权限，请在本机补充授权。",
  LARK_PERMISSION_DENIED: "你的 Lark 账号无权读取此文档，请联系文档所有者。",
  LARK_NOT_FOUND: "Lark 文档不存在或已被删除，请检查链接。",
  LARK_IDENTITY_CHANGED: "本机 Lark 账号已变化，请确认个人身份后重新连接。",
  LARK_VERSION_CHANGED: "PRD 在读取期间持续变更，请待原文稳定后重新导入。",
  LARK_FETCH_FAILED: "本机读取 Lark 文档失败，请检查网络和连接器后重新导入。",
  LARK_INVALID_RESULT: "Lark 返回内容不符合读取要求，请检查原文后重新导入。",
  LARK_REALM_MISMATCH:
    "文档与本机 Lark 授权所属区域不一致，请检查链接和个人授权。",
  LARK_UNSUPPORTED_DOCUMENT:
    "首期仅支持 Docx，或实际文档为 Docx 的 Wiki 链接。",
  LARK_LIMIT_EXCEEDED: "文档或资源超过导入限制，请缩小文档后重新导入。",
  IMPORT_TIMEOUT: "读取任务已超时，请检查本机连接器后重新导入。",
  PLATFORM_UNAVAILABLE: "本机暂时无法连接平台，请恢复网络并重新启动连接器。",
  LARK_RATE_LIMITED: "Lark 读取暂时受限，请稍后重新导入。",
  AUTH_REQUIRED: "平台登录已过期，请重新登录。",
};
export function prdErrorMessage(error: unknown) {
  const code =
    typeof error === "string" ? error : (error as { code?: string })?.code;
  return (
    (code && errors[code]) ||
    (error instanceof Error
      ? error.message
      : "导入未完成，请检查本机连接器后重试。")
  );
}

function uncertainWrite(error: unknown) {
  const detail = error as { phase?: string; status?: number; code?: string };
  return (
    detail.phase !== "response" ||
    (detail.status || 0) >= 500 ||
    detail.code === "SAVE_FAILED"
  );
}

export function createPRDController({
  campaignId,
  userId,
  request,
  storage,
}: {
  campaignId: string;
  userId: string;
  request: Request;
  storage?: Storage;
}) {
  const key = `acceptances:prd:${userId}:${campaignId}`;
  const sharedKey = `acceptances:prd-sharing:${userId}`;
  const read = (name: string) => {
    try {
      return storage?.getItem(name);
    } catch {
      return null;
    }
  };
  let pending: PendingImport | undefined;
  try {
    const saved = JSON.parse(read(key) || "null");
    if (
      saved &&
      typeof saved.url === "string" &&
      typeof saved.connectorId === "string" &&
      typeof saved.clientRequestId === "string"
    )
      pending = saved;
  } catch {
    /* A malformed browser cache must not block server reads. */
  }
  let view: PRDView = {
    connectors: [],
    snapshots: { currentSnapshotId: "", items: [] },
    url: pending?.url || "",
    connectorId: pending?.connectorId || "",
    shared: read(sharedKey) === "yes",
    acceptPartial: false,
    loading: false,
    busy: false,
    creationUnknown: !!pending && !pending.taskId,
    conflict: false,
    confirmUnknown: false,
    error: "",
    readError: "",
    notice: "",
    selectedSnapshotId: "",
  };
  let sourceInitialized = !!pending;
  let confirmationBase = "";
  let taskGeneration = 0;
  let refreshGeneration = 0;
  let active = true;
  let polling: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  function update(value: Partial<PRDView>) {
    if (!active) return;
    view = { ...view, ...value };
    for (const listener of listeners) listener();
  }
  function remember() {
    try {
      if (pending) storage?.setItem(key, JSON.stringify(pending));
      else storage?.removeItem(key);
    } catch {
      /* The live task remains on the server if browser storage is unavailable. */
    }
  }
  const controller = {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setURL(url: string) {
      if (!view.creationUnknown && !view.busy) {
        sourceInitialized = true;
        update({ url });
      }
    },
    selectConnector(connectorId: string) {
      if (!view.creationUnknown && !view.busy) update({ connectorId });
    },
    selectSnapshot(id: string) {
      if (view.snapshots.items.some((item) => item.id === id))
        update({ selectedSnapshotId: id });
    },
    async disconnect(id: string) {
      if (view.busy || !view.connectors.some((item) => item.id === id))
        return false;
      update({ busy: true, error: "" });
      try {
        await request(`/lark-connectors/${encodeURIComponent(id)}`, "DELETE");
        await controller.load();
        update({ notice: "已断开本机连接器。" });
        return true;
      } catch (error) {
        update({ error: prdErrorMessage(error) });
        return false;
      } finally {
        update({ busy: false });
      }
    },
    acknowledgeSharing: (shared: boolean) => update({ shared }),
    acceptPartial: (acceptPartial: boolean) => update({ acceptPartial }),
    async load(): Promise<boolean> {
      active = true;
      const generation = ++refreshGeneration;
      let loaded = false;
      update({ loading: true });
      try {
        const [connectors, snapshots] = await Promise.all([
          request<{ items: LarkConnector[] }>("/lark-connectors"),
          request<PRDSnapshotList>(
            `/campaigns/${encodeURIComponent(campaignId)}/prd-snapshots`,
          ),
        ]);
        if (generation !== refreshGeneration || !active) return false;
        loaded = true;
        const online = connectors.items.filter((item) => item.online);
        const chosen = online.some((item) => item.id === view.connectorId)
          ? view.connectorId
          : online.length === 1
            ? online[0].id
            : "";
        const defaultURL = !sourceInitialized
          ? snapshots.items.find(
              (item) => item.id === snapshots.currentSnapshotId,
            )?.sourceUrl || ""
          : "";
        sourceInitialized = true;
        update({
          connectors: connectors.items,
          snapshots,
          readError: "",
          url: view.url || defaultURL,
          connectorId: view.creationUnknown ? view.connectorId : chosen,
          selectedSnapshotId: snapshots.items.some(
            (item) => item.id === view.selectedSnapshotId,
          )
            ? view.selectedSnapshotId
            : snapshots.currentSnapshotId,
        });
      } catch (error) {
        if (generation !== refreshGeneration || !active) return false;
        update({
          readError:
            "刷新 PRD 状态失败。" +
            (error instanceof Error ? error.message : "请重试。"),
        });
      } finally {
        if (generation === refreshGeneration) update({ loading: false });
      }
      await controller.poll();
      return loaded;
    },
    async poll(): Promise<void> {
      const taskId = view.task?.id || pending?.taskId;
      if (
        !taskId ||
        view.busy ||
        (view.task &&
          !["queued", "fetching", "ready"].includes(view.task.status))
      )
        return;
      if (polling) return polling;
      const generation = taskGeneration;
      polling = (async () => {
        try {
          const task = await request<PRDImport>(
            `/prd-imports/${encodeURIComponent(taskId)}`,
          );
          if (generation !== taskGeneration || !active) return;
          if (view.task?.id !== task.id) confirmationBase = task.baseSnapshotId;
          update({
            task,
            confirmUnknown: false,
            readError: "",
            error: view.confirmUnknown ? "" : view.error,
          });
          if (
            ["failed", "cancelled", "expired", "confirmed"].includes(
              task.status,
            )
          ) {
            pending = undefined;
            remember();
            if (task.status === "confirmed") {
              try {
                storage?.setItem(sharedKey, "yes");
              } catch {
                /* Confirmation is already saved. */
              }
              update({
                shared: true,
                notice: "已确认导入并共享 PRD。",
                selectedSnapshotId:
                  task.confirmedSnapshotId || view.selectedSnapshotId,
              });
              await controller.load();
            } else if (task.errorCode)
              update({ error: prdErrorMessage(task.errorCode) });
          }
        } catch (error) {
          if (generation !== taskGeneration || !active) return;
          update({
            readError:
              "读取导入状态失败，请重试刷新。" +
              (error instanceof Error ? error.message : ""),
          });
        }
      })();
      try {
        await polling;
      } finally {
        polling = undefined;
      }
    },
    async startImport() {
      if (
        view.busy ||
        (view.task &&
          ["queued", "fetching", "ready"].includes(view.task.status))
      )
        return false;
      if (!view.shared) {
        update({ error: "请先确认导入后的共享范围。" });
        return false;
      }
      if (
        !view.creationUnknown &&
        !view.connectors.some(
          (item) => item.id === view.connectorId && item.online,
        )
      ) {
        update({ error: "请先启动本机连接器，并刷新在线状态。" });
        return false;
      }
      if (!view.url.trim()) {
        update({ error: "请输入 Lark Docx 或 Wiki 文档 URL。" });
        return false;
      }
      if (
        !pending ||
        pending.url !== view.url.trim() ||
        pending.connectorId !== view.connectorId ||
        pending.taskId
      ) {
        pending = {
          url: view.url.trim(),
          connectorId: view.connectorId,
          clientRequestId: crypto.randomUUID(),
        };
      }
      remember();
      taskGeneration++;
      refreshGeneration++;
      update({ busy: true, loading: false, error: "", notice: "" });
      try {
        const task = await request<PRDImport>(
          `/campaigns/${encodeURIComponent(campaignId)}/prd-imports`,
          "POST",
          {
            url: pending.url,
            connectorId: pending.connectorId,
            clientRequestId: pending.clientRequestId,
          },
        );
        pending.taskId = task.id;
        remember();
        confirmationBase = task.baseSnapshotId;
        update({
          task,
          creationUnknown: false,
          acceptPartial: false,
          conflict: false,
        });
        return true;
      } catch (error) {
        const unknown = uncertainWrite(error);
        if (!unknown) {
          pending = undefined;
          remember();
        }
        update({
          creationUnknown: unknown,
          error: unknown
            ? "创建结果尚未确认，请重试同一次请求以恢复任务。"
            : prdErrorMessage(error),
        });
        return false;
      } finally {
        update({ busy: false });
      }
    },
    dispose() {
      active = false;
      taskGeneration++;
      refreshGeneration++;
      listeners.clear();
    },
    async cancel() {
      const task = view.task;
      if (
        view.busy ||
        !task ||
        !["queued", "fetching", "ready"].includes(task.status)
      )
        return false;
      taskGeneration++;
      update({ busy: true, error: "" });
      try {
        await request(
          `/prd-imports/${encodeURIComponent(task.id)}/cancel`,
          "POST",
          {},
        );
        pending = undefined;
        remember();
        update({
          task: { ...task, status: "cancelled" },
          notice: "已取消本次导入，当前共享 PRD 未改变。",
        });
        return true;
      } catch (error) {
        update({
          error:
            error instanceof Error
              ? error.message
              : "取消结果尚未确认，请刷新任务。",
        });
        return false;
      } finally {
        update({ busy: false });
      }
    },
    async refreshConfirmationBase() {
      if (!view.conflict || view.busy) return;
      if (await controller.load()) {
        confirmationBase = view.snapshots.currentSnapshotId;
        update({
          conflict: false,
          error: "",
          selectedSnapshotId: confirmationBase,
          notice: "当前版本已刷新，请审阅后再次确认导入。",
        });
      }
    },
    async confirm() {
      const task = view.task;
      if (
        view.busy ||
        view.conflict ||
        view.confirmUnknown ||
        task?.status !== "ready" ||
        !task.manifest
      )
        return false;
      if (!view.shared) {
        update({ error: "请先确认导入后的共享范围。" });
        return false;
      }
      if (task.manifest.completeness === "partial" && !view.acceptPartial) {
        update({ error: "文档存在缺失内容，请审阅并明确接受后确认。" });
        return false;
      }
      taskGeneration++;
      refreshGeneration++;
      update({ busy: true, loading: false, error: "" });
      try {
        const snapshot = await request<PRDSnapshot>(
          `/prd-imports/${encodeURIComponent(task.id)}/confirm`,
          "POST",
          {
            expectedCurrentSnapshotId: confirmationBase,
            acceptPartial: view.acceptPartial,
          },
        );
        pending = undefined;
        remember();
        try {
          storage?.setItem(sharedKey, "yes");
        } catch {
          /* The server confirmation remains authoritative. */
        }
        const previous = view.snapshots.items.find(
          (item) => item.id === view.snapshots.currentSnapshotId,
        );
        const notice =
          task.manifest.completeness === "partial" &&
          snapshot.manifest.completeness === "complete"
            ? "本次读取存在缺失，已复用同修订的完整共享快照。"
            : view.snapshots.items.some((item) => item.id === snapshot.id)
              ? "内容未变化，已复用现有共享快照。"
              : previous &&
                  previous.manifest.revisionId !==
                    snapshot.manifest.revisionId &&
                  previous.sourceHash === snapshot.sourceHash &&
                  previous.resourceHash === snapshot.resourceHash
                ? "已保存新修订，正文与资源内容未变化。"
                : "已确认导入并共享 PRD。";
        update({
          task: {
            ...task,
            status: "confirmed",
            confirmedSnapshotId: snapshot.id,
          },
          snapshots: {
            currentSnapshotId: snapshot.id,
            items: [
              snapshot,
              ...view.snapshots.items.filter((item) => item.id !== snapshot.id),
            ],
          },
          selectedSnapshotId: snapshot.id,
          notice,
        });
        await controller.load();
        return true;
      } catch (error) {
        const conflict =
          (error as { code?: string }).code === "PRD_HEAD_CHANGED";
        const unknown = uncertainWrite(error);
        update({
          conflict,
          confirmUnknown: unknown,
          error: unknown
            ? "确认结果尚未确定，请先查询导入结果。"
            : conflict
              ? "当前版本已被其他成员更新。请先刷新并审阅当前版本，再次确认。"
              : prdErrorMessage(error),
        });
        return false;
      } finally {
        update({ busy: false });
      }
    },
  };
  return controller;
}
