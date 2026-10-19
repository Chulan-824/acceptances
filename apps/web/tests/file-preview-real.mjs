/** 隔离数据上的真实 Web/API 验证，合成附件不代表业务验收。 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { seed } from "./delivery-real.mjs";

export async function run(page, base, output, dataDir) {
  assert.equal(process.env.ACCEPTANCES_TEST_ISOLATED, "1");
  assert.equal(new URL(base).hostname, "127.0.0.1");
  assert.ok(!["5173", "8765"].includes(new URL(base).port));
  await mkdir(output, { recursive: true });
  const steps = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api = async (path, method = "GET", body) => {
    const response = await fetch(base + "/api/v1" + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(
      response.ok,
      `${path}: ${response.status} ${await response.clone().text()}`,
    );
    return response.status === 204 ? undefined : response.json();
  };
  const fixture = await seed(base);
  const report = fixture.run.report;
  const files = Object.fromEntries(
    await Promise.all(
      report.evidence.map(async (item) => [
        item.path,
        Buffer.from(
          await (
            await fetch(
              `${base}/api/v1/runs/${fixture.run.id}/evidence/${encodeURIComponent(item.path)}`,
            )
          ).arrayBuffer(),
        ),
      ]),
    ),
  );
  const markdown =
    '# 附件预览合成\n\n- [x] 已完成\n- [ ] 待验证\n\n~~删除线~~\n\n| 项目 | 结果 |\n| --- | --- |\n| 验收 | 合成通过 |\n\n```json\n{"ok": true}\n```\n\n![同轮截图](screen.png)\n\n![缺失图片](images/screen.png)\n\n<script>window.previewInjected=true</script>\n';
  const patch =
    "diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-before\n+after\n";
  const large =
    "a".repeat(262142) + "中😀文".repeat(90_000) + "最终一段-合成结尾\n";
  const tailCases = [
    { name: "tail-chinese.log", text: "a".repeat(262143) + "中", pages: 1 },
    ...[1, 2, 3].map((offset) => ({
      name: `tail-emoji-${offset}.log`,
      text: "a".repeat(262144 - offset) + "😀",
      pages: 1,
    })),
    { name: "tail-second.log", text: "a".repeat(524287) + "中", pages: 2 },
    { name: "exact-boundary.log", text: "a".repeat(524288), pages: 2 },
  ];
  Object.assign(files, {
    "requirement.md": Buffer.from(markdown),
    "result.json": Buffer.from(
      '{"id":900719925474099312345,"items":[true,"中文"]}',
    ),
    "table.csv": Buffer.from(
      'name,note\r\n"a,b","first\nsecond ""quote"""\r\n',
    ),
    "change.diff": Buffer.from(patch),
    "multiple.patch": Buffer.from(
      patch + patch.replaceAll("sample.txt", "other.txt"),
    ),
    "big.log": Buffer.from(large),
    "large.diff": Buffer.from(large + large),
    "invalid.json": Buffer.from('{"bad":}'),
    "invalid.csv": Buffer.from('"not closed'),
    "empty.txt": Buffer.from(""),
    "broken.diff": Buffer.from("not a patch"),
    "plain.txt": Buffer.from("合成纯文本\n下一行"),
    "many-lines.md": Buffer.from("line\n".repeat(30001)),
    "scroll.md": Buffer.from(
      "# 可滚动文档\n\n" + "一段合成正文\n\n".repeat(1000),
    ),
  });
  for (const item of tailCases) files[item.name] = Buffer.from(item.text);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const map = JSON.parse(files["feature-map.json"]);
  map.requirementSha256 = digest(files["requirement.md"]);
  files["feature-map.json"] = Buffer.from(JSON.stringify(map));
  const materials = JSON.parse(files["business-materials.json"]);
  materials.requirementSha256 = map.requirementSha256;
  materials.mapSha256 = digest(files["feature-map.json"]);
  files["business-materials.json"] = Buffer.from(JSON.stringify(materials));
  const manifest = JSON.parse(files["delivery-manifest.json"]);
  manifest.requirement.sha256 = map.requirementSha256;
  manifest.map.sha256 = digest(files["feature-map.json"]);
  manifest.materials.sha256 = digest(files["business-materials.json"]);
  files["delivery-manifest.json"] = Buffer.from(JSON.stringify(manifest));
  report.evidence = Object.keys(files).map((path) => ({
    path,
    description: "合成文件预览验证",
  }));
  report.checks[0].evidence = Object.keys(files);
  const form = new FormData();
  form.set("submissionId", randomUUID());
  form.set("report", JSON.stringify(report));
  for (const [name, bytes] of Object.entries(files))
    form.append("evidence", new Blob([bytes]), name);
  const published = await fetch(
    `${base}/api/v1/campaigns/${fixture.campaign.id}/runs`,
    { method: "POST", body: form },
  );
  assert.equal(published.status, 201, await published.clone().text());
  const run = await published.json();
  const runURL = `${base}/projects/${fixture.project.id}/campaigns/${fixture.campaign.id}/runs/${run.id}`;
  const evidenceURL = (name) =>
    `${base}/api/v1/runs/${run.id}/evidence/${encodeURIComponent(name)}`;
  const record = async (name, screenshot = false) => {
    if (screenshot) {
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({
        path: join(output, `${name}.png`),
        fullPage: page.viewportSize().width >= 768,
      });
    }
    steps.push({ name, outcome: "passed" });
    console.log("PASS", name);
  };
  const dialog = () => page.getByRole("dialog");
  const open = async (name) => {
    await page
      .getByRole("button", { name: `预览 ${name}`, exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await dialog().waitFor();
    await page.waitForFunction(
      () => !!document.querySelector(".file-preview-toolbar"),
    );
    assert.equal(await dialog().getByRole("link", { name: /下载/ }).count(), 0);
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
  };
  const rawText = () =>
    page
      .locator(".file-preview-raw .file-preview-lines")
      .evaluate((element) => {
        const lines = [...element.querySelectorAll(".file-preview-line")];
        return lines.length
          ? lines.map((line) => line.lastElementChild.textContent).join("")
          : element.textContent;
      });
  await page.goto(runURL);
  await page
    .getByRole("button", { name: "更多附件", exact: false })
    .first()
    .click();
  let previewModuleRequests = 0;
  const previewModuleURL = (url) =>
    /\/file-preview-viewer(?:-[\w-]+\.js|\.tsx)$/.test(url.pathname);
  await page.route(previewModuleURL, async (route) => {
    previewModuleRequests++;
    if (previewModuleRequests === 1)
      return route.fulfill({
        status: 503,
        body: "injected-preview-module-failure",
      });
    return route.continue();
  });
  await page
    .getByRole("button", { name: "预览 requirement.md", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await dialog()
    .getByRole("button", { name: "重试加载预览", exact: true })
    .click();
  await dialog().locator(".file-preview-toolbar").waitFor();
  assert.equal(previewModuleRequests, 2);
  await page.unroute(previewModuleURL);
  await record("preview-module-503-retry");
  await dialog()
    .getByRole("heading", { name: "附件预览合成", exact: true })
    .waitFor();
  assert.equal(await dialog().locator('input[type="checkbox"]').count(), 2);
  assert.equal(await dialog().locator("del").innerText(), "删除线");
  assert.ok(
    await dialog()
      .getByRole("cell", { name: "合成通过", exact: true })
      .isVisible(),
  );
  const image = dialog().getByRole("img", { name: "同轮截图", exact: true });
  await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector(".file-preview-markdown img")?.naturalWidth > 0,
  );
  assert.equal(
    await image.getAttribute("src"),
    evidenceURL("screen.png").replace(base, ""),
  );
  assert.ok(await dialog().getByText("图片不可用：缺失图片").isVisible());
  assert.equal(await page.evaluate(() => window.previewInjected), undefined);
  await record("markdown-check-item-gfm-image", true);
  await dialog().getByRole("button", { name: "原文", exact: true }).click();
  assert.equal(await rawText(), markdown);
  await close();
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-label") ===
      "预览 requirement.md",
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "预览 requirement.md",
  );
  await record("raw-original-and-close-focus");

  await page.getByRole("tab", { name: /^文件/ }).click();
  await open("result.json");
  assert.match(
    await dialog().locator(".file-preview-rich pre").textContent(),
    /900719925474099312345/,
  );
  await record("json-precision-format", true);
  await close();
  await open("table.csv");
  assert.equal(
    await dialog().getByRole("cell", { name: "a,b", exact: true }).count(),
    1,
  );
  assert.equal(await dialog().locator("tbody tr").count(), 2);
  await dialog()
    .getByRole("button", { name: "首行作为表头", exact: true })
    .click();
  assert.equal(await dialog().getByRole("columnheader").count(), 2);
  assert.equal(await dialog().locator("tbody tr").count(), 1);
  assert.match(
    await dialog().locator("tbody").textContent(),
    /first\nsecond "quote"/,
  );
  await record("csv-quotes-multiline-header", true);
  await close();
  let diffModuleRequests = 0;
  const diffModuleURL = (url) =>
    /\/diff-evidence-viewer(?:-[\w-]+\.js|\.tsx)$/.test(url.pathname);
  await page.route(diffModuleURL, async (route) => {
    diffModuleRequests++;
    if (diffModuleRequests <= 3)
      return route.fulfill({ status: 503, body: "injected-module-failure" });
    return route.continue();
  });
  await open("change.diff");
  const retryDiff = () =>
    dialog().getByRole("button", { name: "重试加载差异预览", exact: true });
  await retryDiff().waitFor();
  await dialog().getByRole("button", { name: "查看原文", exact: true }).click();
  assert.equal(await rawText(), patch);
  await dialog().getByRole("button", { name: "差异", exact: true }).click();
  await retryDiff().click();
  await page.waitForFunction(
    () => !!document.querySelector('.file-preview-rich [role="alert"]'),
  );
  assert.equal(diffModuleRequests, 2);
  await record("diff-module-repeated-failure-raw-fallback");
  await close();
  await open("change.diff");
  await retryDiff().waitFor();
  assert.equal(diffModuleRequests, 3);
  await record("diff-module-reopen-retries-failed-import");
  await retryDiff().click();
  await dialog().locator("diffs-container").waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector("pre")
      ?.textContent.includes("after"),
  );
  assert.equal(diffModuleRequests, 4);
  await page.unroute(diffModuleURL);
  await record("diff-module-retry-real-render");
  assert.equal(
    await dialog().getByRole("navigation", { name: "变更文件" }).count(),
    0,
  );
  await dialog().getByRole("button", { name: "统一", exact: true }).click();
  await record("diff-single-file-real-render", true);
  await dialog().getByRole("button", { name: "原文", exact: true }).click();
  assert.equal(await rawText(), patch);
  await dialog().getByRole("button", { name: "差异", exact: true }).click();
  assert.equal(
    await dialog()
      .getByRole("button", { name: "统一", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await close();
  await open("multiple.patch");
  await dialog()
    .getByRole("navigation", { name: "变更文件" })
    .getByRole("button", { name: /other.txt/ })
    .click();
  await dialog().getByRole("button", { name: "原文", exact: true }).click();
  await dialog().getByRole("button", { name: "差异", exact: true }).click();
  assert.equal(
    await dialog()
      .getByRole("navigation", { name: "变更文件" })
      .getByRole("button", { name: /other.txt/ })
      .getAttribute("aria-current"),
    "true",
  );
  await record("diff-internal-selection-restored");
  await close();

  await open("big.log");
  const originalParts = [];
  while (true) {
    await page.waitForFunction(
      () => !!document.querySelector(".file-preview-raw .file-preview-lines"),
    );
    originalParts.push(await rawText());
    const next = dialog().getByRole("button", { name: "下一段", exact: true });
    if (await next.isDisabled()) break;
    await next.click();
    await next.waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !!document.querySelector(".file-preview-raw .file-preview-lines"),
    );
  }
  assert.equal(originalParts.join(""), large);
  await dialog().getByRole("button", { name: "上一段", exact: true }).click();
  await page.waitForFunction(
    () => !!document.querySelector(".file-preview-raw .file-preview-lines"),
  );
  assert.equal(await rawText(), originalParts.at(-2));
  await record("large-log-utf8-complete-pagination", true);
  await close();
  for (const item of tailCases) {
    await open(item.name);
    const parts = [];
    while (true) {
      await dialog().locator(".file-preview-raw .file-preview-lines").waitFor();
      parts.push(await rawText());
      const next = dialog().getByRole("button", {
        name: "下一段",
        exact: true,
      });
      if (await next.isDisabled()) break;
      await next.click();
    }
    assert.equal(parts.length, item.pages, item.name);
    assert.equal(parts.join(""), item.text, item.name);
    assert.ok(parts.every((part) => part.length > 0));
    assert.match(
      await dialog().locator(".file-preview-pagination").innerText(),
      new RegExp(`第 ${item.pages} / ${item.pages} 段`),
    );
    assert.equal(
      await dialog().getByText("文件为空。", { exact: true }).count(),
      0,
    );
    if (item.pages > 1) {
      await dialog()
        .getByRole("button", { name: "上一段", exact: true })
        .click();
      await dialog().locator(".file-preview-raw .file-preview-lines").waitFor();
      assert.equal(await rawText(), parts[0]);
      assert.match(
        await dialog().locator(".file-preview-pagination").innerText(),
        /第 1 \/ 2 段/,
      );
      await dialog()
        .getByRole("button", { name: "下一段", exact: true })
        .click();
      await dialog().locator(".file-preview-raw .file-preview-lines").waitFor();
      assert.equal(await rawText(), parts[1]);
      assert.ok(
        await dialog()
          .getByRole("button", { name: "下一段", exact: true })
          .isDisabled(),
      );
    }
    await close();
  }
  await record("utf8-tail-and-exact-boundary-no-empty-page", true);
  let failedPage = false;
  await page.route("**/evidence/big.log", async (route) => {
    if (
      !failedPage &&
      route.request().headers().range?.startsWith("bytes=262144-")
    ) {
      failedPage = true;
      return route.fulfill({ status: 503, body: "injected-page-failure" });
    }
    return route.continue();
  });
  await open("big.log");
  await dialog().getByRole("button", { name: "下一段", exact: true }).click();
  await dialog()
    .getByRole("button", { name: "重试读取本段", exact: true })
    .click();
  await dialog().locator(".file-preview-raw .file-preview-lines").waitFor();
  assert.equal(await rawText(), originalParts[1]);
  await dialog().getByRole("button", { name: "上一段", exact: true }).click();
  await dialog().locator(".file-preview-raw .file-preview-lines").waitFor();
  assert.equal(await rawText(), originalParts[0]);
  await close();
  await page.unroute("**/evidence/big.log");
  await record("page-503-retry-and-return-preserves-text");
  await open("large.diff");
  assert.ok(
    await dialog().getByText("文件较大，已切换为分段原文。").isVisible(),
  );
  assert.ok(
    await dialog()
      .getByRole("button", { name: "下一段", exact: true })
      .isEnabled(),
  );
  await record("large-diff-paged-fallback");
  await close();
  for (const name of [
    "invalid.json",
    "invalid.csv",
    "broken.diff",
    "many-lines.md",
    "empty.txt",
    "plain.txt",
  ]) {
    await open(name);
    assert.equal(
      await dialog().locator(".file-preview-raw:visible").count(),
      1,
    );
    if (name === "empty.txt")
      assert.ok(
        await dialog().getByText("文件为空。", { exact: true }).isVisible(),
      );
    else assert.ok((await rawText()).length > 0);
    await close();
  }
  await record("invalid-empty-complexity-original-fallback");

  const range = await fetch(evidenceURL("big.log"), {
    headers: { Range: "bytes=262144-262155" },
  });
  assert.equal(range.status, 206);
  assert.match(range.headers.get("Content-Range"), /^bytes 262144-262155\//);
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    files["big.log"].subarray(262144, 262156),
  );
  assert.equal(
    (
      await fetch(evidenceURL("big.log"), {
        headers: { Range: "bytes=999999999-" },
      })
    ).status,
    416,
  );
  assert.equal(
    (
      await fetch(evidenceURL("empty.txt"), {
        headers: { Range: "bytes=0-100" },
      })
    ).status,
    200,
  );
  await record("real-http-range-206-416-empty");

  await page.setViewportSize({ width: 390, height: 844 });
  await open("requirement.md");
  const box = await dialog().boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391);
  await record("mobile-preview-bounds", true);
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  let failed = true;
  await page.route("**/evidence/plain.txt", async (route) => {
    if (failed) {
      failed = false;
      return route.fulfill({ status: 503, body: "injected-test-failure" });
    }
    return route.continue();
  });
  await page
    .getByRole("button", { name: "预览 plain.txt", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await dialog()
    .getByRole("button", { name: "重试读取文件", exact: true })
    .click();
  await dialog().getByText("合成纯文本", { exact: false }).waitFor();
  await close();
  await page.unroute("**/evidence/plain.txt");
  await record("injected-load-error-real-retry");
  await open("scroll.md");
  const readingPane = dialog().locator(".file-preview-rich");
  await readingPane.evaluate((element) => {
    element.scrollTop = 1000;
  });
  await dialog().getByRole("button", { name: "原文", exact: true }).click();
  await dialog().getByRole("button", { name: "预览", exact: true }).click();
  assert.equal(
    await readingPane.evaluate((element) => element.scrollTop),
    1000,
  );
  await close();
  await record("mode-switch-preserves-reading-position");
  let releaseRead;
  const held = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let intercepted;
  const reached = new Promise((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/evidence/plain.txt", async (route) => {
    intercepted();
    await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "预览 plain.txt", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await reached;
  await close();
  releaseRead();
  await open("result.json");
  assert.equal(
    await dialog()
      .getByRole("heading", { name: "result.json", exact: true })
      .count(),
    1,
  );
  await close();
  await page.unroute("**/evidence/plain.txt");
  await record("injected-pending-read-close-and-next-file");

  await api(`/runs/${run.id}/accept-all`, "POST", {});
  const prep = await api(`/runs/${run.id}/delivery-preparation`);
  assert.equal(prep.eligible, true, JSON.stringify(prep));
  const delivery = await api(`/runs/${run.id}/deliveries`, "POST", {
    requestId: randomUUID(),
    token: prep.token,
    mapConfirmed: true,
    materialsConfirmed: true,
    sensitiveInfoReviewed: true,
    exceptionReasons: {
      "fixture-export--compatibility": "合成测试预设阻塞，非业务验收",
    },
  });
  const doc = await api(`/deliveries/${delivery.id}/documents`, "POST", {
    requestId: randomUUID(),
  });
  assert.equal(doc.status, "succeeded");
  await page.goto(`${base}/deliveries/${delivery.id}`);
  await page
    .getByRole("button", { name: "代码、构建与复制证据", exact: true })
    .click();
  assert.equal(await page.locator('a[href*="/evidence/"]').count(), 0);
  assert.equal(
    await page
      .getByRole("link", { name: "下载快照与当前效力记录", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "下载离线 HTML v1", exact: true })
      .count(),
    1,
  );
  await open("requirement.md");
  assert.match(
    await dialog()
      .getByRole("img", { name: "同轮截图", exact: true })
      .getAttribute("src"),
    new RegExp(`/deliveries/${delivery.id}/evidence/`),
  );
  await record("frozen-preview-export-boundaries", true);
  await close();
  const preview = await api(`/projects/${fixture.project.id}/delete-preview`);
  await api(`/projects/${fixture.project.id}`, "DELETE", {
    confirmationToken: preview.token,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "代码、构建与复制证据", exact: true })
    .click();
  await open("requirement.md");
  const frozenImage = dialog().getByRole("img", {
    name: "同轮截图",
    exact: true,
  });
  await frozenImage.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector(".file-preview-markdown img")?.naturalWidth > 0,
  );
  await record("frozen-preview-after-source-deletion");
  await close();
  const frozenURL = `${base}/api/v1/deliveries/${delivery.id}/evidence/big.log`;
  const frozenRange = await fetch(frozenURL, {
    headers: { Range: "bytes=4-12" },
  });
  assert.equal(frozenRange.status, 206);
  assert.deepEqual(
    Buffer.from(await frozenRange.arrayBuffer()),
    files["big.log"].subarray(4, 13),
  );
  async function findFile(directory, name) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === name) return path;
      if (entry.isDirectory()) {
        const found = await findFile(path, name);
        if (found) return found;
      }
    }
  }
  const frozenPath = await findFile(dataDir, "big.log");
  assert.ok(frozenPath);
  await writeFile(frozenPath, "tampered synthetic temporary fixture");
  assert.equal(
    (await fetch(frozenURL, { headers: { Range: "bytes=0-3" } })).status,
    409,
  );
  await record("frozen-range-integrity-409");
  assert.deepEqual(errors, []);
  return {
    outcome: "passed",
    base,
    runId: run.id,
    deliveryId: delivery.id,
    steps,
    errors,
  };
}
