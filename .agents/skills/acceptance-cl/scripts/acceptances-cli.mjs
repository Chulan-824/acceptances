#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const explicitCli = process.env.ACCEPTANCES_CLI?.trim();
const repositoryCli = fileURLToPath(
  new URL("../../../../bin/cli.js", import.meta.url),
);

function runNodeCli(file) {
  const result = spawnSync(process.execPath, [file, ...args], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runPathCli() {
  const command = process.platform === "win32" ? "acceptances.cmd" : "acceptances";
  return spawnSync(command, args, { stdio: "inherit" });
}

if (explicitCli) {
  const file = path.resolve(explicitCli);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    process.stderr.write(`ACCEPTANCES_CLI is not a file: ${file}\n`);
    process.exitCode = 2;
  } else {
    process.exitCode = runNodeCli(file);
  }
} else if (fs.existsSync(repositoryCli)) {
  process.exitCode = runNodeCli(repositoryCli);
} else {
  const result = runPathCli();
  if (result.error?.code === "ENOENT") {
    process.stderr.write(
      "Acceptances CLI was not found. Install the `acceptances` command or set ACCEPTANCES_CLI to bin/cli.js.\n",
    );
    process.exitCode = 2;
  } else if (result.error) {
    throw result.error;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
