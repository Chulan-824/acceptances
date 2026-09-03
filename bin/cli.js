#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

import {
  CATALOG_PATH,
  listRoots,
  register,
  unregister,
} from "../server/catalog.js";
import { listen } from "../server/http.js";

function help() {
  return `acceptances — 本地验收主页（127.0.0.1，不上传）

Usage:
  acceptances register [path]     登记该仓 .acceptances（默认 cwd）
  acceptances unregister [path]   从清单拿掉（不删磁盘上的 round）
  acceptances list                打印清单（含打不开的路径）
  acceptances serve [--port N] [--open]
                                  只绑 127.0.0.1；默认 8765；禁止 8005

Catalog: ${CATALOG_PATH}
`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || "help";
  const flags = {};
  const positional = [];
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port") {
      flags.port = Number(args[index + 1]);
      index += 1;
    } else if (argument === "--open") {
      flags.open = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown flag: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  return { command, flags, positional };
}

async function main() {
  const { command, flags, positional } = parseArgs(process.argv);
  if (["help", "-h", "--help"].includes(command)) {
    process.stdout.write(help());
    return;
  }
  if (command === "register") {
    const { root, created } = register(positional[0] || process.cwd());
    process.stdout.write(`${created ? "registered" : "updated"} ${root}\n`);
    return;
  }
  if (command === "unregister") {
    const { root } = unregister(positional[0] || process.cwd());
    process.stdout.write(`removed ${root}\n`);
    return;
  }
  if (command === "list") {
    const roots = listRoots();
    process.stdout.write(
      roots.length
        ? `${roots.map((entry) => `${entry.alive ? "ok  " : "DEAD"}  ${entry.root}`).join("\n")}\n`
        : "(empty)\n",
    );
    return;
  }
  if (command === "serve") {
    const { url } = await listen({ port: flags.port ?? 8765 });
    process.stdout.write(`listening ${url}\n`);
    if (flags.open) {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    }
    return;
  }
  throw new Error(`unknown command: ${command}\n${help()}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
