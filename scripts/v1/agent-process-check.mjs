// Real Go process + dedicated PostgreSQL + existing Go CLI. Inputs are labelled contract fixtures.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { run } from "../../skills/acceptances-v1/scripts/acceptances.mjs";

const dsn = process.env.ACCEPTANCES_TEST_DATABASE_URL;
if (
  process.env.ACCEPTANCES_EXTERNAL_CI !== "1" ||
  process.env.ACCEPTANCES_TEST_ISOLATED !== "1" ||
  !dsn ||
  !new URL(dsn).pathname.startsWith("/acceptances_test_")
)
  throw new Error("需要新的专用 acceptances_test_* 数据库；仅外部隔离运行");
const root = resolve(import.meta.dirname, "../.."),
  temp = mkdtempSync(join(tmpdir(), "acceptances-process-"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const url = `http://127.0.0.1:${port}`,
  env = {
    ...process.env,
    ACCEPTANCES_DATABASE_URL: dsn,
    ACCEPTANCES_DATA_DIR: join(temp, "data"),
    ACCEPTANCES_PUBLIC_ORIGIN: url,
  };
delete env.ACCEPTANCES_DATABASE_PASSWORD_FILE;
delete env.ACCEPTANCES_DATABASE_URL_FILE;
let child,
  processLog = "",
  passed = false;
try {
  // Check freshness before migration so an existing installation is never mutated by this driver.
  const database = new URL(dsn);
  const sql = ["-Atc", "SELECT to_regclass('public.projects') IS NULL"];
  const container = process.env.ACCEPTANCES_TEST_POSTGRES_CONTAINER;
  const fresh = execFileSync(
    container ? "docker" : "psql",
    container
      ? [
          "exec",
          container,
          "psql",
          "-U",
          database.username,
          "-d",
          database.pathname.slice(1),
          ...sql,
        ]
      : [dsn, ...sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (fresh !== "t")
    throw new Error("专用数据库不是全新数据库，保留现有数据并停止");
  mkdirSync("build", { recursive: true });
  execFileSync(
    "go",
    ["build", "-trimpath", "-o", "build/server", "./cmd/server"],
    { stdio: "inherit" },
  );
  execFileSync(
    "go",
    ["build", "-trimpath", "-o", "build/acceptances", "./cmd/acceptances"],
    { stdio: "inherit" },
  );
  execFileSync(join(root, "build/server"), ["migrate", "up"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const credentials = join(temp, "owner.json");
  writeFileSync(
    credentials,
    JSON.stringify({
      username: "isolated-process-owner",
      password: "isolated-process-password-1234",
    }),
    { mode: 0o600 },
  );
  execFileSync(
    join(root, "build/server"),
    ["init-owner", "--input", credentials],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child = spawn(
    join(root, "build/server"),
    ["--listen", `127.0.0.1:${port}`, "--web-dir", join(root, "apps/web/dist")],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (chunk) => {
    processLog += chunk.toString();
  });
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      healthy = (await fetch(url + "/health/ready")).ok;
    } catch {
      /* startup */
    }
    if (healthy) break;
    await delay(100);
  }
  assert.equal(healthy, true, "isolated real server readiness");
  const request = async (path, body, extra = {}) => {
    const res = await fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: url,
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(res.ok, true, `HTTP ${res.status} at ${path}`);
    return { data: (await res.json()).data, headers: res.headers };
  };
  const session = await request(
    "/api/v1/session",
    JSON.parse(readFileSync(credentials, "utf8")),
  );
  const owner = {
    Cookie: session.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": session.data.csrfToken,
  };
  const projectId = "00000000-0000-4000-8000-000000000001";
  await request(
    "/api/v1/projects",
    { id: projectId, name: "isolated-agent-process-fixture" },
    owner,
  );
  const token = await request(
    `/api/v1/projects/${projectId}/tokens`,
    {
      id: randomUUID(),
      name: "isolated-fixture-agent",
      scopes: [
        "repositories:write",
        "definitions:write",
        "campaigns:write",
        "runs:write",
        "evidence:write",
        "results:read",
        "feedback:read",
      ],
    },
    owner,
  );
  const tokenFile = join(temp, "agent-token");
  writeFileSync(tokenFile, token.data.secret, { mode: 0o600 });
  const repo = join(temp, "business");
  execFileSync("git", [
    "clone",
    "--quiet",
    "--shared",
    "--no-checkout",
    root,
    repo,
  ]);
  const common = ["--repo", repo, "--config-dir", join(temp, "configs")];
  await run([
    "connect",
    ...common,
    "--project",
    projectId,
    "--token-file",
    tokenFile,
    "--acceptances-root",
    root,
    "--url",
    url,
    "--data-dir",
    join(temp, "runs"),
  ]);
  const prepared = await run([
    "prepare",
    ...common,
    "--key",
    "isolated-contract-fixture",
    "--title",
    "合成失败夹具：仅验证发布协议",
  ]);
  const again = await run([
    "prepare",
    ...common,
    "--key",
    "isolated-contract-fixture",
    "--title",
    "仍是同一需求",
  ]);
  assert.equal(prepared.campaignId, again.campaignId);
  const started = await run([
    "new-run",
    ...common,
    "--key",
    "isolated-contract-fixture",
  ]);
  cpSync(join(root, "contracts/fixtures/failed-bundle"), started.bundle, {
    recursive: true,
  });
  rmSync(join(started.bundle, "manifest.json"));
  const mapping = {
    "00000000-0000-4000-8000-000000000002": prepared.repository.id,
    "00000000-0000-4000-8000-000000000003": prepared.campaignId,
    "00000000-0000-4000-8000-000000000012": started.runId,
    "00000000-0000-4000-8000-000000000013": started.revisionId,
  };
  for (const path of [
    "report.json",
    ...readdirSync(join(started.bundle, "documents")).map(
      (f) => `documents/${f}`,
    ),
  ]) {
    let raw = readFileSync(join(started.bundle, path), "utf8");
    for (const [from, to] of Object.entries(mapping))
      raw = raw.replaceAll(from, to);
    writeFileSync(join(started.bundle, path), raw);
  }
  const assets = join(temp, "assets.json");
  writeFileSync(
    assets,
    JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000017",
        path: "assets/observation.txt",
        kind: "text",
        mediaType: "text/plain",
      },
    ]),
  );
  await run([
    "pack",
    ...common,
    "--bundle",
    started.bundle,
    "--assets",
    assets,
  ]);
  const delivered = await run([
    "deliver",
    ...common,
    "--key",
    "isolated-contract-fixture",
    "--bundle",
    started.bundle,
  ]);
  assert.equal(delivered.publication.phase, "sealed");
  assert.equal(delivered.basis.status, "initial_adopted");
  assert.equal(delivered.ready.satisfied, false);
  assert.equal(delivered.accepted.satisfied, false);
  const retry = await run([
    "deliver",
    ...common,
    "--key",
    "isolated-contract-fixture",
    "--bundle",
    started.bundle,
  ]);
  assert.equal(retry.runId, delivered.runId);
  assert.equal(retry.revisionId, delivered.revisionId);
  assert.equal(retry.basis.status, "unchanged");
  const campaigns = await request(
    `/api/v1/projects/${projectId}/campaigns`,
    null,
    { Authorization: `Bearer ${token.data.secret}` },
  );
  assert.equal(campaigns.data.items.length, 1);
  assert.equal(
    campaigns.data.items[0].externalRefs["acceptances/requirement"],
    "isolated-contract-fixture",
  );
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/agent-process.json",
    JSON.stringify(
      {
        suite: "agent-process",
        outcome: "passed",
        environmentClass: "real-native-process-real-postgresql",
        checks: [
          "first-association",
          "automatic-repository",
          "campaign-reuse",
          "raw-bundle-pack",
          "real-cli-publication",
          "initial-basis",
          "stable-publication-retry",
          "failed-fixture-gates-rejected",
        ],
        limitations: [
          "Report and evidence are explicitly synthetic contract fixtures",
          "Not a business-project test or real browser human-review acceptance",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  passed = true;
  console.log(
    "isolated real-process agent publication passed; synthetic failure correctly remains unaccepted",
  );
} catch (error) {
  if (processLog)
    writeFileSync(join(temp, "server.log"), processLog, { mode: 0o600 });
  console.error(`隔离验证失败，日志保留于 ${temp}`);
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (passed) rmSync(temp, { recursive: true, force: true });
  // Preserve failed isolated logs; never clean an existing database or user volume.
}
