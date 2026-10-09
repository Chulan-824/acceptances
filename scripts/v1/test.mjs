import { execFileSync } from "node:child_process";
const suite = process.argv[2] || "all";
const targets = { all: "./...", http: "./internal/api", cli: "./internal/cli" };
if (targets[suite]) {
  execFileSync("go", ["test", targets[suite], "-count=1", "-timeout=120s"], {
    stdio: "inherit",
  });
} else if (suite === "agent") {
  await import("./agent-check.mjs");
} else if (suite === "platform") {
  await import("./platform-check.mjs");
} else if (suite === "e2e") {
  await import("./e2e-check.mjs");
} else {
  console.error(
    "可用 SUITE=all|http|cli|agent|platform|e2e；e2e 需要外部真实浏览器驱动。",
  );
  process.exit(2);
}
