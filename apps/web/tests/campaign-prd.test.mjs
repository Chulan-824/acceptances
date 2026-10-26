import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../../../packages/api-client/src/index.ts";
import { createPRDController } from "../src/campaign-prd-controller.ts";

const connector = (id = "computer", online = true) => ({
  id,
  name: id,
  protocolVersion: 1,
  larkCliVersion: "1.0.98",
  lastSeenAt: "2026-10-25T00:00:00Z",
  online,
});
const emptySnapshots = { currentSnapshotId: "", items: [] };
function fixture(t, routes = {}) {
  const oldFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method !== "GET") writes.push({ url, method, body });
    const route = routes[`${method} ${url}`];
    const value = typeof route === "function" ? await route(body) : route;
    if (value instanceof Response) return value;
    return Response.json(value ?? {});
  };
  t.after(() => (globalThis.fetch = oldFetch));
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const create = (userId = "alice") =>
    createPRDController({ campaignId: "campaign", userId, request, storage });
  return { routes, writes, create, storage };
}

test("离线时保留 URL 并提示启动本机连接器，不发起导入", async (t) => {
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector("old", false)] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
  });
  const controller = f.create();
  await controller.load();
  controller.setURL("https://team.feishu.cn/docx/DocumentToken");
  controller.acknowledgeSharing(true);
  assert.equal(await controller.startImport(), false);
  assert.equal(
    controller.getSnapshot().url,
    "https://team.feishu.cn/docx/DocumentToken",
  );
  assert.match(controller.getSnapshot().error, /连接器/);
  assert.equal(f.writes.length, 0);
});

const task = (status = "queued") => ({
  id: "import-1",
  campaignId: "campaign",
  connectorId: "computer",
  url: "https://team.feishu.cn/docx/DocumentToken",
  status,
  attempt: 1,
  baseSnapshotId: "",
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
  expiresAt: "2026-10-26T00:00:00Z",
});

test("只用本人选中的在线电脑，并在响应丢失后沿用请求标识恢复导入", async (t) => {
  let attempts = 0;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": {
      items: [connector(), connector("second")],
    },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": () => {
      if (attempts++ === 0) throw new Error("response lost");
      return task();
    },
  });
  const first = f.create();
  await first.load();
  first.setURL(task().url);
  first.selectConnector("computer");
  assert.equal(await first.startImport(), false);
  assert.match(first.getSnapshot().error, /共享/);
  first.acknowledgeSharing(true);
  assert.equal(await first.startImport(), false);
  assert.equal(first.getSnapshot().creationUnknown, true);
  f.routes["GET /api/v1/lark-connectors"] = {
    items: [connector("computer", false)],
  };
  const recovered = f.create();
  await recovered.load();
  recovered.acknowledgeSharing(true);
  assert.equal(recovered.getSnapshot().url, task().url);
  assert.equal(await recovered.startImport(), true);
  assert.equal(f.writes.length, 2);
  assert.equal(
    f.writes[0].body.clientRequestId,
    f.writes[1].body.clientRequestId,
  );
  assert.equal(f.writes[1].body.connectorId, "computer");
  assert.equal(recovered.getSnapshot().task.id, "import-1");
  assert.equal(recovered.getSnapshot().creationUnknown, false);
});

const manifest = (completeness = "complete") => ({
  schemaVersion: 1,
  documentId: "DocumentToken",
  realm: "feishu",
  revisionId: "12",
  title: "订单 PRD",
  fetchedAt: "2026-10-25T00:00:00Z",
  normalizerVersion: "lark-prd-v1-zh-CN",
  completeness,
  warnings:
    completeness === "partial"
      ? [{ code: "RESOURCE_MISSING", message: "流程图未下载" }]
      : [],
  files: [
    {
      name: "document.md",
      role: "markdown",
      contentType: "text/markdown",
      size: 12,
      sha256: "abc",
    },
  ],
  resources: [],
});
const snapshot = (id = "snapshot-1", completeness = "complete") => ({
  id,
  campaignId: "campaign",
  importId: "import-1",
  sourceUrl: task().url,
  sourceHash: "source",
  resourceHash: "resources",
  createdAt: "2026-10-25T00:00:00Z",
  manifest: manifest(completeness),
});

