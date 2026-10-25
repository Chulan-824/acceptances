import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildFlags,
  compareIdentity,
  sourceIdentity,
} from "./source-identity.mjs";

test("identity detects commit and dirty source changes, includes embeds, and excludes private files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "acceptances-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: root,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
      },
    );
  git("init", "--quiet");
  await mkdir(join(root, "internal"));
  await writeFile(join(root, "go.mod"), "module fixture\n");
  await writeFile(join(root, "internal/api.go"), "package api\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture");
  const clean = await sourceIdentity(root);
  assert.equal(clean.dirty, false);
  assert.equal(compareIdentity(clean, await sourceIdentity(root)), "matches");
  await writeFile(join(root, "internal/api.go"), "package api // changed\n");
  const dirty = await sourceIdentity(root);
  assert.equal(dirty.commit, clean.commit);
  assert.equal(dirty.dirty, true);
  assert.equal(compareIdentity(clean, dirty), "differs");
  await writeFile(
    join(root, "internal/api.go"),
    "package api // changed again\n",
  );
  assert.equal(compareIdentity(dirty, await sourceIdentity(root)), "differs");
  await writeFile(join(root, "internal/report.html"), "embedded template");
  const embedded = await sourceIdentity(root);
  assert.notEqual(embedded.sourceDigest, dirty.sourceDigest);
  await writeFile(join(root, "internal/.env.fixture"), "fixture only");
  await writeFile(join(root, "internal/api_test.go"), "test only");
  assert.equal(
    (await sourceIdentity(root)).sourceDigest,
    embedded.sourceDigest,
  );
  await rm(join(root, "internal/.env.fixture"));
  git("add", ".");
  git("commit", "--quiet", "-m", "fixture main update");
  const merged = await sourceIdentity(root);
  assert.notEqual(merged.commit, clean.commit);
  assert.equal(compareIdentity(clean, merged), "differs");
  await symlink("api.go", join(root, "internal/link.go"));
  assert.equal((await sourceIdentity(root)).sourceDigest, "unknown");
});

test("unknown and malformed identities never compare as matching; linker input is constrained", async () => {
  const identity = {
    commit: "a".repeat(40),
    dirty: true,
    sourceDigest: "b".repeat(64),
  };
  assert.match(buildFlags(identity), /\.Dirty=true/);
  for (const value of [
    null,
    {},
    { ...identity, dirty: null },
    { ...identity, commit: "unknown" },
    { ...identity, sourceDigest: "unknown" },
  ])
    assert.equal(compareIdentity(value, identity), "unknown");
  assert.throws(() => buildFlags({ ...identity, commit: "bad -X injected" }));
  assert.throws(() => buildFlags({ ...identity, sourceDigest: "bad value" }));
});
