import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const suite = process.argv[2];
const targets = {
  domain: ["./internal/reviews"],
  cli: ["./internal/cli"],
  postgres: ["./internal/api", "./internal/identity"],
  "storage-local": ["./internal/api"],
};
if (process.env.ACCEPTANCES_EXTERNAL_CI !== "1")
  throw new Error("仅允许外部 Agent/CI 执行");
if (!targets[suite]) throw new Error("Unknown suite");
if (
  ["postgres", "storage-local"].includes(suite) &&
  (!process.env.ACCEPTANCES_TEST_DATABASE_URL ||
    process.env.ACCEPTANCES_TEST_ISOLATED !== "1")
)
  throw new Error(
    "需要全新的 acceptances_test_* 专用数据库与 ACCEPTANCES_TEST_ISOLATED=1；不会清空已有安装",
  );
const startedAt = new Date().toISOString();
execFileSync("go", ["test", ...targets[suite], "-count=1", "-timeout=120s"], {
  stdio: "inherit",
});
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  `artifacts/${suite}.json`,
  JSON.stringify(
    {
      suite,
      startedAt,
      endedAt: new Date().toISOString(),
      environmentClass: ["postgres", "storage-local"].includes(suite)
        ? "in-process-http-real-postgresql"
        : "isolated-go",
      outcome: "passed",
      acceptanceMatrixStatus: "partial",
      limitations: [
        "仅执行当前测试代码覆盖的行为；完整 A01-A35 矩阵仍须逐项回填",
        "未验证部署后的 Docker 服务或真实浏览器",
      ],
    },
    null,
    2,
  ) + "\n",
);
