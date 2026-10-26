import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { changedPaths, selectExtraChecks } from "./check-extra.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "acceptances-checks-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });
  git("init", "--quiet");
  git("config", "core.hooksPath", "/dev/null");
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");
  writeFileSync(join(cwd, ".prettierignore"), "ignored/\n");
  writeFileSync(
    join(cwd, "eslint.config.mjs"),
    'export default [{ rules: { "no-undef": "error" } }];\n',
  );
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
  const write = (path, source) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), source);
  };
  const check = () =>
    spawnSync(process.execPath, [join(root, "scripts/v1/check-staged.mjs")], {
      cwd,
      encoding: "utf8",
    });
  return { cwd, git, write, check };
}

test("hook installation is explicit, repeatable and preserves existing hooks", (t) => {
  const { cwd, git } = fixture(t);
  const install = () =>
    spawnSync("make", ["-f", join(root, "Makefile"), "hooks-install"], {
      cwd,
      encoding: "utf8",
    });
  assert.equal(install().status, 2);
  assert.equal(git("config", "--get", "core.hooksPath").trim(), "/dev/null");
  git("config", "--unset", "core.hooksPath");
  assert.equal(install().status, 0);
  assert.equal(install().status, 0);
  assert.equal(git("config", "--get", "core.hooksPath").trim(), ".githooks");
});

test("staged checks reject bad index content and preserve partial staging", (t) => {
  const { cwd, git, write, check } = fixture(t);
  const path = "scripts/含 空格.mjs";
  write(path, "const x=1;\n");
  git("add", "--", path);
  write(path, "const x = 1;\n");
  const index = git("show", `:${path}`);
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /格式不符/);
  assert.equal(git("show", `:${path}`), index);
  assert.equal(readFileSync(join(cwd, path), "utf8"), "const x = 1;\n");
  git("add", "--", path);
  write(path, "const x=2;\n");
  assert.equal(check().status, 0);
  write(path, "missing();\n");
  git("add", "--", path);
  assert.match(check().stderr, /no-undef/);
  assert.equal(check().status, 1);
});

test("Go format, whitespace errors, ignored files and staged deletion", (t) => {
  const { git, write, check } = fixture(t);
  write("internal/example.go", "package example\nfunc Foo(){}\n");
  git("add", ".");
  assert.match(check().stderr, /gofmt 不符/);
  write("internal/example.go", "package example\n\nfunc Foo() {}\n");
  write("ignored/raw.json", "{bad json");
  git("add", ".");
  assert.equal(check().status, 0);
  write("notes.txt", "trailing space \n");
  git("add", ".");
  assert.equal(check().status, 1);
  git("rm", "--cached", "notes.txt");
  git("rm", "--cached", "internal/example.go");
  assert.equal(check().status, 0);
  git("rm", "eslint.config.mjs");
  // Empty/deletion-only commits must not require a formatter or ESLint config.
  git("reset", "--quiet", "HEAD", "--", ".");
  git("rm", "--force", "eslint.config.mjs");
  assert.equal(check().status, 0);
});

test("directory checks cover skill, CLI, Jev and shared gate changes", () => {
  for (const path of [
    "skills/Acceptances-Cl/SKILL.md",
    "scripts/v1/install-skill.py",
    "internal/cli/run.go",
    "cmd/acceptances/main.go",
    "scripts/v1/jev-probe.test.py",
  ]) {
    assert.deepEqual(
      selectExtraChecks([path]),
      { agent: true, jev: false },
      path,
    );
  }
  for (const path of [
    "tools/jev-browser/launch.py",
    "tools/jev-browser/uv.lock",
    "deploy/compose.jev.yaml",
    "docs/agents/jev-browser.md",
    "Makefile",
    "scripts/v1/checks.test.mjs",
    ".github/workflows/check.yml",
  ]) {
    assert.deepEqual(
      selectExtraChecks([path]),
      { agent: true, jev: true },
      path,
    );
  }
  assert.deepEqual(selectExtraChecks(["apps/web/src/Home.tsx", "README.md"]), {
    agent: false,
    jev: false,
  });
});

test("directory detection includes unstaged, untracked, removed and renamed paths", (t) => {
  const { cwd, git, write } = fixture(t);
  write("skills/Acceptances-Cl/SKILL.md", "skill\n");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "skill");
  const base = git("rev-parse", "HEAD").trim();
  git("mv", "skills/Acceptances-Cl/SKILL.md", "moved.md");
  write("tools/jev-browser/new file.py", "# fixture\n");
  const dirty = changedPaths("", cwd);
  assert.ok(dirty.includes("skills/Acceptances-Cl/SKILL.md"));
  assert.ok(dirty.includes("moved.md"));
  assert.ok(dirty.includes("tools/jev-browser/new file.py"));
  assert.deepEqual(selectExtraChecks(dirty), { agent: true, jev: true });
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "move");
  assert.ok(changedPaths(base, cwd).includes("skills/Acceptances-Cl/SKILL.md"));
  assert.deepEqual(selectExtraChecks(changedPaths("all", cwd)), {
    agent: true,
    jev: true,
  });
  assert.deepEqual(selectExtraChecks(changedPaths("0".repeat(40), cwd)), {
    agent: true,
    jev: true,
  });
  assert.deepEqual(selectExtraChecks(changedPaths("missing-base", cwd)), {
    agent: true,
    jev: true,
  });
});
