import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { root, assertPortFree } from "./services.mjs";

async function freePort() {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  assert.fail(message);
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

// Exercise the actual dev entry point in an independent root, registry and data
// directory. Both command fixtures leave a server inheriting the wrapper's pipes.
for (const scenario of [
  { name: "API 包装进程 SIGKILL", target: "api", signal: "SIGKILL" },
  { name: "Web 包装进程 SIGKILL", target: "web", signal: "SIGKILL" },
  {
    name: "Web 就绪前 API 包装进程 SIGKILL",
    target: "api",
    signal: "SIGKILL",
    starting: true,
  },
  { name: "API 包装进程退出码 23", target: "api", signal: "SIGUSR1", code: 23 },
  {
    name: "API 包装进程退出码 0，后代拒绝 TERM",
    target: "api",
    signal: "SIGUSR1",
    code: 0,
    ignoreTerm: true,
  },
]) {
  test(
    `${scenario.name}：自动回收整组、释放端口并保留数据`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "acceptances-wrapper-exit-"),
      );
      const bin = join(directory, "bin");
      const data = join(directory, "data");
      let owner, ownerClosed, state, isolated;
      let output = "";
      const apiPort = await freePort();
      let webPort = await freePort();
      while (webPort === apiPort) webPort = await freePort();
      const sentinel = "existing-development-data\n";
      try {
        await mkdir(join(directory, "scripts/v1"), { recursive: true });
        await mkdir(bin);
        await mkdir(data);
        await writeFile(join(data, "existing-record"), sentinel);
        for (const file of ["dev.mjs", "services.mjs"])
          await copyFile(
            join(root, "scripts/v1", file),
            join(directory, "scripts/v1", file),
          );
        isolated = await import(
          pathToFileURL(join(directory, "scripts/v1/services.mjs")).href
        );
        for (const [command, kind, port] of [
          ["go", "api", apiPort],
          ["pnpm", "web", webPort],
        ]) {
          const descendant = `
          const http = require("node:http");
          const server = http.createServer((req, res) => {
            res.statusCode = ${scenario.starting && kind === "web" ? 503 : 200};
            res.end("ok");
          });
          server.listen(${port}, "127.0.0.1", () => console.log("descendant-${kind}=" + process.pid));
          process.on("SIGTERM", () => {
            console.log("TERM-${kind}");
            ${scenario.ignoreTerm && kind === scenario.target ? "" : "server.close();"}
          });
        `;
          const wrapper = `#!${process.execPath}
          const { spawn } = require("node:child_process");
          spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "inherit" });
          process.on("SIGUSR1", () => process.exit(${scenario.code ?? 23}));
          setInterval(() => {}, 1000);
        `;
          await writeFile(join(bin, command), wrapper, { mode: 0o755 });
        }
        owner = spawn(
          process.execPath,
          [join(directory, "scripts/v1/dev.mjs")],
          {
            cwd: directory,
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              ACCEPTANCES_DATA_DIR: data,
              ACCEPTANCES_DEV_API_PORT: String(apiPort),
              ACCEPTANCES_DEV_WEB_PORT: String(webPort),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        owner.on("error", (error) => {
          output += error.message;
        });
        for (const stream of [owner.stdout, owner.stderr])
          stream.on("data", (chunk) => {
            output += chunk;
          });
        ownerClosed = new Promise((done) =>
          owner.once("close", (code, signal) => done({ code, signal })),
        );
        await until(
          () =>
            scenario.starting
              ? output.includes("descendant-api=") &&
                output.includes("descendant-web=")
              : output.includes("开发服务就绪"),
          `启动失败：${output}`,
        );
        [state] = await isolated.controlServices("status", "dev");
        assert.equal(state.state, scenario.starting ? "starting" : "ready");
        const descendantPids = ["api", "web"].map((kind) =>
          Number(output.match(new RegExp(`descendant-${kind}=(\\d+)`))?.[1]),
        );
        for (const pid of descendantPids) assert.ok(pid && alive(pid));
        const wrapper = state.processes.find((p) => p.name === scenario.target);
        process.kill(wrapper.pid, scenario.signal);
        // No explicit stop until the automatic cleanup assertions have completed.
        await until(
          () => owner.exitCode !== null || owner.signalCode !== null,
          `未自动清理：${output}`,
        );
        assert.equal((await ownerClosed).code, 1);
        assert.match(output, /开发子进程退出，正在回收整组服务/);
        assert.match(output, /TERM-api/);
        assert.match(output, /TERM-web/);
        await until(
          () =>
            [...state.processes.map((p) => p.pid), ...descendantPids].every(
              (pid) => !alive(pid),
            ),
          "包装进程或后代仍然存活",
        );
        await assertPortFree(apiPort);
        await assertPortFree(webPort);
        assert.deepEqual(await isolated.controlServices("status", "dev"), []);
        await assert.rejects(access(state.socket), { code: "ENOENT" });
        assert.equal(
          await readFile(join(data, "existing-record"), "utf8"),
          sentinel,
        );
      } finally {
        // Failure cleanup is restricted to this test's independent registry/groups.
        await isolated?.controlServices("stop", "dev").catch(() => {});
        if (owner && owner.exitCode === null && owner.signalCode === null)
          owner.kill("SIGTERM");
        if (state)
          for (const child of state.processes) {
            killGroup(child.pid);
          }
        await ownerClosed;
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
