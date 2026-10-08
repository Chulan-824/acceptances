import { spawnSync, execFileSync } from "node:child_process";
import {
  readFileSync,
  lstatSync,
  realpathSync,
  readlinkSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, resolve, relative, sep } from "node:path";
if (process.env.ACCEPTANCES_EXTERNAL_CI !== "1")
  throw new Error("仅允许外部 Agent/CI 执行");
const runner = process.env.ACCEPTANCES_E2E_RUNNER;
if (!runner || !isAbsolute(runner) || !lstatSync(runner).isFile())
  throw new Error("设置 ACCEPTANCES_E2E_RUNNER 为外部真实浏览器驱动的绝对路径");
const baseURL = new URL(
  process.env.ACCEPTANCES_E2E_URL || "http://127.0.0.1:8765",
);
if (
  baseURL.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(baseURL.hostname) ||
  baseURL.username ||
  baseURL.password
)
  throw new Error("e2e 只允许专用本机测试服务");
if (process.env.ACCEPTANCES_TEST_ISOLATED !== "1")
  throw new Error("需要专用服务/卷及 ACCEPTANCES_TEST_ISOLATED=1");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sourceDigest() {
  const paths = execFileSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  const entries = [];
  for (const path of paths) {
    if (path.split("/").some((part) => part.startsWith(".env"))) continue;
    try {
      const stat = lstatSync(path);
      entries.push({
        path,
        kind: stat.isSymbolicLink() ? "link" : "file",
        sha256: digest(
          stat.isSymbolicLink()
            ? Buffer.from(readlinkSync(path))
            : readFileSync(path),
        ),
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      entries.push({ path, kind: "deleted" });
    }
  }
  return digest(JSON.stringify(entries));
}
const before = sourceDigest();
const startedAt = new Date().toISOString();
mkdirSync("artifacts", { recursive: true });
const receipt = resolve("artifacts/e2e-driver-receipt.json");
const result = spawnSync(
  runner,
  ["--base-url", baseURL.origin, "--receipt", receipt],
  { stdio: "inherit", timeout: 300000 },
);
if (result.error || result.status !== 0)
  throw new Error("外部浏览器驱动失败或超时，不能记为通过");
const report = JSON.parse(readFileSync(receipt, "utf8"));
const required = [
  "failure-rejection",
  "new-run-acceptance",
  "report-correction",
  "stale-basis",
  "cross-project",
  "expired-session",
  "unsafe-and-missing-evidence",
];
const evidence = [];
for (const name of required) {
  const step = report.steps?.find(
    (step) => step.name === name && step.outcome === "passed",
  );
  if (!step || !Array.isArray(step.evidence) || !step.evidence.length)
    throw new Error(`缺少真实浏览器步骤证据: ${name}`);
  for (const file of step.evidence) {
    const path = resolve(file);
    if (!lstatSync(path).isFile()) throw new Error("证据必须是普通文件");
    const rel = relative(realpathSync("artifacts"), realpathSync(path));
    if (rel.startsWith(".." + sep) || isAbsolute(rel) || !rel)
      throw new Error("证据须放在 artifacts 内");
    evidence.push({ path: rel, sha256: digest(readFileSync(path)) });
  }
}
if (sourceDigest() !== before)
  throw new Error("源码在浏览器验证期间变化，需要重新验证候选");
writeFileSync(
  "artifacts/e2e.json",
  JSON.stringify(
    {
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"])
        .toString()
        .trim(),
      sourceSnapshotDigest: before,
      startedAt,
      endedAt: new Date().toISOString(),
      environmentClass: "external-real-browser",
      outcome: "external-driver-passed",
      steps: required,
      evidence,
      limitations: [
        "驱动由外部 Agent/CI 提供，必须归档其代码/版本与实际截图、网络和断言记录",
        "本入口只校验回执完整性，完整 A01-A35 矩阵仍逐项核对",
      ],
    },
    null,
    2,
  ) + "\n",
);
