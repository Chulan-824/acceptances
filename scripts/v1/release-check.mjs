import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checkWeb } from "./web-smoke.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

export async function snapshot(root, destination) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const digest = createHash("sha256");
  const copied = [];
  for (const name of [...new Set(files)].sort()) {
    if (name.split("/").some((part) => part.startsWith(".env"))) continue;
    const source = join(root, name);
    let info;
    try {
      info = await lstat(source);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    assert.ok(
      info.isFile() && !info.isSymbolicLink(),
      `发布源码只接受常规文件: ${name}`,
    );
    const target = join(destination, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    const bytes = await readFile(target);
    digest.update(name + "\0" + info.mode.toString(8) + "\0").update(bytes);
    copied.push(name);
  }
  return { sha256: digest.digest("hex"), files: copied };
}

export function isolateConfig(input, project, source, privateDirectory) {
  assert.match(project, /^acceptances-release-[a-f0-9-]+$/);
  const config = structuredClone(input);
  assert.deepEqual(Object.keys(config.services).sort(), ["app", "mysql"]);
  assert.deepEqual(Object.keys(config.volumes).sort(), [
    "app-data",
    "mysql-data",
  ]);
  assert.deepEqual(Object.keys(config.secrets).sort(), [
    "mysql_dsn",
    "mysql_password",
    "mysql_root_password",
  ]);
  assert.deepEqual(Object.keys(config.networks), ["default"]);
  assert.ok(!config.configs, "发布烟测不加载额外宿主机配置");
  assert.equal(
    resolve(config.services.app.build.context),
    source,
    "构建上下文必须是干净源码副本",
  );
  for (const [name, service] of Object.entries(config.services)) {
    assert.ok(
      !service.env_file &&
        !service.container_name &&
        !service.network_mode &&
        !service.volumes_from,
      `${name}: 不能复用宿主机配置或命名资源`,
    );
    assert.deepEqual(Object.keys(service.networks), ["default"]);
    assert.equal(service.volumes.length, 1);
    const volume = service.volumes[0];
    assert.equal(volume.type, "volume", `${name}: 不允许绑定宿主机数据`);
    assert.equal(volume.source, name === "app" ? "app-data" : "mysql-data");
    assert.equal(
      volume.target,
      name === "app" ? "/var/lib/acceptances" : "/var/lib/mysql",
    );
  }
  assert.equal(
    config.services.app.environment.ACCEPTANCES_MYSQL_DSN_FILE,
    "/run/secrets/mysql_dsn",
  );
  assert.equal(config.services.mysql.environment.MYSQL_DATABASE, "acceptances");
  config.name = project;
  config.services.app.image = `${project}:check`;
  config.services.app.ports = [
    { target: 8765, published: "0", host_ip: "127.0.0.1", protocol: "tcp" },
  ];
  delete config.services.mysql.ports;
  for (const name of Object.keys(config.volumes))
    config.volumes[name] = { name: `${project}_${name}` };
  config.networks.default = { name: `${project}_default` };
  for (const name of Object.keys(config.secrets))
    config.secrets[name] = { file: join(privateDirectory, name) };
  return config;
}

export async function releaseCheck(root = process.cwd()) {
  const project = `acceptances-release-${randomUUID()}`;
  const artifact = join(root, "artifacts/release-check", project);
  await mkdir(artifact, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(tmpdir(), "acceptances-release-"));
  const source = join(artifact, "source");
  const configPath = join(workspace, "compose.json");
  const env = { ...process.env, COMPOSE_DISABLE_ENV_FILE: "1" };
  const compose = [
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    project,
    "-f",
    configPath,
  ];
  const report = {
    project,
    startedAt: new Date().toISOString(),
    outcome: "failed",
    artifact,
    environmentClass: "isolated-docker",
    cleanup: false,
  };
  let configured = false;
  let interrupted = false;
  let cleaning = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const command = (executable, args, options = {}) => {
    assert.ok(cleaning || !interrupted, "发布检查已中断");
    return execFileSync(executable, args, {
      cwd: source,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 240000,
      ...options,
    });
  };
  const docker = (args, options) =>
    command("docker", [...compose, ...args], options);
  const logged = async (executable, args, name, options) => {
    const handle = await open(join(artifact, name), "w", 0o600);
    try {
      return command(executable, args, {
        stdio: ["ignore", handle.fd, handle.fd],
        ...options,
      });
    } finally {
      await handle.close();
    }
  };
  try {
    report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    report.dirty = Boolean(
      execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    report.snapshot = await snapshot(root, source);
    for (const excluded of [
      ".git",
      "node_modules",
      "build",
      "artifacts",
      ".cache",
    ]) {
      assert.ok(
        !report.snapshot.files.some(
          (name) => name === excluded || name.startsWith(excluded + "/"),
        ),
        `源码副本含本机构建或运行产物: ${excluded}`,
      );
    }
    report.docker = command("docker", [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]).trim();
    const model = JSON.parse(
      command("docker", [
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        project,
        "-f",
        "deploy/compose.yaml",
        "config",
        "--no-env-resolution",
        "--format",
        "json",
      ]),
    );
    const config = isolateConfig(model, project, source, workspace);
    const password = randomBytes(32).toString("hex");
    for (const [name, value] of Object.entries({
      mysql_password: password,
      mysql_root_password: randomBytes(32).toString("hex"),
      mysql_dsn: `acceptances:${password}@tcp(mysql:3306)/acceptances?charset=utf8mb4&parseTime=true&loc=UTC`,
    })) {
      await writeFile(join(workspace, name), value, {
        flag: "wx",
        mode: 0o644,
      });
    }
    await writeFile(configPath, json(config));
    await writeFile(join(artifact, "compose.json"), json(config));
    configured = true;
    const composeCommand = ["docker", ...compose]
      .map(quote)
      .join(" ")
      .replaceAll("$", "$$");
    await logged(
      "make",
      ["docker-build", `DOCKER_COMPOSE=${composeCommand}`],
      "build.log",
      { timeout: 1200000 },
    );
    report.image = JSON.parse(
      command("docker", [
        "image",
        "inspect",
        config.services.app.image,
        "--format",
        "{{json .}}",
      ]),
    );
    report.image = {
      id: report.image.Id,
      os: report.image.Os,
      architecture: report.image.Architecture,
      user: report.image.Config.User,
    };
    assert.equal(
      report.image.user,
      "10001:10001",
      "发布镜像应使用非 root 用户",
    );
    await logged(
      "docker",
      [...compose, "up", "-d", "--no-build", "--wait", "--wait-timeout", "180"],
      "startup.log",
    );
    const binding = docker(["port", "app", "8765"]).trim();
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    report.base = `http://${binding}`;
    const deadline = Date.now() + 30000;
    while (true) {
      assert.ok(!interrupted, "发布检查已中断");
      try {
        const ready = await fetch(report.base + "/health/ready", {
          signal: AbortSignal.timeout(1000),
        });
        if (ready.ok) break;
      } catch {
        /* Wait only for the owned container to become ready. */
      }
      assert.ok(Date.now() < deadline, "容器 readiness 超时");
      await delay(200);
    }
    report.resources = await checkWeb(report.base);
    report.cli = JSON.parse(
      docker(["exec", "-T", "app", "acceptances", "version", "--json"]),
    );
    report.outcome = "passed";
  } catch (error) {
    // Never copy child stderr or private connection values into the JSON receipt.
    report.reason =
      error.name === "AssertionError"
        ? error.message
        : error.code || error.name;
    console.error(`发布检查失败: ${report.reason}；查看 ${artifact} 的日志`);
  } finally {
    cleaning = true;
    if (configured) {
      try {
        await logged(
          "docker",
          [...compose, "logs", "--no-color", "--tail", "100"],
          "containers.log",
        );
      } catch {
        /* The build may have failed before containers existed. */
      }
      try {
        // This random project owns only the disposable volumes created above.
        await logged(
          "docker",
          [
            ...compose,
            "down",
            "--volumes",
            "--remove-orphans",
            "--timeout",
            "10",
          ],
          "cleanup.log",
        );
        for (const args of [
          ["ps", "-aq"],
          ["volume", "ls", "-q"],
          ["network", "ls", "-q"],
        ]) {
          const remaining = command("docker", [
            ...args,
            "--filter",
            `label=com.docker.compose.project=${project}`,
          ]).trim();
          assert.equal(remaining, "", "发布检查容器、数据卷或网络未清理");
        }
        const images = command("docker", [
          "image",
          "ls",
          "-q",
          "--filter",
          `reference=${project}:check`,
        ]).trim();
        if (images) command("docker", ["image", "rm", `${project}:check`]);
        report.cleanup = true;
      } catch {
        report.outcome = "failed";
        report.cleanupWorkspace = workspace;
      }
    } else report.cleanup = true;
    if (report.cleanup) await rm(workspace, { recursive: true, force: true });
    report.endedAt = new Date().toISOString();
    await writeFile(join(artifact, "result.json"), json(report));
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    console.log(
      json({ outcome: report.outcome, artifact, cleanup: report.cleanup }),
    );
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const report = await releaseCheck();
    process.exitCode = report.outcome === "passed" && report.cleanup ? 0 : 1;
  } catch (error) {
    console.error(error.code || error.name);
    process.exitCode = 1;
  }
}
