import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  rm,
  mkdtemp,
  chmod,
  access,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  createSession,
  managedProcess,
  assertPortFree,
  requestService,
  controlServices,
  serviceRecords,
  startIsolatedServer,
  root,
} from "./services.mjs";

const fixture = `
const http = require("node:http");
const server = http.createServer((req, res) => res.end("ok"));
server.listen(0, "127.0.0.1", () => console.log("address=127.0.0.1:" + server.address().port));
process.on("SIGTERM", () => server.close());
`;
async function address(service) {
  for (let i = 0; i < 100; i++) {
    service.assertRunning();
    const match = service.output.match(/address=127.0.0.1:(\d+)/);
    if (match) return Number(match[1]);
    await delay(30);
  }
  throw new Error("fixture 启动超时");
}

test("状态、远程停止及重复清理：停止后端口和记录释放", async () => {
  const kind = `test-${randomUUID()}`;
  const session = await createSession(kind, { signals: false });
  try {
    const service = session.start("fixture", process.execPath, ["-e", fixture]);
    const port = await address(service);
    service.url = `http://127.0.0.1:${port}`;
    session.ready();
    const [state] = await controlServices("status", kind);
    assert.equal(state.state, "ready");
    assert.equal(state.processes[0].pid, service.child.pid);
    await assert.rejects(assertPortFree(port), /不可用/);
    const { record } = (await serviceRecords()).find(
      (entry) => entry.record?.kind === kind,
    );
    await assert.rejects(
      requestService({ ...record, token: "wrong" }),
      /身份不匹配/,
    );
    assert.equal((await fetch(service.url)).status, 200);
    const [stopped] = await controlServices("stop", kind);
    assert.equal(stopped.state, "stopped");
    await assertPortFree(port);
    assert.deepEqual(await controlServices("status", kind), []);
    await session.close();
    assert.throws(
      () => session.start("late", process.execPath, ["-e", fixture]),
      /正在退出/,
    );
  } finally {
    await session.close();
  }
});

test("部分启动失败会回收已启动进程", async () => {
  const session = await createSession(`test-${randomUUID()}`, {
    signals: false,
  });
  let port;
  try {
    port = await address(
      session.start("first", process.execPath, ["-e", fixture]),
    );
    const failed = session.start("missing", "/does-not-exist-acceptances", []);
    await failed.closed;
    assert.throws(() => failed.assertRunning(), /ENOENT/);
  } finally {
    await session.close();
  }
  await assertPortFree(port);
});

test("拒绝 TERM 的后代随进程组强制回收", async () => {
  const childSource = fixture.replace(
    'process.on("SIGTERM", () => server.close());',
    'process.on("SIGTERM", () => {});',
  );
  const service = managedProcess("tree", process.execPath, [
    "-e",
    `
    const {spawn} = require("node:child_process");
    spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], {stdio:"inherit"});
    setInterval(() => {}, 1000);
  `,
  ]);
  let port;
  try {
    port = await address(service);
  } finally {
    await service.stop();
  }
  await assertPortFree(port);
});

test("失效记录不按磁盘 PID 杀进程，也不删除存活服务", async () => {
  const kind = `test-${randomUUID()}`;
  const path = join(root, ".cache/services", `${kind}.json`);
  const record = {
    kind,
    pid: process.pid,
    token: randomUUID(),
    socket: `/tmp/acc-absent-${randomUUID()}.sock`,
  };
  await writeFile(path, JSON.stringify(record));
  try {
    const [state] = await controlServices("status", kind);
    assert.equal(state.state, "stale");
    await readFile(path);
    await controlServices("stop", kind);
    assert.equal(process.kill(process.pid, 0), true);
    await assert.rejects(readFile(path), { code: "ENOENT" });
  } finally {
    await rm(path, { force: true });
  }
});

test("隔离验证服务被远程中断时返回失败，并清除临时数据", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "acceptances-service-fixture-"),
  );
  const binary = join(directory, "fixture.cjs");
  const kind = `test-${randomUUID()}`;
  let service;
  try {
    await writeFile(binary, "#!/usr/bin/env node\n" + fixture);
    await chmod(binary, 0o755);
    service = await startIsolatedServer({
      kind,
      binary,
      web: directory,
      signals: false,
    });
    const dataDirectory = dirname(service.data);
    const port = Number(new URL(service.base).port);
    await controlServices("stop", kind);
    await assert.rejects(service.stop(), /services-stop 中断/);
    await assertPortFree(port);
    await assert.rejects(access(dataDirectory), { code: "ENOENT" });
    assert.deepEqual(await controlServices("status", kind), []);
  } finally {
    await service?.stop().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
