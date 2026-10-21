import { spawn } from "node:child_process";
import { open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  root,
  createSession,
  assertPortFree,
  waitReady,
  controlServices,
} from "./services.mjs";

process.chdir(root);
const command = process.argv[2] || "start";
try {
  if (command === "status" || command === "stop") {
    console.log(JSON.stringify(await controlServices(command, "dev"), null, 2));
  } else if (command === "up") {
    await background();
  } else if (command === "start" || command === "--worker") {
    await foreground();
  } else throw new Error("可用 start|up|status|stop");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${name} 必须是 1–65535 的整数`);
  return value;
}

async function foreground() {
  const apiPort = port("ACCEPTANCES_DEV_API_PORT", 8765);
  const webPort = port("ACCEPTANCES_DEV_WEB_PORT", 5173);
  if (apiPort === webPort) throw new Error("API 与 Web 端口不能相同");
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const session = await createSession("dev");
  try {
    // Preflight both ports before starting either child; strictPort still handles races.
    await assertPortFree(apiPort);
    await assertPortFree(webPort);
    const api = session.start(
      "api",
      "go",
      ["run", "./cmd/server", "--listen", `127.0.0.1:${apiPort}`, "--web-dir="],
      {
        echo: true,
        logPath: join(root, ".cache/services/api.log"),
        env: {
          ...process.env,
          ACCEPTANCES_DATA_DIR:
            process.env.ACCEPTANCES_DATA_DIR || ".cache/dev-data",
          ACCEPTANCES_PUBLIC_ORIGIN: webBase,
        },
      },
    );
    await waitReady(api, apiBase, 120000);
    const web = session.start(
      "web",
      "pnpm",
      [
        "--filter",
        "@acceptances/web",
        "dev",
        "--port",
        String(webPort),
        "--strictPort",
      ],
      {
        echo: true,
        logPath: join(root, ".cache/services/web.log"),
      },
    );
    await Promise.race([
      waitReady(web, webBase),
      api.exited.then(() => {
        throw new Error("开发子进程退出，正在回收整组服务");
      }),
    ]);
    api.assertRunning();
    session.ready();
    console.log(`开发服务就绪：Web ${webBase} · API ${apiBase}`);
    await Promise.race([api.exited, web.exited]);
    if (
      session.info().state !== "stopping" &&
      session.info().state !== "stopped"
    )
      throw new Error("开发子进程退出，正在回收整组服务");
  } finally {
    await session.close();
    const names = session.info().processes.map((p) => p.name);
    if (names.includes("api")) await assertPortFree(apiPort);
    if (names.includes("web")) await assertPortFree(webPort);
  }
}

async function background() {
  const current = await controlServices("status", "dev");
  if (current.length)
    throw new Error("已有开发服务记录；先运行 make dev-status / make dev-stop");
  await mkdir(join(root, ".cache/services"), { recursive: true });
  const logPath = join(root, ".cache/services/dev.log");
  const log = await open(logPath, "w");
  let child;
  try {
    child = spawn(
      process.execPath,
      [join(root, "scripts/v1/dev.mjs"), "--worker"],
      { cwd: root, detached: true, stdio: ["ignore", log.fd, log.fd] },
    );
  } finally {
    await log.close();
  }
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise((done) => child.once("close", done));
  const onSignal = () => child.kill("SIGTERM");
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const deadline = Date.now() + 160000;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`开发服务启动失败；日志：${logPath}`);
      const services = await controlServices("status", "dev");
      if (services[0]?.pid === child.pid && services[0].state === "ready") {
        child.unref();
        console.log(`开发服务已启动（PID ${child.pid}）；日志：${logPath}`);
        return;
      }
      await delay(200);
    }
    throw new Error(`开发服务启动超时；日志：${logPath}`);
  } catch (error) {
    // This handle is the worker just spawned here, never a PID recovered from disk.
    child.kill("SIGTERM");
    await closed;
    throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
