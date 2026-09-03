import { spawn } from "node:child_process";

const children = [
  spawn("node", ["bin/cli.js", "serve", "--port", "8767"], {
    stdio: "inherit",
  }),
  spawn("bunx", ["vite"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) stop(signal ? 1 : (code ?? 0));
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