test("刷新恢复本人候选，缺失内容须明确接受，确认后刷新失败仍保留已保存快照", async (t) => {
  let reads = 0;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": () => {
      if (++reads > 2) throw new Error("readback unavailable");
      return emptySnapshots;
    },
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": {
      ...task("ready"),
      manifest: manifest("partial"),
    },
    "POST /api/v1/prd-imports/import-1/confirm": snapshot(
      "snapshot-1",
      "partial",
    ),
  });
  const first = f.create();
  await first.load();
  first.setURL(task().url);
  first.acknowledgeSharing(true);
  await first.startImport();
  const resumed = f.create();
  await resumed.load();
  assert.equal(resumed.getSnapshot().task.status, "ready");
  resumed.acknowledgeSharing(true);
  assert.equal(await resumed.confirm(), false);
  assert.match(resumed.getSnapshot().error, /缺失/);
  resumed.acceptPartial(true);
  assert.equal(await resumed.confirm(), true);
  const saved = resumed.getSnapshot();
  assert.equal(saved.task.status, "confirmed");
  assert.equal(saved.snapshots.currentSnapshotId, "snapshot-1");
  assert.equal(saved.selectedSnapshotId, "snapshot-1");
  assert.match(saved.notice, /已确认/);
  assert.match(saved.readError, /刷新/);
  const confirmation = f.writes.at(-1);
  assert.deepEqual(confirmation.body, {
    expectedCurrentSnapshotId: "",
    acceptPartial: true,
  });
  assert.equal(await resumed.confirm(), false);
  assert.equal(
    f.writes.filter((call) => call.url.endsWith("/confirm")).length,
    1,
  );
  const anotherUser = f.create("bob");
  assert.equal(anotherUser.getSnapshot().task, undefined);
  assert.equal(anotherUser.getSnapshot().shared, false);
});

test("并发确认冲突时须刷新当前版本并再次明确确认，不自动覆盖", async (t) => {
  let head = "old";
  let confirmations = 0;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": () => ({
      currentSnapshotId: head,
      items: [snapshot(head)],
    }),
    "POST /api/v1/campaigns/campaign/prd-imports": {
      ...task("ready"),
      baseSnapshotId: "old",
      manifest: manifest(),
    },
    "GET /api/v1/prd-imports/import-1": {
      ...task("ready"),
      baseSnapshotId: "old",
      manifest: manifest(),
    },
    "POST /api/v1/prd-imports/import-1/confirm": () => {
      if (confirmations++ === 0) {
        head = "colleague";
        return Response.json({ code: "PRD_HEAD_CHANGED" }, { status: 409 });
      }
      head = "snapshot-1";
      return snapshot();
    },
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  assert.equal(await controller.confirm(), false);
  assert.equal(controller.getSnapshot().conflict, true);
  assert.match(controller.getSnapshot().error, /当前版本/);
  assert.equal(await controller.confirm(), false);
  assert.equal(confirmations, 1);
  await controller.refreshConfirmationBase();
  assert.equal(controller.getSnapshot().selectedSnapshotId, "colleague");
  assert.equal(await controller.confirm(), true);
  const confirmation = f.writes
    .filter((call) => call.url.endsWith("/confirm"))
    .at(-1);
  assert.equal(confirmation.body.expectedCurrentSnapshotId, "colleague");
});

test("任务进行中不重复创建，取消后晚到的状态读取不能恢复候选", async (t) => {
  let resolveRead;
  const late = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": {
      currentSnapshotId: "old",
      items: [snapshot("old")],
    },
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": () => late,
    "POST /api/v1/prd-imports/import-1/cancel": () =>
      new Response(null, { status: 204 }),
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  assert.equal(await controller.startImport(), false);
  assert.equal(f.writes.length, 1);
  const reading = controller.poll();
  assert.equal(await controller.cancel(), true);
  resolveRead({ ...task("ready"), manifest: manifest() });
  await reading;
  assert.equal(controller.getSnapshot().task.status, "cancelled");
  assert.equal(controller.getSnapshot().snapshots.currentSnapshotId, "old");
});

