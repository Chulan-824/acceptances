import { execFileSync } from "node:child_process";
const suite = process.argv[2] || "all";
const targets = { all: "./...", http: "./internal/api", cli: "./internal/cli" };
if (suite === "all" || suite === "services") {
  execFileSync(
    "node",
    [
      "--test",
      "scripts/v1/services.test.mjs",
      "scripts/v1/services-exit.test.mjs",
    ],
    {
      stdio: "inherit",
    },
  );
}
if (suite === "services") {
  execFileSync("node", ["--test", "scripts/v1/services-dev.test.mjs"], {
    stdio: "inherit",
  });
}
if (targets[suite]) {
  execFileSync("go", ["test", targets[suite], "-count=1", "-timeout=120s"], {
    stdio: "inherit",
  });
} else if (suite === "services") {
  // The lifecycle and development service tests already ran above.
} else if (suite === "agent") {
  await import("./agent-check.mjs");
} else if (suite === "platform") {
  await import("./platform-check.mjs");
} else if (suite === "e2e") {
  await import("./e2e-check.mjs");
} else {
  console.error(
    "可用 SUITE=all|services|http|cli|agent|platform|e2e；e2e 需要外部真实浏览器驱动。",
  );
  process.exit(2);
}
