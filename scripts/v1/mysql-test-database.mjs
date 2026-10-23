import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./services.mjs";

// Only databases created by this invocation can be dropped by its cleanup.
// The daily database/DSN is never used as the browser's archive.
export async function createMySQLTestDatabase() {
  const name = `acceptances_test_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(join(tmpdir(), "acceptances-mysql-test-"));
  let created = false;
  const sql = (input) =>
    execFileSync(
      "docker",
      [
        "compose",
        "-p",
        "acceptances-dev",
        "-f",
        join(root, "deploy/compose.mysql.yaml"),
        "-f",
        join(root, "deploy/compose.mysql.dev.yaml"),
        "exec",
        "-T",
        "mysql",
        "sh",
        "-c",
        'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" exec mysql -u root',
      ],
      { input, stdio: ["pipe", "pipe", "pipe"] },
    );
  async function close() {
    try {
      if (created) {
        sql(`DROP DATABASE ${name};\n`);
        created = false;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  try {
    sql(
      `CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;\n`,
    );
    created = true;
    const base = await readFile(join(root, ".cache/mysql/dev.dsn"), "utf8");
    const suffix = "/acceptances_dev?";
    if (!base.includes(suffix)) throw new Error("开发 MySQL 配置格式不匹配");
    const file = join(temporary, "connection.dsn");
    await writeFile(file, base.replace(suffix, `/${name}?`), { mode: 0o600 });
    return {
      name,
      environment: {
        ACCEPTANCES_DB_DRIVER: "mysql",
        ACCEPTANCES_MYSQL_DSN_FILE: file,
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
