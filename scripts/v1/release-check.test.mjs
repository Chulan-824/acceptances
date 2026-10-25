import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isolateConfig, snapshot } from "./release-check.mjs";
import { checkWeb } from "./web-smoke.mjs";

test("source snapshot includes working changes, excludes private and generated files, and rejects links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "acceptances-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "repo");
  await mkdir(source);
  const git = (...args) => execFileSync("git", args, { cwd: source });
  git("init", "--quiet");
  await writeFile(join(source, ".gitignore"), "build/\n");
  await writeFile(join(source, "tracked"), "old");
  await writeFile(join(source, "deleted"), "deleted");
  git("add", ".");
  await rm(join(source, "deleted"));
  await writeFile(join(source, "tracked"), "current");
  await writeFile(join(source, "new file"), "new");
  await writeFile(join(source, ".env.private"), "fixture-only");
  await mkdir(join(source, "build"));
  await writeFile(join(source, "build/server"), "generated");
  const first = await snapshot(source, join(root, "first"));
  assert.deepEqual(first.files, [".gitignore", "new file", "tracked"]);
  assert.equal(await readFile(join(root, "first/tracked"), "utf8"), "current");
  assert.equal(
    (await snapshot(source, join(root, "second"))).sha256,
    first.sha256,
  );
  await writeFile(join(source, "tracked"), "changed");
  assert.notEqual(
    (await snapshot(source, join(root, "third"))).sha256,
    first.sha256,
  );
  await symlink("tracked", join(source, "linked"));
  await assert.rejects(snapshot(source, join(root, "fourth")), /常规文件/);
});

function model() {
  return {
    name: "acceptances",
    services: {
      app: {
        build: { context: "/source", dockerfile: "deploy/Dockerfile" },
        environment: { ACCEPTANCES_MYSQL_DSN_FILE: "/run/secrets/mysql_dsn" },
        ports: [{ published: "8765", target: 8765 }],
        networks: { default: null },
        volumes: [
          {
            type: "volume",
            source: "app-data",
            target: "/var/lib/acceptances",
          },
        ],
        read_only: true,
      },
      mysql: {
        environment: { MYSQL_DATABASE: "acceptances" },
        networks: { default: null },
        volumes: [
          { type: "volume", source: "mysql-data", target: "/var/lib/mysql" },
        ],
      },
    },
    volumes: {
      "app-data": { name: "daily_app-data" },
      "mysql-data": { external: true },
    },
    networks: { default: { name: "daily_default" } },
    secrets: Object.fromEntries(
      ["mysql_dsn", "mysql_password", "mysql_root_password"].map((name) => [
        name,
        { file: `/daily/${name}` },
      ]),
    ),
  };
}

test("release Compose replaces daily bindings with owned resources and keeps runtime settings", () => {
  const input = model();
  const project = "acceptances-release-abcd-1234";
  const config = isolateConfig(input, project, "/source", "/private");
  assert.equal(input.name, "acceptances");
  assert.equal(config.name, project);
  assert.equal(config.services.app.image, `${project}:check`);
  assert.deepEqual(config.services.app.ports, [
    { target: 8765, published: "0", host_ip: "127.0.0.1", protocol: "tcp" },
  ]);
  assert.equal(config.services.mysql.ports, undefined);
  assert.equal(config.services.app.read_only, true);
  assert.deepEqual(config.volumes["mysql-data"], {
    name: `${project}_mysql-data`,
  });
  assert.equal(config.networks.default.name, `${project}_default`);
  assert.equal(config.secrets.mysql_dsn.file, "/private/mysql_dsn");
  for (const mutate of [
    (config) => {
      config.services.app.volumes[0].type = "bind";
    },
    (config) => {
      config.services.app.container_name = "daily-app";
    },
    (config) => {
      config.services.app.build.context = "/daily";
    },
    (config) => {
      config.services.app.env_file = [".env"];
    },
    (config) => {
      config.services.mysql.network_mode = "host";
    },
  ]) {
    const unsafe = model();
    mutate(unsafe);
    assert.throws(() => isolateConfig(unsafe, project, "/source", "/private"));
  }
});

