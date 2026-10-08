import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const lock = JSON.parse(
  readFileSync(new URL("../../toolchain.lock.json", import.meta.url), "utf8"),
);
const observed = {
  node: process.versions.node,
  pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  go: execFileSync("go", ["env", "GOVERSION"], { encoding: "utf8" })
    .trim()
    .replace(/^go/, ""),
};
for (const [name, version] of Object.entries(observed)) {
  if (version !== lock.runtimes[name])
    throw new Error(`${name}: 需要 ${lock.runtimes[name]}，实际 ${version}`);
}
