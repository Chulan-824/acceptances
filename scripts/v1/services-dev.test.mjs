import { createMySQLTestDatabase } from "./mysql-test-database.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  root,
  controlServices,
  managedProcess,
  assertPortFree,
} from "./services.mjs";

const exec = promisify(execFile);
async function listen() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return server;
}
async function freePort() {
  const server = await listen();
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

test(
  "真实开发服务：后台启动、重复保护、代理就绪、停止、中断和失败回收",
  { timeout: 240000 },
  async (t) => {
    if ((await controlServices("status", "dev")).length) {
      t.skip("已有开发服务记录，保留当前会话；停止后再运行此检查");
      return;
    }
    const database = await createMySQLTestDatabase();
    t.after(() => database.close());
    const directory = await mkdtemp(join(tmpdir(), "acceptances-dev-test-"));
    const apiPort = await freePort();
    let webPort = await freePort();
    while (webPort === apiPort) webPort = await freePort();
    const env = {
      ...process.env,
      ...database.environment,
      ACCEPTANCES_DEV_API_PORT: String(apiPort),
      ACCEPTANCES_DEV_WEB_PORT: String(webPort),
      ACCEPTANCES_DATA_DIR: join(directory, "data"),
    };
    const dev = (command, options = {}) =>
      exec(process.execPath, ["scripts/v1/dev.mjs", command], {
        cwd: root,
        env,
        timeout: 180000,
        ...options,
      });
    try {
      await dev("up");
      const [state] = await controlServices("status", "dev");
      assert.equal(state.state, "ready");
      const api = state.processes.find((process) => process.name === "api");
      assert.equal(api.sourceComparison, "matches");
      assert.match(api.identity.sourceDigest, /^[a-f0-9]{64}$/);
      assert.equal(
        state.processes.find((process) => process.name === "web").reload,
        "vite-hmr",
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${webPort}/health/ready`)).status,
        200,
      );
      assert.match(
        await (await fetch(`http://127.0.0.1:${webPort}/`)).text(),
        /<html/,
      );
      await assert.rejects(dev("up"), /已有开发服务记录/);
      assert.equal((await controlServices("status", "dev"))[0].pid, state.pid);
      await dev("stop");
      await assertPortFree(apiPort);
      await assertPortFree(webPort);

      const foreground = managedProcess(
        "dev-interrupt",
        process.execPath,
        ["scripts/v1/dev.mjs"],
        { env },
      );
      try {
        const deadline = Date.now() + 150000;
        while (!foreground.output.includes("开发服务就绪")) {
          foreground.assertRunning();
          assert.ok(Date.now() < deadline, foreground.output);
          await delay(100);
        }
        foreground.child.kill("SIGINT");
        assert.equal((await foreground.closed).code, 130);
      } finally {
        await foreground.stop();
      }
      await assertPortFree(apiPort);
      await assertPortFree(webPort);
      assert.deepEqual(await controlServices("status", "dev"), []);

      const occupied = await listen();
      try {
        await assert.rejects(
          dev("up", {
            env: {
              ...env,
              ACCEPTANCES_DEV_API_PORT: String(occupied.address().port),
            },
          }),
          /启动失败/,
        );
        assert.equal(occupied.listening, true);
        await assertPortFree(webPort);
      } finally {
        await new Promise((done) => occupied.close(done));
      }
      assert.deepEqual(await controlServices("status", "dev"), []);

      const bin = join(directory, "bin");
      await mkdir(bin);
      await writeFile(join(bin, "pnpm"), "#!/bin/sh\nexit 23\n");
      await chmod(join(bin, "pnpm"), 0o755);
      await assert.rejects(
        dev("up", { env: { ...env, PATH: `${bin}:${env.PATH}` } }),
        /启动失败/,
      );
      await assertPortFree(apiPort);
      await assertPortFree(webPort);
      assert.deepEqual(await controlServices("status", "dev"), []);
    } finally {
      await controlServices("stop", "dev");
      await rm(directory, { recursive: true, force: true });
    }
  },
);