test("确认响应丢失时先查询任务，已确认后不再次提交共享", async (t) => {
  let confirmed = false;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": () =>
      confirmed
        ? { currentSnapshotId: "snapshot-1", items: [snapshot()] }
        : emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": {
      ...task("ready"),
      manifest: manifest(),
    },
    "POST /api/v1/prd-imports/import-1/confirm": () => {
      confirmed = true;
      throw new Error("response lost");
    },
    "GET /api/v1/prd-imports/import-1": () => ({
      ...task(confirmed ? "confirmed" : "ready"),
      manifest: manifest(),
      confirmedSnapshotId: confirmed ? "snapshot-1" : undefined,
    }),
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  assert.equal(await controller.confirm(), false);
  assert.equal(controller.getSnapshot().confirmUnknown, true);
  assert.equal(await controller.confirm(), false);
  await controller.poll();
  assert.equal(controller.getSnapshot().task.status, "confirmed");
  assert.equal(controller.getSnapshot().confirmUnknown, false);
  assert.equal(
    controller.getSnapshot().snapshots.currentSnapshotId,
    "snapshot-1",
  );
  assert.equal(
    f.writes.filter((call) => call.url.endsWith("/confirm")).length,
    1,
  );
});

test("历史阅读不切换当前 PRD，只能断开本人列表中的连接器", async (t) => {
  let online = true;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": () => ({
      items: [connector("computer", online)],
    }),
    "GET /api/v1/campaigns/campaign/prd-snapshots": {
      currentSnapshotId: "current",
      items: [snapshot("current"), snapshot("history")],
    },
    "DELETE /api/v1/lark-connectors/computer": () => {
      online = false;
      return new Response(null, { status: 204 });
    },
  });
  const controller = f.create();
  await controller.load();
  controller.selectSnapshot("history");
  assert.equal(controller.getSnapshot().selectedSnapshotId, "history");
  assert.equal(controller.getSnapshot().snapshots.currentSnapshotId, "current");
  assert.equal(await controller.disconnect("another-user-computer"), false);
  assert.equal(f.writes.length, 0);
  assert.equal(await controller.disconnect("computer"), true);
  assert.equal(controller.getSnapshot().connectors[0].online, false);
  assert.equal(controller.getSnapshot().selectedSnapshotId, "history");
});

test("服务端保存结果不确定时恢复原创建请求，并查询确认结果后才允许重试", async (t) => {
  let creations = 0;
  let confirmations = 0;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": () => {
      if (creations++ === 0)
        return Response.json({ code: "SAVE_FAILED" }, { status: 500 });
      return { ...task("ready"), manifest: manifest() };
    },
    "GET /api/v1/prd-imports/import-1": {
      ...task("ready"),
      manifest: manifest(),
    },
    "POST /api/v1/prd-imports/import-1/confirm": () => {
      confirmations++;
      return Response.json({ code: "SAVE_FAILED" }, { status: 500 });
    },
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  assert.equal(await controller.startImport(), false);
  assert.equal(controller.getSnapshot().creationUnknown, true);
  assert.equal(await controller.startImport(), true);
  assert.equal(
    f.writes[0].body.clientRequestId,
    f.writes[1].body.clientRequestId,
  );
  assert.equal(await controller.confirm(), false);
  assert.equal(controller.getSnapshot().confirmUnknown, true);
  assert.equal(await controller.confirm(), false);
  assert.equal(confirmations, 1);
  await controller.poll();
  assert.equal(controller.getSnapshot().confirmUnknown, false);
});

