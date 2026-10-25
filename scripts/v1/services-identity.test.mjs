import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { root } from "./services.mjs";
import { createMySQLTestDatabase } from "./mysql-test-database.mjs";
import { snapshot } from "./release-check.mjs";
import { sourceIdentity, buildFlags } from "./source-identity.mjs";

test(
  "真实 API 在临时 main 更新后保持旧身份，健康不代表版本一致，重建重启后匹配",
  { timeout: 180000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "acceptances-running-version-"),
    );
    let database, service, isolated;
    try {
      // Only this disposable clone receives fixture commits and API restarts.
      execFileSync("git", [
        "clone",
        "--shared",
        "--no-checkout",
        "--quiet",
        root,
        directory,
      ]);
      await snapshot(root, directory);
      isolated = await import(
        pathToFileURL(join(directory, "scripts/v1/services.mjs")).href
      );
      await mkdir(join(directory, "build"));
      const binary = join(directory, "build/server-fixture");
      const build = async () => {
        const identity = await sourceIdentity(directory);
        execFileSync(
          "go",
          [
            "build",
            "-buildvcs=false",
            "-ldflags",
            buildFlags(identity),
            "-o",
            binary,
            "./cmd/server",
          ],
          { cwd: directory, stdio: "pipe", timeout: 120000 },
        );
        return identity;
      };
      const before = await build();
      database = await createMySQLTestDatabase();
      const start = () =>
        isolated.startIsolatedServer({
          kind: "identity",
          binary,
          web: "",
          signals: false,
          environment: database.environment,
        });
      service = await start();
      let [state] = await isolated.controlServices("status", "identity");
      assert.equal(state.processes[0].sourceComparison, "matches");
      assert.equal(service.identity.sourceDigest, before.sourceDigest);
      t.diagnostic(
        JSON.stringify({
          stage: "started",
          running: service.identity,
          comparison: state.processes[0].sourceComparison,
        }),
      );

      const source = join(directory, "internal/buildinfo/version.go");
      await writeFile(
        source,
        (await readFile(source, "utf8")) +
          "\n// Fixture source changed after the server started.\n",
      );
      [state] = await isolated.controlServices("status", "identity");
      assert.equal(state.currentSource.commit, before.commit);
      assert.equal(state.currentSource.dirty, true);
      assert.equal(state.processes[0].sourceComparison, "differs");
      t.diagnostic(
        JSON.stringify({
          stage: "dirty-edit",
          current: state.currentSource,
          comparison: state.processes[0].sourceComparison,
        }),
      );
      const git = (...args) =>
        execFileSync(
          "git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          {
            cwd: directory,
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
      git("add", "--all");
      git("commit", "--quiet", "-m", "fixture main updated");
      [state] = await isolated.controlServices("status", "identity");
      assert.notEqual(state.currentSource.commit, before.commit);
      assert.equal(state.processes[0].identity.commit, before.commit);
      assert.equal(state.processes[0].sourceComparison, "differs");
      assert.equal((await fetch(service.base + "/health/ready")).status, 200);
      const capability = await (
        await fetch(service.base + "/api/v1/capabilities")
      ).json();
      assert.equal(capability.commit, before.commit);
      assert.equal(capability.build.sourceDigest, before.sourceDigest);
      t.diagnostic(
        JSON.stringify({
          stage: "temporary-main-updated",
          running: capability.build,
          current: state.currentSource,
          comparison: state.processes[0].sourceComparison,
          ready: true,
        }),
      );
      await service.stop();
      service = null;
      const after = await build();
      service = await start();
      [state] = await isolated.controlServices("status", "identity");
      assert.equal(state.processes[0].identity.commit, after.commit);
      assert.equal(
        state.processes[0].identity.sourceDigest,
        after.sourceDigest,
      );
      assert.equal(state.processes[0].sourceComparison, "matches");
      t.diagnostic(
        JSON.stringify({
          stage: "rebuilt-and-restarted",
          running: service.identity,
          current: state.currentSource,
          comparison: state.processes[0].sourceComparison,
        }),
      );
      assert.equal((await fetch(service.base + "/health/ready")).status, 200);
    } finally {
      try {
        await service?.stop();
      } finally {
        try {
          await database?.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  },
);
