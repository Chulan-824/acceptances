import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function selectExtraChecks(paths) {
  const shared = paths.some((path) =>
    /^(?:\.github\/|\.githooks\/|Makefile$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|toolchain\.lock\.json$|go\.(?:mod|sum)$|scripts\/v1\/(?:check-.*|checks\.test|test|agent-check)\.mjs$)/.test(
      path,
    ),
  );
  const jev =
    shared ||
    paths.some((path) =>
      /^(?:tools\/jev-browser\/|deploy\/.*jev|docs\/agents\/jev-browser\.md$)/.test(
        path,
      ),
    );
  const agent =
    jev ||
    paths.some((path) =>
      /^(?:skills\/Acceptances-Cl\/|internal\/cli\/|cmd\/acceptances\/|scripts\/v1\/(?:install-skill.*|jev-probe\.test)\.py$)/.test(
        path,
      ),
    );
  return { agent, jev };
}

export function changedPaths(base = "", cwd = process.cwd()) {
  if (base === "all" || /^0+$/.test(base)) return ["Makefile"];
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  // No rename detection: both the removed and added paths must select checks.
  let revision;
  if (base) {
    try {
      revision = git(
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${base}^{commit}`,
      ).trim();
    } catch {
      console.warn("比较基线不可用，补跑全部目录检查");
      return ["Makefile"];
    }
  }
  const paths = base
    ? git("diff", "--name-only", "--no-renames", "-z", revision, "HEAD", "--")
    : git("diff", "--name-only", "--no-renames", "-z", "HEAD", "--") +
      git("ls-files", "--others", "--exclude-standard", "-z");
  return paths.split("\0").filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const checks = selectExtraChecks(changedPaths(process.argv[2]));
    if (checks.agent)
      execFileSync("make", ["test", "SUITE=agent"], { stdio: "inherit" });
    if (checks.jev)
      execFileSync("make", ["jev-setup", "jev-check"], { stdio: "inherit" });
    console.log(`目录补检完成：agent=${checks.agent}, jev=${checks.jev}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