test("后台刷新保留明确失败原因，重新导入默认沿用当前 PRD 来源", async (t) => {
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": {
      currentSnapshotId: "snapshot-1",
      items: [snapshot()],
    },
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": {
      ...task("failed"),
      errorCode: "LARK_PERMISSION_DENIED",
    },
  });
  const controller = f.create();
  await controller.load();
  assert.equal(controller.getSnapshot().url, task().url);
  controller.setURL("");
  await controller.load();
  assert.equal(controller.getSnapshot().url, "");
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  await controller.poll();
  assert.match(controller.getSnapshot().error, /无权读取/);
  await controller.load();
  assert.match(controller.getSnapshot().error, /无权读取/);
});

test("PRD 修订持续变化时提示等待原文稳定，不误导重启 CLI", async (t) => {
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": {
      ...task("failed"),
      errorCode: "LARK_VERSION_CHANGED",
    },
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  await controller.poll();
  assert.match(
    controller.getSnapshot().error,
    /PRD.*读取.*持续变更.*稳定.*重新导入/,
  );
  assert.doesNotMatch(controller.getSnapshot().error, /CLI|重启/);
});

test("重叠的状态刷新共用一次读取，旧状态不能覆盖已就绪候选", async (t) => {
  let resolveRead;
  let reads = 0;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": () => {
      reads++;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  const first = controller.poll();
  const second = controller.poll();
  assert.equal(reads, 1);
  resolveRead({ ...task("ready"), manifest: manifest() });
  await Promise.all([first, second]);
  assert.equal(controller.getSnapshot().task.status, "ready");
});

test("重新导入存在缺失时复用完整快照，明确说明本次读取缺口", async (t) => {
  const existing = snapshot("complete");
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": {
      currentSnapshotId: existing.id,
      items: [existing],
    },
    "POST /api/v1/campaigns/campaign/prd-imports": {
      ...task("ready"),
      baseSnapshotId: existing.id,
      manifest: manifest("partial"),
    },
    "POST /api/v1/prd-imports/import-1/confirm": existing,
  });
  const controller = f.create();
  await controller.load();
  controller.acknowledgeSharing(true);
  await controller.startImport();
  controller.acceptPartial(true);
  assert.equal(await controller.confirm(), true);
  assert.equal(
    controller.getSnapshot().snapshots.currentSnapshotId,
    "complete",
  );
  assert.match(controller.getSnapshot().notice, /本次读取.*缺失.*完整/);
});

test("新修订正文与资源摘要相同时仍展示新版本，并说明内容未变化", async (t) => {
  const old = snapshot("old");
  const next = {
    ...snapshot("next"),
    manifest: { ...manifest(), revisionId: "13" },
  };
  let saved = false;
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": () => ({
      currentSnapshotId: saved ? next.id : old.id,
      items: saved ? [next, old] : [old],
    }),
    "POST /api/v1/campaigns/campaign/prd-imports": {
      ...task("ready"),
      baseSnapshotId: old.id,
      manifest: next.manifest,
    },
    "POST /api/v1/prd-imports/import-1/confirm": () => {
      saved = true;
      return next;
    },
  });
  const controller = f.create();
  await controller.load();
  controller.acknowledgeSharing(true);
  await controller.startImport();
  assert.equal(await controller.confirm(), true);
  assert.equal(controller.getSnapshot().snapshots.currentSnapshotId, "next");
  assert.equal(controller.getSnapshot().snapshots.items.length, 2);
  assert.match(controller.getSnapshot().notice, /新修订.*内容未变化/);
});

test("连接器检测到个人 Lark 身份变化时提示重新连接，不尝试换账号读取", async (t) => {
  const f = fixture(t, {
    "GET /api/v1/lark-connectors": { items: [connector()] },
    "GET /api/v1/campaigns/campaign/prd-snapshots": emptySnapshots,
    "POST /api/v1/campaigns/campaign/prd-imports": task(),
    "GET /api/v1/prd-imports/import-1": {
      ...task("failed"),
      errorCode: "LARK_IDENTITY_CHANGED",
    },
  });
  const controller = f.create();
  await controller.load();
  controller.setURL(task().url);
  controller.acknowledgeSharing(true);
  await controller.startImport();
  await controller.poll();
  assert.match(controller.getSnapshot().error, /Lark 账号已变化.*重新连接/);
  assert.equal(f.writes.length, 1);
});
