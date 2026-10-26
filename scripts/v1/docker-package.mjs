import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { snapshot } from "./release-check.mjs";
import { buildFlags, sourceIdentity } from "./source-identity.mjs";

const platform = "linux/amd64";
const json = (value) => JSON.stringify(value, null, 2) + "\n";

export function releaseNames(version) {
  assert.match(
    version,
    /^[a-z0-9][a-z0-9_.-]{0,95}$/,
    "VERSION 必须为 1–96 位小写字母、数字、点、下划线或连字符，首位为字母或数字",
  );
  return {
    directory: `${version}-linux-amd64`,
    app: `acceptances:${version}-amd64`,
  };
}

export function serverConfig(model, appImage, mysqlImage) {
  const config = structuredClone(model);
  assert.deepEqual(Object.keys(config.services).sort(), ["app", "mysql"]);
  assert.deepEqual(Object.keys(config.secrets).sort(), [
    "mysql_dsn",
    "mysql_password",
    "mysql_root_password",
  ]);
  config.name = "acceptances";
  for (const service of Object.values(config.services)) {
    delete service.build;
    service.platform = platform;
    service.pull_policy = "never";
    service.restart = "unless-stopped";
    service.logging = {
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    };
  }
  config.services.app.image = appImage;
  config.services.mysql.image = mysqlImage;
  config.services.app.environment.ACCEPTANCES_PUBLIC_ORIGIN =
    "${ACCEPTANCES_PUBLIC_ORIGIN:?请设置 HTTPS 公共入口}";
  for (const resource of [config.volumes, config.networks]) {
    for (const value of Object.values(resource)) delete value.name;
  }
  for (const [name, file] of Object.entries({
    mysql_dsn: "docker.dsn",
    mysql_password: "password",
    mysql_root_password: "root-password",
  })) {
    config.secrets[name] = {
      file: "${ACCEPTANCES_SECRETS_DIR:?请设置服务器凭据目录}/" + file,
    };
  }
  return config;
}

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

export async function packageImage(version, root = process.cwd()) {
  const names = releaseNames(version);
  const destination = join(root, "artifacts/docker", names.directory);
  const env = { ...process.env, COMPOSE_DISABLE_ENV_FILE: "1" };
  const docker = (args, options = {}) =>
    execFileSync("docker", args, {
      cwd: root,
      env,
      stdio: "inherit",
      ...options,
    });
  const inspect = (image) =>
    JSON.parse(
      docker(["image", "inspect", image], { encoding: "utf8", stdio: "pipe" }),
    )[0];
  docker(["info", "--format", "{{.ServerVersion}}"]);
  const existing = docker(["image", "ls", "--quiet", names.app], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  assert.equal(
    existing,
    "",
    "镜像标签已存在，请使用新的 VERSION，不覆盖旧版本",
  );
  await mkdir(join(root, "artifacts/docker"), { recursive: true });
  await mkdir(destination);
  const workspace = await mkdtemp(join(tmpdir(), "acceptances-package-"));
  try {
    const source = join(workspace, "source");
    const identity = await sourceIdentity(root);
    assert.notEqual(identity.commit, "unknown", "请在 Git 仓库中打包");
    const frozen = await snapshot(root, source);
    identity.sourceDigest = (await sourceIdentity(source)).sourceDigest;
    assert.notEqual(identity.sourceDigest, "unknown", "无法计算构建源码摘要");
    const model = JSON.parse(
      docker(
        [
          "compose",
          "--env-file",
          "/dev/null",
          "-p",
          "acceptances",
          "-f",
          "deploy/compose.yaml",
          "config",
          "--format",
          "json",
        ],
        { cwd: source, encoding: "utf8", stdio: "pipe" },
      ),
    );
    const upstream = model.services.mysql.image;
    assert.match(upstream, /@sha256:[a-f0-9]{64}$/);
    const mysqlImage = `acceptances-mysql:8.4-${upstream.split(":").at(-1).slice(0, 12)}-amd64`;
    docker([
      "buildx",
      "build",
      "--platform",
      platform,
      "--load",
      "--provenance=false",
      "--build-arg",
      `BUILD_LDFLAGS=${buildFlags(identity)}`,
      "--tag",
      names.app,
      "--file",
      join(source, "deploy/Dockerfile"),
      source,
    ]);
    // Export one platform without replacing the daemon's cached MySQL digest.
    docker(
      [
        "buildx",
        "build",
        "--platform",
        platform,
        "--load",
        "--provenance=false",
        "--tag",
        mysqlImage,
        "-",
      ],
      { input: `FROM ${upstream}\n`, stdio: ["pipe", "inherit", "inherit"] },
    );
    const images = [names.app, mysqlImage].map((ref) => {
      const image = inspect(ref);
      assert.equal(`${image.Os}/${image.Architecture}`, platform);
      return { ref, id: image.Id, platform };
    });
    await writeFile(
      join(destination, "compose.json"),
      json(serverConfig(model, names.app, mysqlImage)),
    );
    await writeFile(
      join(destination, "release.json"),
      json({
        version,
        platform,
        builtAt: new Date().toISOString(),
        build: identity,
        images,
        mysqlUpstream: upstream,
        source: frozen,
      }),
    );
    await writeFile(
      join(destination, "runtime.conf.example"),
      "ACCEPTANCES_PUBLIC_ORIGIN=https://acceptances.company.example\n" +
        "ACCEPTANCES_SECRETS_DIR=/opt/acceptances/shared/mysql\n",
    );
    await copyFile(
      join(source, "DEPLOYMENT.md"),
      join(destination, "DEPLOYMENT.md"),
    );
    docker([
      "image",
      "save",
      "--output",
      join(destination, "images.tar"),
      ...images.map((image) => image.ref),
    ]);
    const files = [
      "compose.json",
      "release.json",
      "runtime.conf.example",
      "DEPLOYMENT.md",
      "images.tar",
    ];
    const sums = [];
    for (const name of files)
      sums.push(`${await checksum(join(destination, name))}  ${name}\n`);
    await writeFile(join(destination, "SHA256SUMS"), sums.join(""));
    console.log(`离线部署包已生成：${destination}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await packageImage(process.argv[2] || "");
  } catch (error) {
    console.error(`打包失败：${error.message}`);
    process.exitCode = 1;
  }
}
