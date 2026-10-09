import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";

export function fail(code, message, data) {
  throw Object.assign(new Error(message), { code, ...(data ? { data } : {}) });
}
export const digest = (raw) => createHash("sha256").update(raw).digest("hex");
export function uuid(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value || "",
    )
  )
    fail("INVALID_ARGUMENT", "需要 V1 UUID");
  return value;
}
export function stableId(key) {
  const raw = Buffer.from(digest(key).slice(0, 32), "hex");
  raw[6] = (raw[6] & 15) | 64;
  raw[8] = (raw[8] & 63) | 128;
  const h = raw.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail("INVALID_ARGUMENT", "无法读取业务仓库 Git 身份；先确认仓库及 HEAD");
  }
}
export function workspace(repo) {
  const root = realpathSync(git(resolve(repo), "rev-parse", "--show-toplevel"));
  const common = realpathSync(
    git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
  );
  const first = git(root, "worktree", "list", "--porcelain", "-z")
    .split("\0")
    .find((part) => part.startsWith("worktree "));
  const identityRoot = first ? realpathSync(first.slice(9)) : root;
  return { root, common, identityRoot, key: digest(common) };
}
export function origin(value = "http://127.0.0.1:8765") {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("INVALID_ARGUMENT", "服务地址无效");
  }
  if (
    u.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    fail("INVALID_ARGUMENT", "服务地址必须是本机 HTTP origin");
  return u.origin;
}
export function outside(file, root) {
  const rel = relative(root, resolve(file));
  if (
    rel === "" ||
    (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  )
    fail("INVALID_ARGUMENT", "配置、token 和运行产物必须在业务仓库外");
}
export function restrictedFile(file) {
  if (!isAbsolute(file)) fail("INVALID_ARGUMENT", "文件路径必须是绝对路径");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    fail("INVALID_ARGUMENT", "秘密或关联配置必须是普通文件，权限 600 或更严格");
  return stat;
}
export function token(file) {
  if (restrictedFile(file).size > 16384)
    fail("INVALID_ARGUMENT", "token 文件过大");
  const value = readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  if (!/^acp_[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/.test(value))
    fail("AUTH_REQUIRED", "token 文件内容无效，请在 Web 创建项目 token");
  return value;
}
export function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink())
    fail("INVALID_ARGUMENT", "配置目录不能是符号链接");
  chmodSync(dir, 0o700);
}
export function save(file, value) {
  privateDir(dirname(file));
  if (existsSync(file) && lstatSync(file).isSymbolicLink())
    fail("INVALID_ARGUMENT", "配置文件不能是符号链接");
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temp, file);
}
export function configPath(w, options) {
  const dir = resolve(
    options["config-dir"] ||
      join(homedir(), ".config", "acceptances", "projects"),
  );
  outside(dir, w.root);
  return join(dir, `${w.key}.json`);
}
export function load(w, options) {
  const file = configPath(w, options);
  if (!existsSync(file)) return null;
  restrictedFile(file);
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (config.schemaVersion !== 1 || config.gitCommonDir !== w.common)
    fail("INVALID_ARGUMENT", "关联配置身份不匹配");
  uuid(config.projectId);
  origin(config.url);
  outside(config.tokenFile, w.root);
  outside(config.dataDir, w.root);
  return config;
}
export async function locked(file, fn) {
  privateDir(dirname(file));
  let fd;
  try {
    fd = openSync(`${file}.lock`, "wx", 0o600);
  } catch {
    fail(
      "LOCAL_CONFLICT",
      "同一仓库已有接入操作；若上次崩溃，确认无运行操作后移除对应 .lock 文件",
    );
  }
  try {
    return await fn();
  } finally {
    closeSync(fd);
    unlinkSync(`${file}.lock`);
  }
}
export function cli(config, args) {
  const env = {
    ...process.env,
    ACCEPTANCES_URL: config.url,
    ACCEPTANCES_TOKEN_FILE: config.tokenFile,
  };
  delete env.ACCEPTANCES_TOKEN;
  const result = spawnSync(config.cli, [...args, "--json"], {
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180000,
  });
  if (result.error || result.signal)
    fail(
      "CLI_UNAVAILABLE",
      "V1 CLI 不可用或超时；发布操作先查持久状态，不生成新 Run",
    );
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    fail("CLI_UNAVAILABLE", "CLI 未返回 V1 JSON；请构建当前版本");
  }
  if (result.status !== 0)
    throw Object.assign(new Error(data.error?.message || "CLI 操作失败"), {
      code: data.error?.code || "CLI_FAILED",
      data,
    });
  return data;
}