function webFixture() {
  const files = new Map([
    ["/health/live", ["application/json", '{"status":"alive"}']],
    ["/health/ready", ["application/json", '{"status":"ready"}']],
    [
      "/",
      [
        "text/html",
        '<div id="root"></div><link rel="icon" href="data:,"><script src="/assets/main.js"></script><link href="/assets/main.css">',
      ],
    ],
    [
      "/assets/main.js",
      ["text/javascript", 'import {x} from "./shared.js";import("./lazy.js");'],
    ],
    ["/assets/shared.js", ["text/javascript", "export const x = 1;"]],
    ["/assets/lazy.js", ["text/javascript", "export default 1;"]],
    [
      "/assets/main.css",
      ["text/css", '@import "./theme.css";body{background:url("./icon.svg")}'],
    ],
    ["/assets/theme.css", ["text/css", "body{color:black}"]],
    ["/assets/icon.svg", ["image/svg+xml", "<svg/>"]],
    ["/fonts/geist/OFL.txt", ["text/plain", "Font license"]],
  ]);
  for (const font of [
    "Geist-Variable",
    "Geist-Italic-Variable",
    "GeistMono-Variable",
    "GeistMono-Italic-Variable",
  ]) {
    files.set(`/fonts/geist/${font}.woff2`, ["font/woff2", "wOF2fixture"]);
  }
  const request = async (url) => {
    const entry = files.get(url.pathname);
    return entry
      ? new Response(entry[1], { headers: { "content-type": entry[0] } })
      : new Response("missing", { status: 404 });
  };
  return { files, request };
}

test("shared web smoke checks readiness, entry assets, nested imports, CSS references and fonts", async () => {
  const { request } = webFixture();
  const receipts = await checkWeb("http://localhost:1234", request);
  for (const path of [
    "/assets/shared.js",
    "/assets/lazy.js",
    "/assets/theme.css",
    "/assets/icon.svg",
  ]) {
    assert.ok(
      receipts.some(
        (receipt) => receipt.path === path && receipt.sha256.length === 64,
      ),
      path,
    );
  }
});

test("shared web smoke resolves relative HTML and CSS assets", async () => {
  const { files, request } = webFixture();
  files.set("/", [
    "text/html",
    '<div id="root"></div><script src="assets/main.js"></script><link href="assets/main.css">',
  ]);
  files.set("/assets/main.css", ["text/css", "body{background:url(icon.svg)}"]);
  files.delete("/assets/icon.svg");
  await assert.rejects(
    checkWeb("http://localhost:1234", request),
    /icon\.svg: HTTP 404/,
  );
});

for (const [name, mutate] of [
  ["missing JS chunk", (files) => files.delete("/assets/lazy.js")],
  [
    "SPA fallback instead of CSS",
    (files) =>
      files.set("/assets/main.css", ["text/html", "<html>fallback</html>"]),
  ],
  [
    "invalid font",
    (files) =>
      files.set("/fonts/geist/Geist-Variable.woff2", ["text/plain", "broken"]),
  ],
  [
    "unready database",
    (files) =>
      files.set("/health/ready", ["application/json", '{"status":"unready"}']),
  ],
  [
    "unbuilt HTML",
    (files) =>
      files.set("/", [
        "text/html",
        '<div id="root"></div><script src="/src/main.tsx"></script>',
      ]),
  ],
  [
    "external entry",
    (files) =>
      files.set("/", [
        "text/html",
        '<div id="root"></div><script src="https://example.invalid/main.js"></script><link href="/assets/main.css">',
      ]),
  ],
]) {
  test(`shared web smoke rejects ${name}`, async () => {
    const { files, request } = webFixture();
    mutate(files);
    await assert.rejects(checkWeb("http://localhost:1234", request));
  });
}
