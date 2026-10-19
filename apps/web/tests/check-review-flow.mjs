// Real browser + isolated Go API. Rejection/network/read delays are explicitly injected.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

export async function run(page, base, output) {
  const origin = new URL(base);
  assert.equal(process.env.ACCEPTANCES_TEST_ISOLATED, "1");
  assert.equal(origin.hostname, "127.0.0.1");
  assert.ok(origin.port && !["5173", "8765"].includes(origin.port));
  const api = async (path, method = "GET", data) => {
    const response = await page.request.fetch(`${base}/api/v1${path}`, {
      method,
      data,
    });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  assert.equal((await api("/projects")).items.length, 0);
  const project = await api("/projects", "POST", {
    name: "连续人工审查合成验证",
  });
  const campaign = await api(`/projects/${project.id}/campaigns`, "POST", {
    title: "独立服务与临时数据",
  });
  const results = [];
  const check = (id) => page.locator(`[id="check-${id}"]`);
  const trigger = (id) =>
    check(id).locator(":scope > [data-slot=collapsible-trigger]");
  const button = (id, name) =>
    check(id).getByRole("button", { name, exact: true });
  async function waitFor(test, message) {
    const deadline = Date.now() + 10000;
    while (!(await test())) {
      assert.ok(Date.now() < deadline, message);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  async function open(id, value) {
    if ((await trigger(id).getAttribute("aria-expanded")) !== String(value))
      await trigger(id).click();
  }
  async function focused(id) {
    await waitFor(
      () =>
        trigger(id).evaluate((element) => document.activeElement === element),
      `Expected navigation focus on ${id}`,
    );
    assert.equal(await trigger(id).getAttribute("aria-expanded"), "true");
    const bounds = await trigger(id).boundingBox();
    const tabs = await page
      .getByRole("tablist", { name: "报告视图" })
      .boundingBox();
    const bar = await page.locator(".review-bar").boundingBox();
    assert.ok(
      bounds.y >= tabs.y + tabs.height - 1,
      "Target must clear sticky report tabs",
    );
    assert.ok(
      bounds.y + bounds.height < bar.y,
      "Target must clear bottom review bar",
    );
  }
  async function select(name, option) {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option }).click();
  }
  async function createRun(name) {
    await page.unrouteAll({ behavior: "wait" });
    const report = {
      title: name,
      description: "平台合成数据，不代表业务验收",
      verifiedAt: new Date().toISOString(),
      scope: "逐项人工审查交互",
      scopeType: "full",
      environment: "isolated-browser-test",
      versions: [],
      checks: [
        "earlier",
        "current",
        "accepted",
        "rejected",
        "tail",
        "outside",
      ].map((id) => ({
        id,
        title: `${id === "outside" ? "其他分组" : "连续审查"} ${id}`,
        expected: "检查项保留原始结果与证据",
        actual: Array.from(
          { length: 15 },
          (_, i) => `合成验证结果 ${i + 1}`,
        ).join("\n"),
        status: id === "tail" ? "failed" : "passed",
        evidence: [],
      })),
      evidence: [],
    };
    const response = await page.request.post(
      `${base}/api/v1/campaigns/${campaign.id}/runs`,
      {
        multipart: {
          submissionId: randomUUID(),
          report: JSON.stringify(report),
        },
      },
    );
    assert.equal(response.status(), 201, await response.text());
    const run = await response.json();
    await api(`/runs/${run.id}/reviews`, "POST", {
      checkId: "accepted",
      kind: "accepted",
      body: "",
    });
    await api(`/runs/${run.id}/reviews`, "POST", {
      checkId: "rejected",
      kind: "rejected",
      body: "合成未通过理由",
    });
    await page.goto(
      `${base}/projects/${project.id}/campaigns/${campaign.id}/runs/${run.id}`,
    );
    await button("current", "人工通过").waitFor();
    return run;
  }

  const first = await createRun("通过后前进、隐藏按钮与撤回");
  await open("rejected", false);
  await button("current", "人工通过").click();
  await focused("rejected");
  assert.equal(await trigger("current").getAttribute("aria-expanded"), "false");
  await open("current", true);
  for (const name of ["人工通过", "人工不通过", "添加检查项评论"])
    assert.equal(await button("current", name).count(), 0);
  await button("current", "撤回到待审").click();
  await button("current", "人工通过").waitFor();
  assert.equal(
    (await api(`/runs/${first.id}`)).checkReviews.find(
      (item) => item.checkId === "current",
    ).status,
    "pending",
  );
  results.push(
    "forward-skip-accepted-include-rejected",
    "hide-actions-and-withdraw",
  );

  const wrap = await createRun("末尾回跳与异常结果理由");
  await page.getByRole("searchbox", { name: "搜索检查项" }).fill("连续审查");
  await open("earlier", false);
  await button("tail", "人工通过").click();
  await check("tail").getByRole("textbox").fill("已核对原始失败，合成理由");
  await button("tail", "确认人工通过").click();
  await focused("earlier");
  assert.equal(await trigger("tail").getAttribute("aria-expanded"), "false");
  assert.ok(
    (await api(`/runs/${wrap.id}`)).reviews.some(
      (review) =>
        review.checkId === "tail" &&
        review.kind === "accepted" &&
        review.body === "已核对原始失败，合成理由",
    ),
  );
  results.push("wrap-to-first-unaccepted", "failed-result-reason-preserved");

  await createRun("保留三种筛选与筛选内完成");
  await page.getByRole("searchbox", { name: "搜索检查项" }).fill("连续审查");
  await select("原始验证结果筛选", /^通过 /);
  await select("人工评审状态筛选", /^待审 /);
  await open("current", false);
  await button("earlier", "人工通过").click();
  await focused("current");
  assert.equal(await check("earlier").count(), 0);
  assert.equal(await check("rejected").count(), 0);
  assert.equal(await check("outside").count(), 0);
  assert.equal(
    await page.getByRole("searchbox", { name: "搜索检查项" }).inputValue(),
    "连续审查",
  );
  assert.match(
    await page
      .getByRole("combobox", { name: "原始验证结果筛选", exact: true })
      .innerText(),
    /^通过 /,
  );
  assert.match(
    await page
      .getByRole("combobox", { name: "人工评审状态筛选", exact: true })
      .innerText(),
    /^待审 /,
  );
  await button("current", "人工通过").click();
  await page
    .getByRole("status")
    .filter({ hasText: "当前筛选内的检查项已全部人工通过。" })
    .waitFor();
  assert.equal(await page.locator(".check-item").count(), 0);
  results.push(
    "preserve-search-result-and-human-filters",
    "filtered-completion",
  );

  for (const mode of ["rejected", "unknown"]) {
    const run = await createRun(`${mode} 保留草稿与当前项`);
    await page.route(`**/runs/${run.id}/reviews`, (route) =>
      mode === "rejected"
        ? route.fulfill({
            status: 400,
            json: { code: "BODY_REQUIRED", message: "合成拒绝" },
          })
        : route.abort("failed"),
    );
    await button("tail", "人工通过").click();
    await check("tail").getByRole("textbox").fill("失败后应保留的理由");
    await button("tail", "确认人工通过").click();
    await check("tail").getByRole("alert").waitFor();
    assert.equal(await trigger("tail").getAttribute("aria-expanded"), "true");
    assert.equal(
      await check("tail").getByRole("textbox").inputValue(),
      "失败后应保留的理由",
    );
    assert.equal(
      (await api(`/runs/${run.id}`)).checkReviews.find(
        (item) => item.checkId === "tail",
      ).status,
      "pending",
    );
    results.push(`${mode}-keeps-current-and-draft`);
  }

  for (const mode of ["delayed", "failed"]) {
    const run = await createRun(`${mode} 保存后的状态回读`);
    await open("rejected", false);
    let release;
    let reading;
    const started = new Promise((resolve) => {
      reading = resolve;
    });
    const released = new Promise((resolve) => {
      release = resolve;
    });
    let intercept = true;
    await page.route(`**/api/v1/runs/${run.id}`, async (route) => {
      if (!intercept) return route.continue();
      reading();
      if (mode === "failed")
        return route.fulfill({
          status: 500,
          json: { message: "合成回读失败" },
        });
      await released;
      return route.continue();
    });
    await button("current", "人工通过").click();
    await started;
    await waitFor(
      () =>
        trigger("current")
          .getAttribute("aria-expanded")
          .then((value) => value === "false"),
      "Commit should collapse current item",
    );
    assert.equal(
      await trigger("rejected").getAttribute("aria-expanded"),
      "false",
    );
    if (mode === "delayed") release();
    else {
      await page
        .getByRole("alert")
        .filter({ hasText: "已保存，状态刷新失败" })
        .waitFor();
      intercept = false;
      await page.getByRole("button", { name: "重试刷新", exact: true }).click();
    }
    await focused("rejected");
    results.push(`${mode}-read-waits-for-confirmation`);
  }
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/next-review.png` });
  }
  return {
    outcome: "passed",
    base,
    scenarios: results,
    projectId: project.id,
    campaignId: campaign.id,
  };
}
