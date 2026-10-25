import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { glob, lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function sourceIdentity(root = process.cwd()) {
  root = await realpath(root);
  const identity = { commit: "unknown", dirty: null, sourceDigest: "unknown" };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    if (resolve(git("rev-parse", "--show-toplevel")) === resolve(root)) {
      identity.commit = git("rev-parse", "HEAD");
      identity.dirty = Boolean(git("status", "--porcelain=v1"));
    }
  } catch {
    /* Source archives have no Git metadata. */
  }
  try {
    await lstat(join(root, "go.mod"));
    const files = [];
    for await (const name of glob(
      [
        "go.mod",
        "go.sum",
        "cmd/**",
        "internal/**",
        "db/**",
        "apps/web/*.go",
        "apps/web/src/theme.css",
        "apps/web/public/fonts/geist/*",
      ],
      {
        cwd: root,
        exclude: (name) =>
          name.endsWith("_test.go") ||
          name
            .split(/[\\/]/)
            .some(
              (part) =>
                part.startsWith(".env") ||
                [".git", ".cache", "node_modules"].includes(part),
            ),
      },
    )) {
      const info = await lstat(join(root, name));
      if (info.isSymbolicLink()) throw new Error("源码摘要不跟随符号链接");
      if (info.isFile()) files.push(name);
    }
    const digest = createHash("sha256");
    for (const name of files.sort()) {
      const bytes = await readFile(join(root, name));
      digest.update(`${name}\0${bytes.length}\0`).update(bytes);
    }
    identity.sourceDigest = digest.digest("hex");
  } catch {
    /* An unreadable or incomplete source tree must stay unknown. */
  }
  return identity;
}

export function buildFlags(identity) {
  if (
    !/^(?:[a-f0-9]{40}|unknown)$/.test(identity.commit) ||
    !/^(?:[a-f0-9]{64}|unknown)$/.test(identity.sourceDigest) ||
    ![true, false, null].includes(identity.dirty)
  )
    throw new Error("无效构建身份");
  const prefix = "github.com/Chulan-824/acceptances/internal/buildinfo";
  return `-X ${prefix}.Commit=${identity.commit} -X ${prefix}.Dirty=${identity.dirty ?? "unknown"} -X ${prefix}.SourceDigest=${identity.sourceDigest}`;
}

export function compareIdentity(running, current) {
  if (
    !running ||
    !current ||
    [running, current].some(
      (value) =>
        !/^[a-f0-9]{40}$/.test(value.commit) ||
        typeof value.dirty !== "boolean" ||
        !/^[a-f0-9]{64}$/.test(value.sourceDigest),
    )
  )
    return "unknown";
  return ["commit", "dirty", "sourceDigest"].every(
    (key) => running[key] === current[key],
  )
    ? "matches"
    : "differs";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const identity = await sourceIdentity();
  if (identity.commit === "unknown" && process.env.ACCEPTANCES_BUILD_COMMIT) {
    identity.commit = process.env.ACCEPTANCES_BUILD_COMMIT;
    identity.dirty =
      process.env.ACCEPTANCES_BUILD_DIRTY === "true"
        ? true
        : process.env.ACCEPTANCES_BUILD_DIRTY === "false"
          ? false
          : null;
  }
  console.log(buildFlags(identity));
}
