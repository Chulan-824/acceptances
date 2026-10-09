import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { after, test } from "node:test";
import { run } from "./acceptances.mjs";
import { API, chooseBasis } from "./lib/http.mjs";
import { canonical, pack } from "./lib/bundle.mjs";
import { digest, origin, token, workspace } from "./lib/local.mjs";

const root = resolve(import.meta.dirname, "../../..");
const temp = mkdtempSync(join(tmpdir(), "acceptances-agent-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const projectId = "00000000-0000-4000-8000-000000000001";
const tokenFile = join(temp, "token");
writeFileSync(
  tokenFile,
  "acp_00000000-0000-4000-8000-000000000099.synthetic-local-only\n",
  { mode: 0o600 },
);
const nativeCLI = join(root, "build", "acceptances");

async function service(fn) {
  const events = [],
    repositories = [],
    campaigns = [];
  let version = 0,
    basis = { planId: null, targetId: null };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url.split("?")[0];
    events.push({ method: req.method, path, body, headers: req.headers });
    const reply = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        ETag: `"basis-${version}"`,
      });
      res.end(JSON.stringify({ data }));
    };
    if (!req.headers.authorization?.startsWith("Bearer acp_"))
      return reply(401, {});
    if (path.endsWith("/repositories")) {
      if (req.method === "GET")
        return reply(200, { items: repositories, nextCursor: null });
      repositories.push(body);
      return reply(201, body);
    }
    if (path.endsWith("/campaigns")) {
      if (req.method === "GET")
        return reply(200, { items: campaigns, nextCursor: null });
      campaigns.push(body);
      return reply(201, body);
    }
    if (path.endsWith("/basis")) {
      if (req.headers["if-match"] !== `"basis-${version}"`)
        return reply(412, {});
      basis = { planId: body.planId, targetId: body.targetId };
      version++;
      return reply(200, { ...basis, basisVersion: String(version) });
    }
    const campaign = campaigns.find((c) => path.endsWith(`/campaigns/${c.id}`));
    if (campaign) return reply(200, { ...campaign, ...basis });
    return reply(404, {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn({
      url: `http://127.0.0.1:${server.address().port}`,
      events,
      campaigns,
      repositories,
      setBasis(value) {
        basis = value;
        version++;
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("JCS matches independent golden bytes and hashes", () => {
  const vectors = JSON.parse(
    readFileSync(join(root, "contracts/fixtures/jcs-vectors.json"), "utf8"),
  );
  for (const vector of vectors) {
    const raw = canonical(JSON.parse(vector.input));
    assert.equal(raw, vector.canonical);
    assert.equal(digest(raw), vector.sha256);
  }
});

test("token mode and local origin are enforced", () => {
  assert.throws(() => origin("https://example.com"));
  assert.throws(() => origin("http://user:password@127.0.0.1:8765"));
  assert.equal(origin("http://127.0.0.1:8765/"), "http://127.0.0.1:8765");
  const publicToken = join(temp, "public-token");
  writeFileSync(publicToken, "synthetic-only", { mode: 0o644 });
  chmodSync(publicToken, 0o644);
  assert.throws(() => token(publicToken), /600/);
});

test("first association and repeated requirement reuse the same repository and campaign", async () => {
  const repo = join(temp, "business");
  execFileSync("git", [
    "clone",
    "--quiet",
    "--shared",
    "--no-checkout",
    root,
    repo,
  ]);
  const configDir = join(temp, "configs"),
    dataDir = join(temp, "runs");
  const args = ["--repo", repo, "--config-dir", configDir];
  assert.equal((await run(["inspect", ...args])).connected, false);
  await service(async ({ url, events, campaigns }) => {
    await run([
      "connect",
      ...args,
      "--project",
      projectId,
      "--token-file",
      tokenFile,
      "--acceptances-root",
      root,
      "--data-dir",
      dataDir,
      "--url",
      url,
    ]);
    const first = await run([
      "prepare",
      ...args,
      "--key",
      "issue/42",
      "--title",
      "First title",
    ]);
    const second = await run([
      "prepare",
      ...args,
      "--key",
      "issue/42",
      "--title",
      "Renamed title",
    ]);
    assert.equal(first.campaignId, second.campaignId);
    assert.equal(first.repository.id, second.repository.id);
    assert.equal(
      events.filter(
        (e) => e.method === "POST" && e.path.endsWith("/repositories"),
      ).length,
      1,
    );
    assert.equal(
      events.filter((e) => e.method === "POST" && e.path.endsWith("/campaigns"))
        .length,
      1,
    );
    const newRun = await run(["new-run", ...args, "--key", "issue/42"]);
    const retryRun = await run(["new-run", ...args, "--key", "issue/42"]);
    assert.notEqual(newRun.runId, retryRun.runId);
    assert.equal(newRun.campaignId, first.campaignId);
    assert.equal(
      readFileSync(join(newRun.bundle, "run.json"), "utf8").includes(
        "synthetic-local-only",
      ),
      false,
    );
    const linked = join(temp, "linked-worktree");
    execFileSync("git", [
      "-C",
      repo,
      "worktree",
      "add",
      "--quiet",
      "--detach",
      linked,
      "HEAD",
    ]);
    assert.equal(workspace(repo).key, workspace(linked).key);
    assert.equal(
      (await run(["inspect", "--repo", linked, "--config-dir", configDir]))
        .projectId,
      projectId,
    );
    campaigns.push({
      ...campaigns[0],
      id: "00000000-0000-4000-8000-000000000088",
    });
    await assert.rejects(
      run(["prepare", ...args, "--key", "issue/42", "--title", "Title"]),
      (err) => err.code === "AMBIGUOUS_CAMPAIGN",
    );
    const selected = await run([
      "prepare",
      ...args,
      "--key",
      "issue/42",
      "--title",
      "Title",
      "--campaign",
      first.campaignId,
    ]);
    assert.equal(selected.campaignId, first.campaignId);
    assert.equal(
      (await run(["prepare", ...args, "--key", "issue/42", "--title", "Title"]))
        .campaignId,
      first.campaignId,
    );
  });
});

test("basis change needs a specific current confirmation; stale confirmations cannot write", async () => {
  await service(async ({ url, campaigns, events, setBasis }) => {
    const campaign = "00000000-0000-4000-8000-000000000003",
      plan = "00000000-0000-4000-8000-000000000010",
      target = "00000000-0000-4000-8000-000000000011";
    campaigns.push({ id: campaign });
    const api = new API({ url, tokenFile, projectId });
    assert.equal(
      (await chooseBasis(api, campaign, plan, target, undefined, "initial"))
        .status,
      "initial_adopted",
    );
    assert.equal(
      (await chooseBasis(api, campaign, plan, target, undefined, "same"))
        .status,
      "unchanged",
    );
    const next = "00000000-0000-4000-8000-000000000022";
    const pending = await chooseBasis(
      api,
      campaign,
      plan,
      next,
      undefined,
      "changed",
    );
    assert.equal(pending.status, "confirmation_required");
    assert.equal(events.filter((e) => e.method === "PATCH").length, 1);
    setBasis({ planId: plan, targetId: target });
    const stale = await chooseBasis(
      api,
      campaign,
      plan,
      next,
      pending.etag,
      "stale",
    );
    assert.equal(stale.status, "confirmation_required");
    assert.equal(events.filter((e) => e.method === "PATCH").length, 1);
    const accepted = await chooseBasis(
      api,
      campaign,
      plan,
      next,
      stale.etag,
      "user confirmed",
    );
    assert.equal(accepted.status, "confirmed_adopted");
    assert.equal(events.filter((e) => e.method === "PATCH").length, 2);
  });
});

test("pack computes real raw hashes; retry preserves bytes and corrupted evidence is rejected", async () => {
  const bundle = join(temp, "bundle");
  cpSync(join(root, "contracts/fixtures/failed-bundle"), bundle, {
    recursive: true,
  });
  rmSync(join(bundle, "manifest.json"));
  const assetsFile = join(temp, "assets.json");
  writeFileSync(
    assetsFile,
    JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000017",
        path: "assets/observation.txt",
        kind: "text",
        mediaType: "text/plain",
      },
    ]),
  );
  const config = {
    projectId,
    cli: nativeCLI,
    tokenFile,
    url: "http://127.0.0.1:8765",
  };
  assert.equal((await pack(config, bundle, assetsFile)).valid, true);
  const manifest = readFileSync(join(bundle, "manifest.json"));
  assert.equal((await pack(config, bundle, assetsFile)).valid, true);
  assert.deepEqual(readFileSync(join(bundle, "manifest.json")), manifest);
  writeFileSync(
    join(bundle, "assets/observation.txt"),
    "tampered synthetic evidence",
  );
  await assert.rejects(
    pack(config, bundle, assetsFile),
    (error) => error.code === "DIGEST_MISMATCH",
  );
});

test("pack refuses traversal evidence before reading outside bundle", async () => {
  const bundle = join(temp, "traversal-bundle");
  cpSync(join(root, "contracts/fixtures/failed-bundle"), bundle, {
    recursive: true,
  });
  rmSync(join(bundle, "manifest.json"));
  const assetFile = join(temp, "bad-assets.json");
  writeFileSync(
    assetFile,
    JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000017",
        path: "assets/../../token",
        kind: "text",
        mediaType: "text/plain",
      },
    ]),
  );
  await assert.rejects(
    pack({ projectId, cli: nativeCLI }, bundle, assetFile),
    (error) => error.code === "PATH_INVALID",
  );
});

test("invalid initial pack can be corrected without freezing an unpublished manifest", async () => {
  const bundle = join(temp, "invalid-first-pack");
  cpSync(join(root, "contracts/fixtures/failed-bundle"), bundle, {
    recursive: true,
  });
  rmSync(join(bundle, "manifest.json"));
  const path = join(bundle, "report.json"),
    report = JSON.parse(readFileSync(path, "utf8"));
  report.results[0].attempts[0].observations[0].verdict = "invalid-verdict";
  writeFileSync(path, JSON.stringify(report));
  const assetsFile = join(temp, "retry-pack-assets.json");
  writeFileSync(
    assetsFile,
    JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000017",
        path: "assets/observation.txt",
        kind: "text",
        mediaType: "text/plain",
      },
    ]),
  );
  const config = {
    projectId,
    cli: nativeCLI,
    tokenFile,
    url: "http://127.0.0.1:8765",
  };
  await assert.rejects(pack(config, bundle, assetsFile));
  assert.equal(existsSync(join(bundle, "manifest.json")), false);
  report.results[0].attempts[0].observations[0].verdict = "failed";
  writeFileSync(path, JSON.stringify(report));
  assert.equal((await pack(config, bundle, assetsFile)).valid, true);
});
