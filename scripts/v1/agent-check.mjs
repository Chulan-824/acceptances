import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const startedAt = new Date().toISOString();
mkdirSync("build", { recursive: true });
execFileSync(
  "go",
  ["build", "-trimpath", "-o", "build/acceptances", "./cmd/acceptances"],
  { stdio: "inherit" },
);
execFileSync(
  process.execPath,
  ["--test", "skills/acceptances-v1/scripts/acceptances.test.mjs"],
  { stdio: "inherit" },
);
execFileSync(
  "go",
  ["test", "./internal/identity", "./internal/cli", "-count=1"],
  { stdio: "inherit" },
);
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/agent.json",
  JSON.stringify(
    {
      suite: "agent",
      startedAt,
      endedAt: new Date().toISOString(),
      outcome: "passed",
      environmentClass: "isolated-helper-and-go",
      limitations: [
        "HTTP helper tests use a controlled local service; not deployed Docker or browser acceptance",
        "Database route matrix is in SUITE=postgres and requires a fresh dedicated database",
      ],
    },
    null,
    2,
  ) + "\n",
);
