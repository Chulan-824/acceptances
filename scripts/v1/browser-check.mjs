import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { suites, selectSuites } from "./browser-suites.mjs";
import { startIsolatedServer } from "./services.mjs";
import { createMySQLTestDatabase } from "./mysql-test-database.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
assert.ok(
  process.argv.slice(2).every((argument) => argument === "--list"),
  "只支持 --list；通过 BROWSER_GROUPS 选择分组",
);
const selected = selectSuites(process.env.BROWSER_GROUPS || "all");
assert.ok(
  (process.env.ACCEPTANCES_BROWSER_DATABASE || "mysql") === "mysql",
  "浏览器数据库仅支持 mysql",
);
if (process.argv.includes("--list")) {
  for (const name of selected)
    console.log(
      `${name}: ${suites[name].cases?.length || 1} case(s), ${suites[name].evidenceClass}`,
    );
} else {
  await main();
}

async function buildDigest(server, web) {
  const hash = createHash("sha256");
  hash.update(await readFile(server));
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = entry.name;
      const path = join(directory, name);
      const relative = prefix + name;
      if (entry.isDirectory()) {
        await walk(path, relative + "/");
      } else {
        hash.update(relative + "\0").update(await readFile(path));
      }
    }
  }
  await walk(web);
  return hash.digest("hex");
}

async function startServer(name, output, buildDirectory, onStop) {
  const database = await createMySQLTestDatabase();
  try {
    const service = await startIsolatedServer({
      kind: "browser",
      binary: join(buildDirectory, "server"),
      web: join(buildDirectory, "web"),
      // The deletion fault-injection seam restricts writes to this exact prefix.
      directoryPrefix:
        name === "deletion-real"
          ? "/tmp/acceptances-deletion."
          : "/tmp/acceptances-browser-",
      logPath: join(output, "server.log"),
      onStop,
      signals: false, // The browser runner owns interruption and evidence finalization.
      environment: database?.environment,
    });
    return {
      ...service,
      async stop() {
        try {
          return await service.stop();
        } finally {
          await database?.close();
        }
      },
    };
  } catch (error) {
    await database?.close();
    throw error;
  }
}

