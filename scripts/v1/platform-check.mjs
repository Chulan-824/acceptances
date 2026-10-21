import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { startIsolatedServer } from "./services.mjs";

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
assert.ok(version, "CLI 应返回 JSON 版本信息");
const service = await startIsolatedServer({
  kind: "platform",
  binary: resolve("build/server"),
  web: resolve("apps/web/dist"),
});
try {
  const get = (path) =>
    fetch(`${service.base}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal((await get("/health/live")).status, 200);
  const ready = await get("/health/ready");
  assert.equal(ready.status, 200, "首次启动应自动初始化并就绪");
  const page = await get("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  const asset = html.match(/src="([^" ]+\.js)"/)?.[1];
  assert.ok(asset, "缺少生产 Web 入口");
  assert.equal((await get(asset)).status, 200);
  assert.equal((await get("/api/v1/unknown")).status, 404);
  const { code } = await service.stop();
  assert.equal(code, 0, "服务未正常退出");
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/platform.json",
    JSON.stringify(
      {
        acceptanceId: "T1",
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
          "Docker、重启持久化、浏览器及业务能力未覆盖",
          "dirty 时必须另存源码快照，否则证据不可作为候选验收",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("当前原生平台基础检查通过；完整 T1–T9 仍需其余证据。");
} finally {
  await service.stop();
}
