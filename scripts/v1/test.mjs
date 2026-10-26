import { execFileSync } from "node:child_process";
const suite = process.argv[2] || "all";
if (
  ["all", "http", "mysql", "platform", "services", "browser"].includes(suite)
) {
  execFileSync("make", ["mysql-up"], { stdio: "inherit" });
  process.env.ACCEPTANCES_MYSQL_TEST_DSN_FILE ||=
    process.cwd() + "/.cache/mysql/dev.dsn";
}
const targets = {
  all: ["./..."],
  http: [
    "./internal/api",
    "./internal/handler",
    "./internal/service",
    "./internal/dao",
    "./internal/httpserver",
  ],
  cli: ["./internal/cli"],
};
if (suite === "all" || suite === "web") {
  execFileSync("node", ["--test", "apps/web/tests/*.test.mjs"], {
    stdio: "inherit",
  });
}
if (suite === "all" || suite === "services") {
  execFileSync(
    "node",
    [
      "--test",
      "scripts/v1/services.test.mjs",
      "scripts/v1/services-exit.test.mjs",
      "scripts/v1/services-identity.test.mjs",
    ],
    {
      stdio: "inherit",
    },
  );
}
if (suite === "all") {
  execFileSync(
    "node",
    [
      "--test",
      "scripts/v1/checks.test.mjs",
      "scripts/v1/release-check.test.mjs",
      "scripts/v1/source-identity.test.mjs",
      "scripts/v1/docker-package.test.mjs",
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
targets.mysql = targets.http;
if (targets[suite]) {
  execFileSync(
    "go",
    ["test", ...targets[suite], "-count=1", "-timeout=600s", "-parallel=4"],
    {
      stdio: "inherit",
    },
  );
} else if (suite === "web" || suite === "services") {
  // The selected Node tests already ran above.
} else if (suite === "browser") {
  execFileSync("make", ["build"], { stdio: "inherit" });
  execFileSync("node", ["scripts/v1/browser-check.mjs"], { stdio: "inherit" });
} else if (suite === "agent") {
  await import("./agent-check.mjs");
} else if (suite === "platform") {
  await import("./platform-check.mjs");
} else if (suite === "e2e") {
  await import("./e2e-check.mjs");
} else {
  console.error(
    "可用 SUITE=all|web|services|mysql|browser|http|cli|agent|platform|e2e；mysql 使用 Docker MySQL，browser 使用隔离服务，e2e 需要外部真实浏览器驱动。",
  );
  process.exit(2);
}
