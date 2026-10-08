import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// 本文件也可以被直接调用，因此保留执行边界检查。
if (process.env.ACCEPTANCES_EXTERNAL_CI !== "1")
  throw new Error("仅允许外部 Agent/CI 执行");
const startedAt = new Date().toISOString();
const hashes = {};
for (const name of ["server", "acceptances"]) {
  hashes[name] = createHash("sha256")
    .update(await readFile(`build/${name}`))
    .digest("hex");
}
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
// 未提交状态还需 CI 归档源码快照；不能把此指纹当作完整源码内容摘要。
const dirty = execFileSync("git", ["status", "--porcelain=v1"], {
  encoding: "utf8",
});
const version = JSON.parse(
  execFileSync("./build/acceptances", ["version", "--json"], {
    encoding: "utf8",
  }),
);
assert.equal(version.phase, "local-v1");
const child = spawn(
  "./build/server",
  ["--listen", "127.0.0.1:0", "--web-dir", "apps/web/dist"],
  {
    stdio: ["ignore", "ignore", "pipe"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("ACCEPTANCES_"),
      ),
    ),
  },
);
let output = "";
let spawnError;
child.on("error", (error) => {
  spawnError = error;
});
child.stderr.on("data", (data) => {
  output += data.toString();
});
const closed = new Promise((resolve) => child.on("close", resolve));
try {
  let address;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    address = output.match(/address=(127\.0\.0\.1:\d+)/)?.[1];
    if (address) break;
    if (child.exitCode !== null) throw new Error("服务启动失败");
    await delay(100);
  }
  assert.ok(address, "服务未在期限内启动");
  const get = (path) =>
    fetch(`http://${address}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal((await get("/health/live")).status, 200);
  const ready = await get("/health/ready");
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).code, "DATABASE_NOT_CONFIGURED");
  assert.deepEqual(await (await get("/api/v1/capabilities")).json(), version);
  const page = await get("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  const asset = html.match(/src="([^" ]+\.js)"/)?.[1];
  assert.ok(asset, "缺少生产 Web 入口");
  assert.equal((await get(asset)).status, 200);
  assert.equal((await get("/api/v1/unknown")).status, 404);
  child.kill("SIGTERM");
  const shutdownTimer = setTimeout(() => child.kill("SIGKILL"), 6000);
  const exitCode = await closed;
  clearTimeout(shutdownTimer);
  assert.equal(exitCode, 0, "服务未正常退出");
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/platform.json",
    JSON.stringify(
      {
        acceptanceId: "A34",
        sourceCommit,
        dirty: Boolean(dirty),
        artifactDigest: hashes,
        platform: `${process.platform}/${process.arch}`,
        provider: "none",
        environmentClass: "native-process",
        command: "make test SUITE=platform",
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: 0,
        outcome: "passed",
        limitations: [
          "仅当前原生平台基础烟测",
          "Docker、数据库、浏览器及业务能力未覆盖",
          "dirty 时必须另存源码快照，否则证据不可作为候选验收",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("当前原生平台基础检查通过；完整 A34/A35 仍需其余证据。");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000);
    await closed;
    clearTimeout(timer);
  }
}
