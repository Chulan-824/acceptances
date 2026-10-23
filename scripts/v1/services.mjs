import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  mkdtemp,
  chmod,
} from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const registry = join(root, ".cache/services");

export async function requestService(record, action = "status") {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(record.socket);
    let response = "";
    socket.setTimeout(15000, () =>
      socket.destroy(new Error("服务控制接口超时")),
    );
    socket.on("error", reject);
    socket.on("connect", () =>
      socket.end(JSON.stringify({ token: record.token, action })),
    );
    socket.on("data", (chunk) => (response += chunk));
    socket.on("end", () => {
      try {
        const result = JSON.parse(response);
        if (result.error) throw new Error(result.error);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function serviceRecords() {
  await mkdir(registry, { recursive: true });
  const entries = await Promise.all(
    (await readdir(registry))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const path = join(registry, name);
        try {
          return { path, record: await readRecord(path) };
        } catch (error) {
          if (error.code === "ENOENT") return null;
          return { path, error: error.message };
        }
      }),
  );
  return entries.filter(Boolean);
}

async function readRecord(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      // Another process may observe the exclusive reservation before its write finishes.
      if (!(error instanceof SyntaxError) || attempt >= 10) throw error;
      await delay(20);
    }
  }
}

// A session owns the child handles. Remote stop talks to this owner, never kills a PID from disk.
export async function createSession(
  kind,
  { signals = true, cleanup = async () => {}, onStop = () => {} } = {},
) {
  await mkdir(registry, { recursive: true });
  const token = randomUUID();
  const path = join(
    registry,
    kind === "dev" ? "dev.json" : `${kind}-${token}.json`,
  );
  const socketPath = join(tmpdir(), `acc-${token}.sock`);
  const record = {
    kind,
    token,
    socket: socketPath,
    pid: process.pid,
    cwd: root,
    startedAt: new Date().toISOString(),
  };
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "已有开发服务记录；先运行 make dev-status，或 make dev-stop 清理失效记录",
        { cause: error },
      );
    throw error;
  }
  const processes = [];
  let state = "starting",
    closing;
  const { token: controlToken, ...publicRecord } = record;
  const info = () => ({
    ...publicRecord,
    state,
    processes: processes.map((p) => ({
      name: p.name,
      pid: p.child.pid,
      exitCode: p.child.exitCode,
      signal: p.child.signalCode,
      url: p.url,
      log: p.logPath,
    })),
  });
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let input = "";
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      input += chunk;
      if (input.length > 4096) socket.destroy();
    });
    socket.on("end", async () => {
      try {
        const request = JSON.parse(input);
        if (request.token !== controlToken) throw new Error("服务身份不匹配");
        if (request.action === "stop") {
          onStop();
          socket.setTimeout(0);
          await close();
        } else if (request.action !== "status") throw new Error("未知控制操作");
        socket.end(JSON.stringify(info()));
      } catch (error) {
        socket.end(JSON.stringify({ error: error.message }));
      }
    });
  });
  async function close() {
    if (closing) return closing;
    state = "stopping";
    closing = (async () => {
      try {
        await Promise.all(processes.map((p) => p.stop()));
        await cleanup();
      } finally {
        state = "stopped";
        for (const signal of ["SIGINT", "SIGTERM"])
          process.off(signal, onSignal);
        server.close();
        await rm(socketPath, { force: true });
        await rm(path, { force: true });
      }
    })();
    return closing;
  }
  function onSignal(signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  try {
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(socketPath, done);
    });
    await chmod(socketPath, 0o600);
    await file.writeFile(JSON.stringify(record));
  } catch (error) {
    await close();
    throw error;
  } finally {
    await file.close();
  }
  if (signals)
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, onSignal);
  return {
    start(...args) {
      if (closing) throw new Error("服务正在退出");
      const p = managedProcess(...args);
      processes.push(p);
      return p;
    },
    ready() {
      if (!closing) state = "ready";
    },
    close,
    info,
  };
}

