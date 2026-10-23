import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access, chmod } from "node:fs/promises";
import { join } from "node:path";
import { root, controlServices } from "./services.mjs";

process.chdir(root);
const directory = join(root, ".cache/mysql");
const compose = [
  "compose",
  "-p",
  "acceptances-dev",
  "-f",
  "deploy/compose.mysql.yaml",
  "-f",
  "deploy/compose.mysql.dev.yaml",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function credentials() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const passwordPath = join(directory, "password");
  const rootPath = join(directory, "root-password");
  const present = await Promise.all([exists(passwordPath), exists(rootPath)]);
  if (present[0] !== present[1])
    throw new Error("MySQL 凭据文件不完整，请恢复原文件，不要重置数据库卷");
  if (!present[0]) {
    let volumes;
    try {
      volumes = execFileSync(
        "docker",
        ["volume", "ls", "--format", "{{.Name}}"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).split("\n");
    } catch {
      throw new Error("无法核对已有数据库卷，请先启动 Docker");
    }
    if (
      volumes.some((name) =>
        ["acceptances-dev_mysql-data", "acceptances_mysql-data"].includes(name),
      )
    )
      throw new Error(
        "已有 MySQL 数据卷但凭据丢失，请恢复原凭据，不要重新生成",
      );
    await writeFile(passwordPath, randomBytes(32).toString("hex"), {
      mode: 0o644,
      flag: "wx",
    });
    await writeFile(rootPath, randomBytes(32).toString("hex"), {
      mode: 0o644,
      flag: "wx",
    });
  }
  const password = (await readFile(passwordPath, "utf8")).trim();
  // The directory is private. Docker's non-root app needs a readable secret
  // file because local Compose bind secrets do not remap uid/gid/mode.
  for (const [name, host, database, mode] of [
    ["dev.dsn", "127.0.0.1:3307", "acceptances_dev", 0o600],
    ["docker.dsn", "mysql:3306", "acceptances", 0o644],
  ]) {
    await writeFile(
      join(directory, name),
      `acceptances:${password}@tcp(${host})/${database}?charset=utf8mb4&parseTime=true&loc=UTC`,
      { mode },
    );
    await chmod(join(directory, name), mode);
  }
}

function docker(args, options = {}) {
  return execFileSync("docker", [...compose, ...args], {
    stdio: "inherit",
    ...options,
  });
}

const command = process.argv[2] || "up";
try {
  if (command === "prepare") {
    await credentials();
    console.log("MySQL 凭据已准备，保存在私有 .cache/mysql 目录");
  } else if (command === "up") {
    await credentials();
    docker(["up", "-d", "--wait", "--wait-timeout", "180"]);
    // Isolated tests may create/drop only databases in this test namespace.
    // Root credentials stay inside the container and never enter shell argv.
    docker(
      [
        "exec",
        "-T",
        "mysql",
        "sh",
        "-c",
        'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root',
      ],
      {
        input:
          "GRANT ALL PRIVILEGES ON `acceptances_test_%`.* TO 'acceptances'@'%';\n",
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
    console.log("MySQL 已就绪：127.0.0.1:3307 / acceptances_dev");
  } else if (command === "migrate") {
    if ((await controlServices("status", "dev")).length)
      throw new Error(
        "迁移前请先运行 make dev-stop，确认没有其他服务写入该目录",
      );
    execFileSync(
      "go",
      [
        "run",
        "./cmd/server",
        "--database=mysql",
        "--mysql-dsn-file",
        join(directory, "dev.dsn"),
        "--data-dir",
        process.env.ACCEPTANCES_DATA_DIR || ".cache/dev-data",
        "--migrate-sqlite",
      ],
      { stdio: "inherit" },
    );
  } else if (command === "status") {
    docker(["ps"]);
  } else if (command === "stop") {
    docker(["stop", "mysql"]);
  } else {
    throw new Error("可用 prepare|up|migrate|status|stop");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
