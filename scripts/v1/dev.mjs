import { spawn } from "node:child_process";
const children = [
  spawn(
    "go",
    ["run", "./cmd/server", "--listen", "127.0.0.1:8765", "--web-dir="],
    {
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        ACCEPTANCES_DATA_DIR:
          process.env.ACCEPTANCES_DATA_DIR || ".cache/dev-data",
        ACCEPTANCES_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      },
    },
  ),
  spawn("pnpm", ["--filter", "@acceptances/web", "dev"], {
    stdio: "inherit",
    detached: true,
  }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") console.error(error.message);
      }
    }
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* 进程已结束。 */
        }
      }
    }
  }, 6000);
  timer.unref();
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
