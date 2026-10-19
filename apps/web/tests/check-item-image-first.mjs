// Real browser and isolated Go API; fixture reports are platform checks only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function run(page, base, output) {
  const origin = new URL(base);
  assert.equal(process.env.ACCEPTANCES_TEST_ISOLATED, "1");
  assert.equal(origin.hostname, "127.0.0.1");
  assert.ok(origin.port && !["5173", "8765"].includes(origin.port));
  const api = async (path, method = "GET", body) => {
    const response = await page.request.fetch(`${base}/api/v1${path}`, {
      method,
      data: body,
    });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  assert.equal((await api("/projects")).items.length, 0);
  const project = await api("/projects", "POST", {
    name: "检查项图片优先合成验证",
  });
  const campaign = await api(`/projects/${project.id}/campaigns`, "POST", {
    title: "临时服务与数据",
  });
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAUAAAABQCAIAAADnUzvSAAAACXBIWXMAAAABAAAAAQBPJcTWAAABCUlEQVR4nO3TMQ0AIQDAwCd5WajDMzseWEiTOwVdOubaH9D0vw4A7hkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQdgAitwLxpwnupQAAAABJRU5ErkJggg==",
    "base64",
  );
  const files = [
    { name: "first.PNG", mimeType: "image/png", buffer: image },
    { name: "second.png", mimeType: "image/png", buffer: image },
    {
      name: "recording.mp4",
      mimeType: "video/mp4",
      buffer: await readFile(`${output}/fixture.mp4`),
    },
    {
      name: "change.diff",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-before\n+after\n",
      ),
    },
    {
      name: "result.log",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic-log-body-image-first"),
    },
    {
      name: "unsupported.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    },
  ];
  const check = (id, evidence) => ({
    id,
    title: `合成 ${id}`,
    expected: "保留预期与全部关联证据",
    actual: "合成结果，非业务验收",
    status: "passed",
    evidence,
  });
  const report = {
    title: "图片优先合成报告",
    description: "平台合成数据，不代表业务验收",
    verifiedAt: new Date().toISOString(),
    scope: "检查项附件可见性",
    scopeType: "full",
    environment: "isolated-browser-test",
    versions: [],
    checks: [
      check("mixed", [
        "recording.mp4",
        "first.PNG",
        "change.diff",
        "second.png",
        "result.log",
      ]),
      check("images", ["second.png", "first.PNG"]),
      check("other", ["result.log", "unsupported.svg"]),
      check("empty", []),
    ],
    evidence: files.map((file) => ({
      path: file.name,
      description: `合成附件 ${file.name}`,
    })),
  };
  async function submit(title) {
    report.title = title;
    const form = new FormData();
    form.append("submissionId", randomUUID());
    form.append("report", JSON.stringify(report));
    for (const file of files)
      form.append(
        "evidence",
        new Blob([file.buffer], { type: file.mimeType }),
        file.name,
      );
    const response = await fetch(
      `${base}/api/v1/campaigns/${campaign.id}/runs`,
      {
        method: "POST",
        body: form,
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  const run = await submit("图片优先第一轮");
  const second = await submit("图片优先第二轮");
  const url = `${base}/projects/${project.id}/campaigns/${campaign.id}/runs/${run.id}`;
  await page.goto(url);
  const mixed = page.locator('[id="check-mixed"]');
  await mixed.getByRole("button", { name: "人工通过", exact: true }).waitFor();
  assert.equal(
    await mixed.locator("video").count(),
    0,
    "Other evidence previews must not mount before clicking 更多附件",
  );
  const scenarios = ["mixed-default-images-only"];
  const item = (id) => page.locator(`[id="check-${id}"]`);
  const more = (id, count) =>
    item(id).getByRole("button", { name: `更多附件（${count}）`, exact: true });
  const toggle = (id) =>
    item(id).locator(":scope > [data-slot=collapsible-trigger]");
  const imageLabels = (id) =>
    item(id)
      .getByRole("button", { name: /^放大预览 / })
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      );
  const imageOrder = ["放大预览 first.PNG", "放大预览 second.png"];
  assert.deepEqual(await imageLabels("mixed"), imageOrder);
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "false");
  for (const name of ["recording.mp4", "change.diff", "result.log"])
    assert.equal(
      await mixed.getByText(`合成附件 ${name}`, { exact: true }).count(),
      0,
    );
  assert.equal(
    await mixed
      .getByRole("button", { name: "查看代码变更 change.diff" })
      .count(),
    0,
  );
  assert.equal(
    await mixed
      .getByRole("button", { name: "result.log", exact: true })
      .count(),
    0,
  );
  await mixed.screenshot({ path: `${output}/default-images.png` });

  await more("mixed", 3).click();
  assert.deepEqual(await imageLabels("mixed"), imageOrder);
  assert.equal(await mixed.locator("video").count(), 1);
  await mixed.locator("video").evaluate(
    (video) =>
      new Promise((resolve, reject) => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener("loadedmetadata", resolve, { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error("Synthetic video did not load")),
          { once: true },
        );
      }),
  );
  assert.equal(
    await mixed.locator("video").evaluate((video) => video.duration),
    1,
  );
  assert.deepEqual(await mixed.locator("figcaption > span").allTextContents(), [
    "合成附件 recording.mp4",
    "合成附件 change.diff",
    "合成附件 result.log",
  ]);
  assert.equal(
    await mixed
      .getByText("synthetic-log-body-image-first", { exact: true })
      .count(),
    0,
  );
  await mixed.getByRole("button", { name: "result.log", exact: true }).click();
  await mixed
    .getByText("synthetic-log-body-image-first", { exact: true })
    .waitFor();
  await mixed.getByRole("button", { name: "查看代码变更 change.diff" }).click();
  const diff = page.getByRole("dialog", { name: "代码变更", exact: true });
  await diff
    .getByRole("button", { name: "查看原文", exact: true, pressed: false })
    .click();
  await diff
    .getByText("diff --git a/sample.txt b/sample.txt", { exact: false })
    .waitFor();
  await page.keyboard.press("Escape");
  await mixed
    .getByRole("button", { name: "放大预览 first.PNG", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
  await preview.waitFor();
  assert.equal(
    await preview
      .locator("img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await preview.getByRole("button", { name: "放大图片", exact: true }).click();
  assert.equal(await preview.locator("output").innerText(), "150%");
  await page.keyboard.press("Escape");
  scenarios.push(
    "more-reveals-other-evidence-once-in-source-order",
    "video-metadata-and-diff-preview",
    "text-body-requires-second-click",
    "image-preview-and-zoom",
  );
  await mixed.screenshot({ path: `${output}/more-expanded.png` });
  await more("mixed", 3).click();
  assert.equal(await mixed.locator("video").count(), 0);
  assert.deepEqual(await imageLabels("mixed"), imageOrder);
  scenarios.push("collapse-removes-other-previews-keeps-images");

  assert.deepEqual(await imageLabels("images"), [
    "放大预览 second.png",
    "放大预览 first.PNG",
  ]);
  assert.equal(
    await item("images")
      .getByRole("button", { name: /^更多附件/ })
      .count(),
    0,
  );
  assert.equal(await imageLabels("other").then((labels) => labels.length), 0);
  assert.equal(await more("other", 2).getAttribute("aria-expanded"), "false");
  assert.equal(
    await item("other")
      .getByText("此附件格式暂不支持预览。", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await item("empty")
      .getByText("此检查项未关联附件。", { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await item("empty")
      .getByRole("button", { name: /^更多附件/ })
      .count(),
    0,
  );
  scenarios.push(
    "images-only-no-toggle",
    "other-only-initial-toggle",
    "empty-keeps-existing-message",
  );

  await more("mixed", 3).click();
  assert.equal(await more("other", 2).getAttribute("aria-expanded"), "false");
  await more("other", 2).click();
  assert.equal(
    await item("other")
      .getByText("此附件格式暂不支持预览。", { exact: true })
      .isVisible(),
    true,
  );
  await more("mixed", 3).click();
  assert.equal(await more("other", 2).getAttribute("aria-expanded"), "true");
  await more("mixed", 3).click();
  await toggle("mixed").click();
  await toggle("mixed").click();
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "true");
  assert.equal(await mixed.locator("video").count(), 1);
  scenarios.push(
    "checks-expand-independently",
    "state-survives-check-collapse",
  );

  for (const text of ["保留预期与全部关联证据", "合成结果，非业务验收"])
    assert.equal(
      await mixed.getByText(text, { exact: true }).isVisible(),
      true,
    );
  await mixed
    .getByRole("button", { name: "添加检查项评论", exact: true })
    .click();
  await mixed.getByRole("textbox").fill("合成评论，验证原有评审能力");
  await mixed
    .getByRole("button", { name: "保存检查项评论", exact: true })
    .click();
  await mixed
    .getByRole("button", { name: "评审历史 · 1 条", exact: true })
    .click();
  await mixed
    .getByText("合成评论，验证原有评审能力", { exact: true })
    .waitFor();
  await mixed.getByRole("button", { name: "人工通过", exact: true }).click();
  await mixed
    .getByRole("button", {
      name: "撤回到待审",
      exact: true,
      includeHidden: true,
    })
    .waitFor({ state: "attached" });
  await toggle("mixed").click();
  assert.equal(
    await mixed
      .getByRole("button", { name: "撤回到待审", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "true");
  scenarios.push("check-original-fields-comment-history-and-acceptance");

  await page.getByRole("tab", { name: /^文件/ }).click();
  const gallery = page.locator("#report-panel-files");
  assert.equal(await gallery.locator("figure").count(), 6);
  assert.equal(
    await gallery.getByRole("button", { name: /^放大预览 / }).count(),
    2,
  );
  assert.equal(await gallery.locator("video").count(), 1);
  assert.equal(
    await gallery
      .getByRole("button", { name: "查看代码变更 change.diff" })
      .isVisible(),
    true,
  );
  assert.equal(
    await gallery
      .getByText("此附件格式暂不支持预览。", { exact: true })
      .isVisible(),
    true,
  );
  await gallery
    .getByRole("button", { name: "result.log", exact: true })
    .click();
  await gallery
    .getByText("synthetic-log-body-image-first", { exact: true })
    .waitFor();
  await page.getByRole("tab", { name: /^检查清单/ }).click();
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "true");
  scenarios.push(
    "file-tab-preserves-all-attachments-and-previews",
    "tab-switch-preserves-more-state",
  );

  await page.reload();
  await toggle("mixed").click();
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "false");
  await more("mixed", 3).click();
  await page.getByRole("button", { name: /第 2 轮/ }).click();
  await page.waitForURL(`**/runs/${second.id}`);
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "false");
  await more("mixed", 3).click();
  await page.getByRole("button", { name: /第 1 轮/ }).click();
  await page.waitForURL(`**/runs/${run.id}`);
  await toggle("mixed").click();
  assert.equal(await more("mixed", 3).getAttribute("aria-expanded"), "false");
  scenarios.push(
    "refresh-resets-more-state",
    "run-switch-and-return-reset-even-with-same-check-id",
  );

  // Only this scenario injects a legacy/broken reference response. No stored report is mutated.
  await page.route(`**/api/v1/runs/${run.id}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.report.checks.find((check) => check.id === "empty").evidence = [
      "missing.log",
    ];
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await item("empty")
    .getByText("附件清单中未找到 missing.log。", { exact: true })
    .waitFor();
  scenarios.push("injected-missing-reference-keeps-warning");
  return {
    outcome: "passed",
    base,
    projectId: project.id,
    campaignId: campaign.id,
    runId: run.id,
    scenarios,
  };
}
