import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const startedAt = new Date().toISOString();
mkdirSync("build", { recursive: true });
execFileSync(
  "go",
  ["build", "-trimpath", "-o", "build/acceptances", "./cmd/acceptances"],
  { stdio: "inherit" },
);
execFileSync("python3", ["scripts/v1/install-skill.test.py"], {
  stdio: "inherit",
});
execFileSync("go", ["test", "./internal/cli", "-count=1"], {
  stdio: "inherit",
});
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
        "HTTP integration tests use isolated SQLite storage via SUITE=http",
      ],
    },
    null,
    2,
  ) + "\n",
);
