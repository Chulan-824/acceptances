#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  CATALOG_PATH,
  listRoots,
  register,
  unregister,
} from "../server/catalog.js";
import { listen } from "../server/http.js";
import { loadRound } from "../server/acceptances.js";
import { sealRounds } from "../server/receipts.js";
import { validateHistory } from "../server/validation-history.js";

function help() {
  return `acceptances — 本地验收主页（127.0.0.1，不上传）

Usage:
  acceptances register [path]     登记该仓 .acceptances（默认 cwd）
  acceptances unregister [path]   从清单拿掉（不删磁盘上的 round）
  acceptances list                打印清单（含打不开的路径）
  acceptances validate <path> [--json] [--seal]
                                  校验 Round、subject 或 .acceptances
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
    } else if (argument === "--json") {
      flags.json = true;
    } else if (argument === "--seal") {
      flags.seal = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown flag: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  return { command, flags, positional };
}

function roundTarget(directory) {
  const dir = path.resolve(directory);
  const subjectDir = path.dirname(dir);
  const root = path.dirname(subjectDir);
  if (path.basename(root) !== ".acceptances") {
    throw new Error(`round is not under .acceptances/<subject>: ${dir}`);
  }
  return { dir, root, subject: path.basename(subjectDir), round: path.basename(dir) };
}

function childDirectories(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function discoverTargets(input) {
  const absolute = path.resolve(input);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`not a directory: ${absolute}`);
  }
  if (fs.existsSync(path.join(absolute, "result.json"))) return [roundTarget(absolute)];
  const children = childDirectories(absolute);
  const rounds = children.filter((directory) => fs.existsSync(path.join(directory, "result.json")));
  const directories = rounds.length
    ? rounds
    : children.flatMap((subject) => childDirectories(subject).filter((directory) => fs.existsSync(path.join(directory, "result.json"))));
  if (!directories.length) throw new Error(`no rounds found: ${absolute}`);
  return directories.map(roundTarget);
}

function validateCommand(input, flags) {
  if (!input) throw new Error("validate requires an explicit path");
  const targets = discoverTargets(input).map((target) => {
    const record = loadRound(target.root, target.subject, target.round);
    return { ...target, record, validation: record.validation };
  });
  const bySubject = new Map();
  for (const target of targets) {
    const key = `${target.root}\0${target.subject}`;
    const entries = bySubject.get(key) || [];
    entries.push(target);
    bySubject.set(key, entries);
  }
  const historyDiagnostics = [];
  for (const entries of bySubject.values()) {
    const existing = childDirectories(path.dirname(entries[0].dir))
      .filter((directory) => fs.existsSync(path.join(directory, "result.json")))
      .map((directory) => roundTarget(directory))
      .map((target) => ({ ...target, record: loadRound(target.root, target.subject, target.round) }))
      .filter((entry) => entry.record.published && !entries.some((target) => target.round === entry.round))
      .map((entry) => ({ id: entry.round, ...entry.record }));
    let sequence = Math.max(0, ...existing.map((entry) => entry.sequence || 0)) + 1;
    const proposed = entries
      .sort((left, right) => left.round.localeCompare(right.round))
      .map((entry) => ({ id: entry.round, ...entry.record, published: true, sequence: entry.record.sequence || sequence++ }));
    historyDiagnostics.push(...validateHistory([...existing, ...proposed]).diagnostics);
  }
  const diagnostics = [...targets.flatMap((target) => target.validation.diagnostics.map((entry) => ({ ...entry, round: target.round }))), ...historyDiagnostics];
  const outcome = diagnostics.some((entry) => entry.effect === "reject")
    ? "rejected"
    : diagnostics.some((entry) => entry.effect === "hold")
      ? "held"
      : "ready";
  let receipts = [];
  let sealed = false;
  if (flags.seal && outcome !== "rejected") {
    receipts = sealRounds(targets);
    sealed = true;
  }
  const output = {
    outcome,
    sealed,
    ruleset: targets[0].validation.ruleset,
    targets: targets.map((target, index) => ({
      path: target.dir,
      outcome: target.validation.outcome,
      receipt: receipts[index] || target.record.receipt || null,
      diagnostics: target.validation.diagnostics,
    })),
    historyDiagnostics,
  };
  if (flags.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write(`${outcome.toUpperCase()} ${targets.length} round(s)${sealed ? " sealed" : ""}\n`);
    for (const entry of diagnostics) process.stdout.write(`${entry.effect.toUpperCase()} ${entry.code} ${entry.round || "history"} ${entry.path}: ${entry.message}\n`);
  }
  return outcome === "ready" ? 0 : 1;
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
  if (command === "validate") {
    process.exitCode = validateCommand(positional[0], flags);
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
  process.exit(process.argv[2] === "validate" ? 2 : 1);
});