export function managedProcess(
  name,
  command,
  args,
  { env = process.env, logPath, echo = false } = {},
) {
  const log = logPath ? createWriteStream(logPath) : undefined;
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    spawnError,
    stopping;
  child.on("error", (error) => {
    spawnError = error;
  });
  log?.on("error", (error) => {
    spawnError = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-32768);
      log?.write(chunk);
      if (echo) process.stdout.write(chunk);
    });
  // A descendant may inherit stdout/stderr and keep `close` pending after its
  // wrapper exits. Observe process termination independently of pipe draining.
  const exited = new Promise((done) => {
    child.once("exit", (code, signal) => done({ code, signal }));
    child.once("error", (error) => done({ code: null, signal: null, error }));
  });
  const closed = new Promise((done) =>
    child.once("close", (code, signal) => done({ code, signal })),
  );
  function signalGroup(signal) {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return false;
    }
  }
  function groupAlive() {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return false;
    }
  }
  const service = {
    name,
    child,
    exited,
    closed,
    logPath,
    get output() {
      return output;
    },
    assertRunning() {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`${name} 提前退出：${output}`);
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        signalGroup("SIGTERM");
        const deadline = Date.now() + 6000;
        while (groupAlive() && Date.now() < deadline) await delay(50);
        if (groupAlive()) signalGroup("SIGKILL");
        const exit = await closed;
        if (log) await new Promise((done) => log.end(done));
        return exit;
      })();
      return stopping;
    },
  };
  return service;
}

export async function waitReady(service, base, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    service.assertRunning();
    try {
      const response = await fetch(`${base}/health/ready`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) {
        service.url = base;
        return;
      }
    } catch {
      /* Retry while the owned process is starting. */
    }
    await delay(100);
  }
  throw new Error(`${service.name} 就绪超时：${service.output}`);
}

export async function assertPortFree(port) {
  const server = net.createServer();
  try {
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
  } catch (error) {
    throw new Error(
      `127.0.0.1:${port} 不可用（${error.code}）；请先核对占用方，本工具不会终止未知进程`,
      { cause: error },
    );
  } finally {
    if (server.listening) await new Promise((done) => server.close(done));
  }
}

export async function startIsolatedServer({
  kind,
  binary,
  web,
  directoryPrefix,
  logPath,
  signals = true,
  onStop = () => {},
  environment = {},
}) {
  const directory = await mkdtemp(
    directoryPrefix || join(tmpdir(), "acceptances-check-"),
  );
  const data = join(directory, "data");
  let session,
    service,
    externallyStopped = false;
  try {
    session = await createSession(kind, {
      signals,
      onStop() {
        externallyStopped = true;
        onStop();
      },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    });
    service = session.start(
      "server",
      binary,
      ["--listen", "127.0.0.1:0", "--data-dir", data, "--web-dir", web],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("ACCEPTANCES_"),
            ),
          ),
          ...environment,
        },
        logPath,
      },
    );
    const deadline = Date.now() + 15000;
    let address;
    while (
      !(address = service.output.match(/address=(127\.0\.0\.1:\d+)/)?.[1])
    ) {
      service.assertRunning();
      if (Date.now() >= deadline)
        throw new Error(`服务启动超时：${service.output}`);
      await delay(100);
    }
    const base = `http://${address}`;
    if (["5173", "8765"].includes(new URL(base).port))
      throw new Error("验证服务不得占用开发端口");
    await waitReady(service, base);
    session.ready();
    return {
      base,
      data,
      async stop() {
        await session.close();
        await assertPortFree(Number(new URL(base).port));
        if (externallyStopped)
          throw new Error("验证服务已由 services-stop 中断");
        return service.closed;
      },
    };
  } catch (error) {
    if (session) await session.close();
    else await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function controlServices(action, kind) {
  if (!["status", "stop"].includes(action))
    throw new Error("只支持 status 或 stop");
  const results = [];
  for (const entry of await serviceRecords()) {
    if (entry.error)
      throw new Error(`无法解析服务记录 ${entry.path}: ${entry.error}`);
    if (kind && entry.record.kind !== kind) continue;
    try {
      results.push(await requestService(entry.record, action));
    } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
      const publicRecord = { ...entry.record };
      delete publicRecord.token;
      results.push({
        ...publicRecord,
        state: "stale",
        note: "所有者已离线；不会按记录 PID 杀进程，请核对端口占用",
      });
      if (action === "stop") {
        await rm(entry.record.socket, { force: true });
        const current = await readRecord(entry.path).catch(() => null);
        if (current?.token === entry.record.token)
          await rm(entry.path, { force: true });
      }
    }
  }
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(
        await controlServices(process.argv[2], process.argv[3]),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