async function main() {
  await access("build/server");
  await access("apps/web/dist/index.html");
  const output = resolve(
    "artifacts/browser",
    new Date().toISOString().replaceAll(":", "-") + `-${process.pid}`,
  );
  await mkdir(output, { recursive: true });
  process.env.ACCEPTANCES_TEST_ISOLATED = "1";
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const report = {
    databaseEngine: "mysql",
    startedAt: new Date().toISOString(),
    sourceCommit: git("rev-parse", "HEAD"),
    dirty: Boolean(git("status", "--porcelain=v1")),
    serverSha256: createHash("sha256")
      .update(await readFile("build/server"))
      .digest("hex"),
    playwrightVersion: JSON.parse(
      await readFile(
        new URL("../../node_modules/playwright/package.json", import.meta.url),
      ),
    ).version,
    selected,
    limitations: [
      "使用合成数据和专用临时 Go 服务，不代表真实业务需求验收；受控 HTTP 与实际 Go API 场景分别标注。",
      "本入口复用平台回归，不替代 Docker、完整 T1–T9 或人工确认；dirty 源码须另存快照后才能用作正式候选依据。",
    ],
    results: [],
  };
  let browser, interrupted;
  let buildDirectory;
  const onSignal = (signal) => {
    interrupted = signal;
    // Closing the browser interrupts pending UI waits; group finally stops the service.
    void browser?.close().catch(() => {});
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const expectedBuild = await buildDigest("build/server", "apps/web/dist");
    buildDirectory = await mkdtemp("/tmp/acceptances-browser-build-");
    await cp("build/server", join(buildDirectory, "server"));
    await cp("apps/web/dist", join(buildDirectory, "web"), { recursive: true });
    report.buildSha256 = await buildDigest(
      join(buildDirectory, "server"),
      join(buildDirectory, "web"),
    );
    assert.equal(
      report.buildSha256,
      expectedBuild,
      "复制期间构建产物变化，请重跑",
    );
    browser = await chromium.launch({
      channel: process.env.ACCEPTANCES_BROWSER_CHANNEL || "chrome",
      headless: process.env.ACCEPTANCES_BROWSER_HEADED !== "1",
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    report.browserVersion = browser.version();
    console.log(`浏览器回归输出：${output}`);
    for (const name of selected) {
      if (interrupted) break;
      const suite = suites[name];
      const groupOutput = join(output, name);
      await mkdir(groupOutput, { recursive: true });
      let service;
      try {
        service = await startServer(name, groupOutput, buildDirectory, () =>
          onSignal("services-stop"),
        );
        for (const scenario of suite.cases || ["default"]) {
          if (interrupted) break;
          const caseOutput = join(groupOutput, scenario.replaceAll("/", "-"));
          await mkdir(caseOutput, { recursive: true });
          const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            acceptDownloads: true,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(12000);
          const requests = [];
          const pageErrors = [];
          page.on("response", (response) => {
            if (response.url().startsWith(service.base + "/api/"))
              requests.push({
                url: response.url(),
                method: response.request().method(),
                status: response.status(),
              });
          });
          page.on("pageerror", (error) => pageErrors.push(error.message));
          const result = {
            group: name,
            scenario,
            evidenceClass: suite.evidenceClass,
            base: service.base,
            output: caseOutput,
            startedAt: new Date().toISOString(),
          };
          let timeout;
          try {
            await context.tracing.start({
              screenshots: true,
              snapshots: true,
              sources: true,
            });
            if (suite.video)
              execFileSync(
                "ffmpeg",
                [
                  "-loglevel",
                  "error",
                  "-f",
                  "lavfi",
                  "-i",
                  "color=c=blue:s=32x32:d=1",
                  "-c:v",
                  "libx264",
                  "-pix_fmt",
                  "yuv420p",
                  join(caseOutput, "fixture.mp4"),
                ],
                { stdio: "pipe", timeout: 15000 },
              );
            result.details = await Promise.race([
              suite.run({
                page,
                base: service.base,
                output: caseOutput,
                data: service.data,
                scenario,
              }),
              new Promise((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error("浏览器场景超过 120 秒")),
                  120000,
                );
              }),
            ]);
            assert.deepEqual(pageErrors, [], "出现未捕获的浏览器异常");
            result.outcome = "passed";
          } catch (error) {
            result.outcome = "failed";
            result.error = error.stack;
          } finally {
            clearTimeout(timeout);
            try {
              await page.screenshot({
                path: join(caseOutput, `${result.outcome}.png`),
                fullPage: true,
                timeout: 5000,
              });
            } catch (error) {
              result.screenshotError = error.message;
            }
            try {
              await context.tracing.stop({
                path: join(caseOutput, "trace.zip"),
              });
            } catch (error) {
              result.traceError = error.message;
            }
            await context.close();
            result.endedAt = new Date().toISOString();
            result.pageErrors = pageErrors;
            await writeFile(
              join(caseOutput, "network.json"),
              JSON.stringify(requests, null, 2) + "\n",
            );
            await writeFile(
              join(caseOutput, "result.json"),
              JSON.stringify(result, null, 2) + "\n",
            );
            report.results.push(result);
          }
          console.log(`${result.outcome.toUpperCase()} ${name}/${scenario}`);
        }
      } catch (error) {
        report.results.push({
          group: name,
          outcome: "failed",
          error: error.stack,
        });
        console.error(`${name}: ${error.message}`);
      } finally {
        if (service) {
          const exit = await service.stop();
          if (exit.code !== 0)
            report.results.push({
              group: name,
              outcome: "failed",
              error: `服务未正常退出：${JSON.stringify(exit)}`,
            });
          try {
            await fetch(`${service.base}/health/ready`, {
              signal: AbortSignal.timeout(1000),
            });
            report.results.push({
              group: name,
              outcome: "failed",
              error: "退出后临时端口仍可访问",
            });
          } catch {
            /* 预期：专用服务已退出。 */
          }
        }
      }
    }
  } catch (error) {
    report.results.push({ outcome: "failed", error: error.stack });
  } finally {
    await browser?.close();
    if (buildDirectory)
      await rm(buildDirectory, { recursive: true, force: true });
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    report.interrupted = interrupted || null;
    report.endedAt = new Date().toISOString();
    report.outcome =
      !interrupted &&
      report.results.length > 0 &&
      report.results.every((result) => result.outcome === "passed")
        ? "passed"
        : "failed";
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      `${report.outcome.toUpperCase()} ${report.results.filter((result) => result.outcome === "passed").length}/${report.results.length}，${join(output, "result.json")}`,
    );
    if (report.outcome !== "passed") process.exitCode = 1;
  }
}
