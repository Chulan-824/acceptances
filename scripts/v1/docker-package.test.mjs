import assert from "node:assert/strict";
import test from "node:test";
import { packageImage, releaseNames, serverConfig } from "./docker-package.mjs";

test("release tags identify the version and target architecture, and reject invalid paths", async () => {
  assert.deepEqual(releaseNames("2026.10.26-1"), {
    directory: "2026.10.26-1-linux-amd64",
    app: "acceptances:2026.10.26-1-amd64",
  });
  for (const value of [
    "",
    "../other",
    "tag with space",
    "$(command)",
    "a".repeat(97),
  ]) {
    assert.throws(() => releaseNames(value));
  }
  await assert.rejects(packageImage("../other"), /VERSION/);
});

test("server Compose preserves runtime restrictions and health checks without build or local credentials", () => {
  const model = {
    name: "acceptances",
    services: {
      app: {
        build: { context: "/local/source", dockerfile: "deploy/Dockerfile" },
        ports: [{ target: 8765, published: "8765", host_ip: "127.0.0.1" }],
        environment: {
          ACCEPTANCES_PUBLIC_ORIGIN: "http://127.0.0.1:8765",
          ACCEPTANCES_MYSQL_DSN_FILE: "/run/secrets/mysql_dsn",
        },
        depends_on: { mysql: { condition: "service_healthy", required: true } },
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        tmpfs: ["/tmp"],
        volumes: [
          {
            type: "volume",
            source: "app-data",
            target: "/var/lib/acceptances",
          },
        ],
        secrets: [{ source: "mysql_dsn", target: "mysql_dsn" }],
      },
      mysql: {
        image: "mysql:8.4@sha256:locked",
        healthcheck: { test: ["CMD-SHELL", "mysql -e 'SELECT 1'"] },
        volumes: [
          { type: "volume", source: "mysql-data", target: "/var/lib/mysql" },
        ],
      },
    },
    secrets: Object.fromEntries(
      ["mysql_dsn", "mysql_password", "mysql_root_password"].map((name) => [
        name,
        { file: `/local/private/${name}` },
      ]),
    ),
    volumes: {
      "app-data": { name: "acceptances_app-data" },
      "mysql-data": { name: "acceptances_mysql-data" },
    },
    networks: { default: { name: "acceptances_default" } },
  };
  const config = serverConfig(
    model,
    "acceptances:release-amd64",
    "acceptances-mysql:locked-amd64",
  );
  assert.ok(model.services.app.build);
  assert.equal(config.services.app.image, "acceptances:release-amd64");
  assert.equal(config.services.mysql.image, "acceptances-mysql:locked-amd64");
  assert.ok(!JSON.stringify(config).includes("/local/"));
  for (const service of Object.values(config.services)) {
    assert.equal(service.build, undefined);
    assert.equal(service.platform, "linux/amd64");
    assert.equal(service.pull_policy, "never");
    assert.equal(service.restart, "unless-stopped");
    assert.deepEqual(service.logging.options, {
      "max-size": "10m",
      "max-file": "3",
    });
  }
  for (const key of [
    "ports",
    "depends_on",
    "read_only",
    "cap_drop",
    "security_opt",
    "tmpfs",
    "volumes",
    "secrets",
  ]) {
    assert.deepEqual(config.services.app[key], model.services.app[key], key);
  }
  assert.deepEqual(
    config.services.mysql.healthcheck,
    model.services.mysql.healthcheck,
  );
  assert.equal(config.services.mysql.ports, undefined);
  assert.equal(
    config.services.app.environment.ACCEPTANCES_MYSQL_DSN_FILE,
    "/run/secrets/mysql_dsn",
  );
  assert.match(
    config.services.app.environment.ACCEPTANCES_PUBLIC_ORIGIN,
    /\$\{ACCEPTANCES_PUBLIC_ORIGIN:\?/,
  );
  assert.equal(
    config.secrets.mysql_dsn.file,
    "${ACCEPTANCES_SECRETS_DIR:?请设置服务器凭据目录}/docker.dsn",
  );
  assert.deepEqual(config.volumes, { "app-data": {}, "mysql-data": {} });
  assert.deepEqual(config.networks, { default: {} });
  assert.throws(() => serverConfig({ ...model, secrets: {} }, "app", "mysql"));
});
