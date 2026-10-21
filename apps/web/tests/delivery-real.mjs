/** Real Web + isolated Go HTTP, using clearly synthetic platform fixtures only. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const digest = (data) => createHash("sha256").update(data).digest("hex");
async function reportImageDecodes(scope) {
  return scope.locator("svg defs image").evaluate(async (element) => {
    const image = new Image();
    image.src = element.getAttribute("href");
    await image.decode();
    return (
      image.naturalWidth > 0 &&
      document.querySelectorAll("svg.screenshot use").length > 0
    );
  });
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const tag = Buffer.from(kind);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, checksum]);
}
function fixtureImage() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 40, 60, 90, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function seed(base) {
  const origin = new URL(base);
  assert(
    process.env.ACCEPTANCES_TEST_ISOLATED === "1",
    "Explicit isolated-test flag required",
  );
  assert(
    origin.hostname === "127.0.0.1" && origin.port && origin.port !== "8765",
    "Use an isolated loopback port",
  );
  const api = async (path, method = "GET", body) => {
    const response = await fetch(base + "/api/v1" + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert(
      response.ok,
      path + ": " + response.status + " " + (await response.clone().text()),
    );
    return response.status === 204 ? undefined : response.json();
  };
  const projects = await api("/projects");
  assert(
    projects.items.length === 0,
    "Fixture seeding requires a new empty test database",
  );
  const project = await api("/projects", "POST", {
    name: "交付功能合成测试",
    description: "仅平台 fixture，不是业务验收",
  });
  const campaign = await api("/projects/" + project.id + "/campaigns", "POST", {
    title: "平台交付与说明验证",
    description: "隔离服务，合成数据，真实浏览器与 Go API",
  });
  const versions = [
    {
      repository: "synthetic-fixture-source",
      commit: "a".repeat(40),
      dirty: false,
    },
  ];
  const expected = "显示合成示例下载结果";
  const requirement = Buffer.from(
    "平台合成需求，仅验证交付工作流与文档安全，不代表业务执行。",
  );
  const image = fixtureImage();
  const build = Buffer.from(
    "Synthetic build fixture, not an actual business build.",
  );
  const map = {
    schemaVersion: 1,
    projectId: project.id,
    requirementSha256: digest(requirement),
    excluded: [],
    features: [
      {
        id: "fixture-export",
        title: "示例导出",
        checks: [
          {
            id: "fixture-export--download",
            title: "示例下载",
            expected,
            required: true,
          },
          {
            id: "fixture-export--compatibility",
            title: "兼容场景",
            expected: "保留未执行限制",
            required: true,
          },
        ],
      },
    ],
  };
  const mapBytes = Buffer.from(JSON.stringify(map));
  const materials = {
    schemaVersion: 1,
    projectId: project.id,
    requirementSha256: digest(requirement),
    mapSha256: digest(mapBytes),
    features: [
      {
        featureId: "fixture-export",
        summary: "平台合成说明。<script>window.deliveryInjected=true</script>",
        roles: ["合成测试角色"],
        prerequisites: ["打开示例界面"],
        steps: [
          {
            instruction: "选择示例导出。",
            expected,
            checkIds: ["fixture-export--download"],
          },
        ],
        limitations: ["兼容场景为预设阻塞，未执行业务验证。"],
        screenshots: [
          {
            path: "screen.png",
            caption: "合成图片，仅验证素材关联及离线内嵌",
            checkIds: ["fixture-export--download"],
          },
        ],
        screenshotOmissionReason: "",
      },
    ],
  };
  const materialBytes = Buffer.from(JSON.stringify(materials));
  const manifest = {
    schemaVersion: 1,
    projectId: project.id,
    campaignId: campaign.id,
    requirement: { path: "requirement.md", sha256: digest(requirement) },
    map: { path: "feature-map.json", sha256: digest(mapBytes) },
    materials: {
      path: "business-materials.json",
      sha256: digest(materialBytes),
    },
    build: {
      kind: "artifact",
      id: "synthetic-platform-fixture",
      artifact: { path: "build.txt", sha256: digest(build) },
      sources: versions,
      reason: "",
    },
  };
  const files = {
    "requirement.md": requirement,
    "feature-map.json": mapBytes,
    "business-materials.json": materialBytes,
    "delivery-manifest.json": Buffer.from(JSON.stringify(manifest)),
    "build.txt": build,
    "screen.png": image,
  };
  const report = {
    title: "明确标注的合成平台报告",
    description: "预设结果，仅用于隔离 UI/API 契约测试",
    verifiedAt: new Date().toISOString(),
    scopeType: "full",
    scope: "完整覆盖合成 fixture，非业务需求",
    environment: "isolated platform fixture",
    versions,
    checks: [
      {
        id: "fixture-export--download",
        title: "示例下载",
        expected,
        actual: "合成预设结果",
        status: "passed",
        evidence: ["screen.png"],
      },
      {
        id: "fixture-export--compatibility",
        title: "兼容场景",
        expected: "保留未执行限制",
        actual: "合成预设阻塞，未运行",
        status: "blocked",
        evidence: [],
      },
    ],
    evidence: Object.keys(files).map((path) => ({
      path,
      description: "合成测试附件 " + path,
    })),
  };
  const body = new FormData();
  body.set("submissionId", randomUUID());
  body.set("report", JSON.stringify(report));
  for (const [name, bytes] of Object.entries(files))
    body.append("evidence", new Blob([bytes]), name);
  const response = await fetch(
    base + "/api/v1/campaigns/" + campaign.id + "/runs",
    { method: "POST", body },
  );
  assert(
    response.status === 201,
    "Fixture publish failed: " + (await response.clone().text()),
  );
  const run = await response.json();
  return { project, campaign, run };
}

export async function run(page, base, output, fixture) {
  assert(
    process.env.ACCEPTANCES_TEST_ISOLATED === "1",
    "Isolated-test flag required",
  );
  await mkdir(output, { recursive: true });
  const errors = [],
    external = [],
    steps = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (
      !url.startsWith(base) &&
      !url.startsWith("data:") &&
      !url.startsWith("file:") &&
      !url.startsWith("about:")
    )
      external.push(url);
  });
  const api = async (path, method = "GET", data) => {
    const response = await page.request.fetch(base + "/api/v1" + path, {
      method,
      data,
    });
    assert(
      response.ok(),
      path + ": " + response.status() + " " + (await response.text()),
    );
    return response.status() === 204 ? undefined : response.json();
  };
  const record = async (name) => {
    const path = join(output, name + ".png");
    await page.screenshot({ path, fullPage: true });
    steps.push({ name, outcome: "passed", evidence: [path] });
  };
  await page.goto(
    base +
      "/projects/" +
      fixture.project.id +
      "/campaigns/" +
      fixture.campaign.id +
      "/runs/" +
      fixture.run.id,
  );
  await page.getByRole("button", { name: "全部人工通过", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认全部人工通过", exact: true })
    .click();
  await page.getByRole("button", { name: "确认需求交付", exact: true }).click();
  const stepTabs = page.locator('[data-slot="stepper-trigger"]');
  await stepTabs.first().waitFor();
  assert.equal(
    await stepTabs.count(),
    4,
    "Expected four delivery preparation steps",
  );
  for (const tab of await stepTabs.all()) {
    assert(
      await tab.isDisabled(),
      "Step indicators must not bypass preparation",
    );
  }
  assert.equal(await stepTabs.nth(0).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  assert.equal(await stepTabs.nth(1).getAttribute("aria-selected"), "true");
  const next = page.getByRole("button", { name: "下一步", exact: true });
  await page.getByLabel("我确认所选地图版本及必验范围准确、完整。").check();
  await next.click();
  await page
    .getByLabel("我已审阅功能说明、操作步骤、角色前提、限制和对应截图。")
    .check();
  await next.click();
  const confirm = page.getByRole("button", {
    name: "确认交付并保存快照",
    exact: true,
  });
  await confirm.waitFor();
  assert(
    !(await confirm.isEnabled()),
    "Freeze enabled without explicit confirmations",
  );
  await page
    .getByLabel("我已检查说明素材和截图中的敏感信息，确认可用于业务说明。")
    .check();
  assert(
    !(await confirm.isEnabled()),
    "Freeze enabled without an exception reason",
  );
  await page
    .getByRole("textbox")
    .fill("合成测试明确接受预设阻塞，保留未验证限制。");
  await record("freeze-confirmation");
  await confirm.click();
  await page.waitForURL(/\/deliveries\/[a-f0-9-]+$/);
  const deliveryID = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByRole("button", { name: "生成测试报告", exact: true }).click();
  await page
    .getByRole("button", { name: "预览测试报告 v1", exact: true })
    .waitFor();
  await record("generated-document");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "下载测试报告 HTML v1", exact: true })
    .click();
  const download = await downloadEvent;
  const htmlPath = join(output, "business-document-v1.html");
  await download.saveAs(htmlPath);
  const html = await readFile(htmlPath, "utf8");
  assert(
    html.includes("data:image/png;base64,") &&
      html.includes("&lt;script&gt;") &&
      !html.includes("<script>"),
    "Unsafe or externally dependent document",
  );
  const documents = await api("/deliveries/" + deliveryID + "/documents");
  assert(
    documents.items.length === 1 && digest(html) === documents.items[0].sha256,
    "Document version/digest mismatch",
  );
  await page
    .getByRole("button", { name: "预览测试报告 v1", exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="测试报告预览"]');
  await frame.getByRole("heading", { name: "示例导出", exact: true }).waitFor();
  assert(
    (await frame.locator("script").count()) === 0,
    "Input script reached the preview DOM",
  );
  assert(await reportImageDecodes(frame), "Embedded screenshot failed to load");
  await record("sandbox-preview");
  assert(
    (await page.getByRole("dialog").boundingBox()).width >= 1000,
    "Desktop preview remained narrow",
  );
  await page.keyboard.press("Escape");
  assert(
    await page
      .getByRole("button", { name: "预览测试报告 v1", exact: true })
      .evaluate((button) => document.activeElement === button),
    "Preview close did not restore focus",
  );
  await page
    .getByRole("button", { name: "生成新版测试报告", exact: true })
    .click();
  await page
    .getByRole("button", { name: "预览测试报告 v2", exact: true })
    .waitFor();
  const guidePath = await verifyBusinessGuide(
    page,
    base,
    output,
    deliveryID,
    api,
    record,
  );

  await page.goto(
    base +
      "/projects/" +
      fixture.project.id +
      "/campaigns/" +
      fixture.campaign.id +
      "/runs/" +
      fixture.run.id,
  );
  await page.getByText("已交付 v1", { exact: false }).waitFor();
  const nextReport = structuredClone(fixture.run.report);
  nextReport.scopeType = "partial";
  nextReport.evidence = [];
  for (const check of nextReport.checks) check.evidence = [];
  const nextResponse = await page.request.post(
    base + "/api/v1/campaigns/" + fixture.campaign.id + "/runs",
    {
      multipart: {
        submissionId: randomUUID(),
        report: JSON.stringify(nextReport),
      },
    },
  );
  assert(nextResponse.status() === 201, await nextResponse.text());
  const nextRun = await nextResponse.json();
  await page.goto(
    base +
      "/projects/" +
      fixture.project.id +
      "/campaigns/" +
      fixture.campaign.id +
      "/runs/" +
      nextRun.id,
  );
  await page
    .getByText("当前有效交付 v1 来源于历史验证记录。", { exact: false })
    .waitFor();
  assert(
    (await api("/deliveries/" + deliveryID)).status === "valid",
    "New pending Run invalidated prior frozen version",
  );
  assert(
    (await page
      .getByRole("button", { name: "确认需求交付", exact: true })
      .count()) === 0 &&
      (await page
        .getByRole("button", { name: "查看交付准备", exact: true })
        .isEnabled()),
    "Pending partial Run must keep preparation accessible without granting confirmation",
  );
  await record("new-run-keeps-frozen-version");
  await page
    .getByRole("button", { name: "查看交付与文档", exact: true })
    .click();
  await page
    .getByRole("button", { name: "预览测试报告 v2", exact: true })
    .waitFor();
  await api("/runs/" + fixture.run.id + "/reviews", "POST", {
    checkId: "fixture-export--download",
    kind: "pending",
    body: "Synthetic withdrawal test",
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page
    .getByText("此交付已失效、撤销或被替代。", { exact: false })
    .waitFor();
  assert(
    !(await page
      .getByRole("button", { name: "生成新版测试报告", exact: true })
      .isEnabled()),
    "Inactive delivery can generate",
  );
  await record("automatic-invalidation");
  const preview = await api(
    "/projects/" + fixture.project.id + "/delete-preview",
  );
  assert(
    preview.retainedDeliveries === 1 && preview.retainedDocuments === 3,
    "Deletion omitted retained artifacts",
  );
  const archiveURL = page.url();
  await page.goto(`${base}/projects/${fixture.project.id}`);
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByText(/保留 1 份交付快照及 3 份交付文档/)
    .waitFor();
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/projects/${fixture.project.id}`),
  );
  await page.getByRole("button", { name: "确认永久删除", exact: true }).click();
  assert((await deleted).status() === 204, "Project deletion did not commit");
  await page.waitForURL(base + "/");
  await page.goto(archiveURL);
  await page.getByText("来源验证记录已删除", { exact: false }).waitFor();
  const retained = await api("/deliveries/" + deliveryID);
  assert(
    retained.sourceRunAvailable === false &&
      retained.payload.run.report.checks[1].status === "blocked",
    "Archive lost source facts",
  );
  await record("deleted-source-retention");
  await page.getByRole("button", { name: "交付版本", exact: true }).click();
  await page
    .getByRole("button", { name: "查看交付与文档", exact: true })
    .first()
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Archive overflows mobile viewport",
  );
  await record("archive-mobile");
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(htmlPath).href);
  await page.getByRole("heading", { name: "示例导出", exact: true }).waitFor();
  assert(
    await reportImageDecodes(page),
    "Downloaded document cannot load images offline",
  );
  assert(
    (await page.locator("script").count()) === 0,
    "Offline document contains executable input script",
  );
  await record("offline-html");
  await page.goto(pathToFileURL(guidePath).href);
  await page
    .getByRole("heading", { name: "订单业务使用指南", exact: true })
    .waitFor();
  await page.locator("#page-1 > summary").click();
  assert(
    await page
      .locator("#page-1 img")
      .first()
      .evaluate((image) => image.complete && image.naturalWidth > 0),
    "Offline guide image failed",
  );
  await record("offline-business-guide");
  await page.context().setOffline(false);
  assert(errors.length === 0, "Browser errors: " + errors.join("; "));
  assert(
    external.length === 0,
    "Unexpected external requests: " + external.join("; "),
  );
  const receipt = {
    fixture: "synthetic-platform-only",
    base,
    deliveryID,
    htmlPath,
    steps,
    errors,
    external,
  };
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  return receipt;
}

async function verifyBusinessGuide(
  page,
  base,
  output,
  deliveryID,
  api,
  record,
) {
  const source = {
    schemaVersion: 1,
    title: "订单业务使用指南",
    summary: "了解订单入口、状态与操作方法。",
    modules: [{ title: "订单管理", description: "查看订单处理进度。" }],
    pages: [
      {
        audience: "业务人员",
        title: "订单列表",
        entry: "工作台 → 订单",
        instruction: "查看状态列。",
        images: [
          {
            path: "screen.png",
            caption: "合成状态页面",
            kind: "sample",
            annotations: [
              { x: 10, y: 10, width: 20, height: 20, label: "状态列" },
            ],
          },
        ],
      },
    ],
    sections: [
      {
        title: "查看状态",
        summary: "通过演示样例确认展示效果。",
        blocks: [
          { kind: "steps", items: ["打开订单列表，查看状态列。"] },
          {
            kind: "table",
            columns: ["状态", "含义"],
            rows: [
              ["等待中", "订单正在等待处理。"],
              ["已完成", "订单处理完成。"],
            ],
          },
          { kind: "note", text: "演示样例只供确认展示。" },
        ],
      },
    ],
    review: ["状态名称是否清楚？"],
    limitations: ["本次只查看展示，不发起实际处理。"],
  };
  await page.getByText("整理或更新指南内容", { exact: true }).click();
  await page.getByLabel("导入指南素材 JSON", { exact: true }).setInputFiles({
    name: "business-guide.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByText(/待生成素材：business-guide.json/).waitFor();
  let lost = false;
  const pattern = "**/api/v1/deliveries/" + deliveryID + "/documents";
  const handler = async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.kind === "business_guide" &&
      !lost
    ) {
      lost = true;
      const response = await route.fetch();
      assert(
        response.status() === 201,
        "Guide generation did not commit before lost response",
      );
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route(pattern, handler);
  await page.getByRole("button", { name: "生成业务指南", exact: true }).click();
  await page
    .getByRole("button", { name: "确认上次生成结果", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "确认上次生成结果", exact: true })
    .click();
  await page
    .getByRole("button", { name: "生成新版业务指南", exact: true })
    .waitFor();
  await page.unroute(pattern, handler);
  const guides = await api(
    "/deliveries/" + deliveryID + "/documents?kind=business_guide",
  );
  const reports = await api(
    "/deliveries/" + deliveryID + "/documents?kind=test_report",
  );
  assert(
    guides.items.length === 1 &&
      guides.items[0].version === 1 &&
      reports.items.length === 2 &&
      reports.items[0].version === 2,
    "Guide/report versions mixed or lost-response request duplicated",
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "下载业务指南 HTML v1", exact: true })
    .click();
  const download = await downloading;
  assert(
    download.suggestedFilename() === "business-guide-v1.html",
    "Guide download filename incorrect",
  );
  const path = join(output, "business-guide-v1.html");
  await download.saveAs(path);
  const html = await readFile(path, "utf8");
  assert(
    digest(html) === guides.items[0].sha256 &&
      !html.includes("验证依据") &&
      !html.includes("代码来源"),
    "Guide has report metadata or incorrect digest",
  );
  await page
    .getByRole("button", { name: "预览业务指南 v1", exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="业务指南预览"]');
  await frame
    .getByRole("heading", { name: "订单业务使用指南", exact: true })
    .waitFor();
  await frame.getByText("等待中", { exact: true }).waitFor();
  await frame.locator("#page-1 > summary").click();
  await frame.getByText("演示样例", { exact: true }).waitFor();
  await frame
    .getByText("放大查看完整页面（可横向滚动）", { exact: true })
    .click();
  assert(
    await frame
      .locator(".image-zoom[open] img")
      .evaluate((image) => image.complete && image.naturalWidth > 0),
    "Guide enlarged screenshot failed",
  );
  await frame
    .getByRole("checkbox", { name: "状态名称是否清楚？", exact: true })
    .check();
  await record("business-guide-preview");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await frame
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth + 1),
    "Guide overflows narrow viewport",
  );
  await record("business-guide-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "预览业务指南 v1", exact: true })
      .evaluate((el) => el === document.activeElement),
    "Guide preview focus not restored",
  );
  return path;
}
