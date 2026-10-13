// Real browser seam with controlled HTTP. No ordinary application data is read.
import assert from "node:assert/strict";
import { run as runNavigation } from "./run-target-navigation.mjs";
export const scenarios = [
  "B01",
  "B02",
  "B03",
  "B04",
  "B05",
  "B06",
  "B07-empty",
  "B07-latest",
  "B07-history",
  "B07-explicit",
  "B07-loading",
  "B07-failure",
  "B08",
  "B09-empty-default",
  "B09-history",
  "B09-latest",
  "B10-late",
  "B10-external",
  "B10-external-default",
  "B11-cleanup",
  "B11-unknown",
  "B11-unknown-present",
  "B11-unknown-read-failure",
  "B12",
  "B13-campaign",
  "B13-runs",
  "B13-campaigns",
  "B14",
  "B15-parent-missing-retry",
];
const createdAt = "2026-10-13T00:00:00Z";
const project = {
  id: "refresh-project",
  name: "刷新测试项目",
  description: "",
  createdAt,
};
const campaign = {
  id: "refresh-campaign",
  projectId: project.id,
  title: "刷新测试需求",
  description: "",
  status: "pending",
  latestRunId: "first",
  createdAt,
};
const campaignPath = `/projects/${project.id}/campaigns/${campaign.id}`;
function makeRun(id) {
  return {
    id,
    campaignId: campaign.id,
    submissionId: id,
    createdAt,
    status: "pending",
    voidReason: "",
    report: {
      title: `${id} 报告`,
      description: "刷新隔离数据",
      verifiedAt: createdAt,
      scope: "刷新",
      scopeType: "full",
      environment: "test",
      versions: [],
      checks: ["one", "two"].map((id) => ({
        id,
        title: id,
        expected: "预期",
        actual: "实际",
        status: "passed",
        evidence: [],
      })),
      evidence: [],
    },
    reviews: [],
    checkReviews: [],
    reviewCounts: { accepted: 0, pending: 2, rejected: 0 },
    feedbackResponses: [],
  };
}
export async function run(page, base, scenario = "B02") {
  if (!scenarios.includes(scenario))
    throw new Error(`Unknown refresh scenario: ${scenario}`);
  if (scenario === "B12")
    return {
      scenario,
      status: "passed",
      navigation: await runNavigation(page, base, "refresh"),
    };
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const writeCompleted = deferred();
  const writeStarted = deferred(),
    writeGate = deferred(),
    runStarted = deferred(),
    runGate = deferred(),
    peripheralStarted = deferred(),
    peripheralGate = deferred();
  let holdWrite = ["B04", "B08", "B10-late"].includes(scenario),
    holdRead = scenario === "B04",
    holdPeripheral = scenario === "B04";
  const activeCampaign = structuredClone(campaign);
  const first = makeRun("first"),
    second = makeRun("second");
  let runs = [first];
  const writes = [];
  const requests = [];
  let failList = scenario === "B07-failure";
  let failRun = false;
  let deleted = false;
  let peripheralFailure = "";
  let parentFailure;
  if (scenario === "B14") {
    first.report.checks[1].status = "failed";
    first.checkReviews = [
      { checkId: "two", status: "rejected", lastReviewId: "old" },
    ];
    first.reviewCounts = { accepted: 0, pending: 1, rejected: 1 };
  }
  const oldRuns = structuredClone(runs);
  if (scenario.startsWith("B07-")) {
    if (scenario !== "B07-latest") activeCampaign.latestRunId = "";
    if (scenario === "B07-empty") runs = [];
    if (scenario === "B07-explicit") deleted = true;
  }
  if (scenario.startsWith("B09-history")) {
    activeCampaign.latestRunId = "";
    runs = [first, second];
    second.status = "accepted";
    second.reviewCounts = { accepted: 2, pending: 0, rejected: 0 };
  }
  if (scenario.startsWith("B09-latest")) {
    activeCampaign.latestRunId = "second";
    runs = [second, first];
  }
  const refresh = async () => {
    await page.getByRole("button", { name: "需求操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "刷新报告" }).click();
  };
  await page.context().route("**/api/**", async (route) => {
    const req = route.request();
    const endpoint = new URL(req.url()).pathname.replace("/api/v1", "");
    requests.push({ method: req.method(), endpoint });
    if (req.method() !== "GET") {
      writes.push({ endpoint, method: req.method(), body: req.postDataJSON() });
      writeStarted.resolve();
      if (holdWrite) await writeGate.promise;
      if (req.method() === "DELETE" && endpoint === "/runs/first") {
        if (
          scenario === "B11-unknown-present" ||
          scenario === "B11-unknown-read-failure"
        ) {
          failRun = scenario === "B11-unknown-read-failure";
          return route.abort("failed");
        }
        deleted = true;
        runs = runs.filter((run) => run.id !== "first");
        if (activeCampaign.latestRunId === "first")
          activeCampaign.latestRunId = "";
        if (scenario === "B11-cleanup")
          return route.fulfill({
            status: 500,
            json: {
              code: "EVIDENCE_CLEANUP_FAILED",
              message: "cleanup failed",
            },
          });
        if (scenario === "B11-unknown") return route.abort("failed");
        await route.fulfill({ status: 204 });
        writeCompleted.resolve();
        return;
      }
      if (endpoint === "/runs/first/accept-all") {
        first.status = "accepted";
        first.reviewCounts = { accepted: 2, pending: 0, rejected: 0 };
        first.checkReviews = first.report.checks.map((check) => ({
          checkId: check.id,
          status: "accepted",
          lastReviewId: "bulk",
        }));
        return route.fulfill({ json: first });
      }
      if (endpoint === "/runs/first/reviews") {
        const input = req.postDataJSON();
        first.reviews.push({
          ...input,
          id: "review-one",
          runId: "first",
          createdAt,
          legacy: false,
        });
        failRun = scenario === "B02";
        if (scenario.startsWith("B13-")) {
          peripheralFailure = scenario.slice(4);
          first.reviewCounts = { accepted: 1, pending: 1, rejected: 0 };
          first.checkReviews = [
            { checkId: "one", status: "accepted", lastReviewId: "review-one" },
          ];
        }
        if (scenario === "B03") return route.abort("failed");
        await route.fulfill({ status: 201, json: first.reviews.at(-1) });
        writeCompleted.resolve();
        return;
      }
      return route.fulfill({
        status: 400,
        json: { code: "INVALID_INPUT", message: "unexpected write" },
      });
    }
    if (failList && endpoint === `/campaigns/${campaign.id}/runs`)
      return route.fulfill({
        status: 500,
        json: { code: "READ_FAILED", message: "列表读取失败" },
      });
    if (
      scenario === "B07-loading" &&
      endpoint === `/campaigns/${campaign.id}/runs`
    ) {
      runStarted.resolve();
      await runGate.promise;
    }
    if (writes.length && endpoint === "/runs/first" && holdRead) {
      runStarted.resolve();
      await runGate.promise;
    }
    if (
      writes.length &&
      endpoint === `/campaigns/${campaign.id}` &&
      holdPeripheral
    ) {
      peripheralStarted.resolve();
      await peripheralGate.promise;
    }
    if (endpoint === "/runs/first/delete-preview")
      return route.fulfill({
        json: { projects: 0, campaigns: 0, runs: 1, evidence: 0, reviews: 0 },
      });
    if (endpoint === "/runs/first" && deleted)
      return route.fulfill({
        status: 404,
        json: { code: "NOT_FOUND", message: "not found" },
      });
    if (endpoint === "/runs/first" && failRun)
      return route.fulfill({
        status: 500,
        json: { code: "READ_FAILED", message: "读取测试失败" },
      });
    if (parentFailure && endpoint === `/projects/${project.id}/campaigns`) {
      if (parentFailure === "network") return route.abort("failed");
      return route.fulfill({
        status: parentFailure,
        json: { code: "READ_FAILED", message: "父级读取失败" },
      });
    }
    const failPath = {
      campaign: `/campaigns/${campaign.id}`,
      runs: `/campaigns/${campaign.id}/runs`,
      campaigns: `/projects/${project.id}/campaigns`,
    }[peripheralFailure];
    if (endpoint === failPath)
      return route.fulfill({
        status: 500,
        json: { code: "READ_FAILED", message: "外围读取测试失败" },
      });
    const responses = {
      "/projects": {
        items: [project, { ...project, id: "other", name: "另一项目" }],
      },
      "/projects/other": { ...project, id: "other", name: "另一项目" },
      "/projects/other/repositories": { items: [] },
      "/projects/other/campaigns": { items: [] },
      [`/projects/${project.id}`]: project,
      [`/projects/${project.id}/repositories`]: { items: [] },
      [`/projects/${project.id}/campaigns`]: { items: [activeCampaign] },
      [`/campaigns/${campaign.id}`]: activeCampaign,
      [`/campaigns/${campaign.id}/runs`]: {
        items: scenario.startsWith("B13-") ? oldRuns : runs,
      },
      "/runs/first": first,
      "/runs/second": second,
    };
    if (!(endpoint in responses)) throw new Error(`Unexpected GET ${endpoint}`);
    return route.fulfill({ json: responses[endpoint] });
  });
  await page.goto(
    base +
      campaignPath +
      (scenario === "B09-empty-default" ||
      scenario === "B10-external-default" ||
      (scenario.startsWith("B07-") && scenario !== "B07-explicit")
        ? ""
        : "/runs/first"),
  );
  if (scenario === "B15-parent-missing-retry") {
    await page.getByText("first 报告", { exact: true }).first().waitFor();
    parentFailure = 404;
    await refresh();
    await page.getByText("该项目已不存在。", { exact: false }).waitFor();
    for (const failure of [500, "network"]) {
      parentFailure = failure;
      const response = page.waitForEvent(
        failure === "network" ? "requestfailed" : "response",
        (event) => event.url().endsWith(`/projects/${project.id}/campaigns`),
      );
      await page.getByRole("button", { name: "重试列表", exact: true }).click();
      await response;
      await page.getByText("需求列表刷新失败：", { exact: false }).waitFor();
      assert.equal(
        await page.getByText("该项目已不存在。", { exact: false }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("main", { name: "需求与验证报告" })
          .getByText("first 报告", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.getByRole("form", { name: "整轮评论" }).count(),
        0,
      );
    }
    parentFailure = undefined;
    await page.getByRole("button", { name: "重试列表", exact: true }).click();
    await page.getByText("first 报告", { exact: true }).first().waitFor();
    assert.equal(
      await page.locator('[aria-label="整轮评论"] textarea').isEnabled(),
      true,
    );
    assert.equal(writes.length, 0);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario.startsWith("B07-")) {
    await page
      .getByRole("heading", { name: activeCampaign.title, exact: true })
      .waitFor();
    if (scenario === "B07-loading") {
      await runStarted.promise;
      assert.equal(
        await page.getByText("暂无验证。", { exact: false }).count(),
        0,
      );
      runGate.resolve();
    }
    if (scenario === "B07-failure") {
      await page.getByText("列表读取失败", { exact: false }).first().waitFor();
      assert.equal(
        await page.getByText("暂无验证。", { exact: false }).count(),
        0,
      );
      failList = false;
      await page
        .getByRole("button", { name: "重试刷新", exact: true })
        .first()
        .click();
    }
    if (scenario === "B07-empty")
      await page.getByText("暂无验证。", { exact: false }).waitFor();
    else if (scenario === "B07-explicit") {
      await page.getByText("该验证记录已删除。", { exact: false }).waitFor();
      assert.ok(page.url().endsWith("/runs/first"));
    } else {
      await page.getByText("first 报告", { exact: true }).first().waitFor();
      if (scenario === "B07-history")
        await page.getByText("历史报告", { exact: true }).first().waitFor();
    }
    assert.equal(writes.length, 0);
    return { scenario, status: "passed", writes, requests };
  }
  if (
    scenario.startsWith("B09") ||
    scenario.startsWith("B11") ||
    scenario === "B10-late"
  ) {
    await page.getByRole("button", { name: /报告信息/ }).click();
    await page
      .getByRole("button", { name: "删除验证记录", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByText(/将永久删除/)
      .waitFor();
    await page.getByRole("button", { name: "确认永久删除" }).click();
    if (scenario === "B10-late") {
      await writeStarted.promise;
      await page.evaluate((path) => {
        history.pushState(null, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, campaignPath + "/runs/second");
      await page.getByText("second 报告", { exact: true }).first().waitFor();
      holdWrite = false;
      writeGate.resolve();
      await writeCompleted.promise;
      await page.waitForFunction(
        () =>
          !document.querySelector('[aria-label="整轮评论"] textarea')?.disabled,
      );
      assert.ok(page.url().endsWith("/runs/second"));
      assert.equal(writes.length, 1);
      return { scenario, status: "passed", writes, requests };
    }
    if (
      scenario === "B11-unknown-present" ||
      scenario === "B11-unknown-read-failure"
    ) {
      await page.getByText("删除结果未知", { exact: false }).first().waitFor();
      if (scenario === "B11-unknown-read-failure") {
        await page
          .getByText("读取测试失败", { exact: false })
          .first()
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "删除验证记录", exact: true })
            .isDisabled(),
          true,
        );
        failRun = false;
        await page
          .getByRole("button", { name: "重试刷新", exact: true })
          .first()
          .click();
      }
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (button) => button.textContent === "删除验证记录" && !button.disabled,
        ),
      );
      assert.ok(page.url().endsWith("/runs/first"));
      assert.equal(writes.length, 1);
      return { scenario, status: "passed", writes, requests };
    }
    if (scenario === "B11-unknown") {
      await page.getByText("该验证记录已删除。", { exact: false }).waitFor();
      assert.ok(page.url().endsWith("/runs/first"));
      await page.getByText(/此前提交结果未确认；/).waitFor();
      await page.getByRole("button", { name: "返回需求", exact: true }).click();
      await page.getByText("暂无验证。", { exact: false }).waitFor();
      assert.equal(writes.length, 1);
      return { scenario, status: "passed", writes, requests };
    }
    if (scenario === "B11-cleanup") {
      await page
        .getByText("记录已删除，部分附件清理失败。", { exact: true })
        .waitFor();
      await page.getByText("暂无验证。", { exact: false }).waitFor();
      assert.equal(writes.length, 1);
      return { scenario, status: "passed", writes, requests };
    }

    await page.waitForURL(base + campaignPath);
    if (scenario.startsWith("B09-empty"))
      await page.getByText("暂无验证。", { exact: false }).waitFor();
    else {
      await page.getByText("second 报告", { exact: true }).first().waitFor();
      if (scenario.startsWith("B09-history")) {
        assert.ok(
          await page.getByText("历史报告", { exact: true }).first().isVisible(),
        );
        assert.equal(activeCampaign.status, "pending");
      }
    }
    assert.equal(writes.filter((x) => x.method === "DELETE").length, 1);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario.startsWith("B10-external")) {
    await page.getByText("first 报告", { exact: true }).first().waitFor();
    deleted = true;
    runs = [];
    activeCampaign.latestRunId = "";
    await refresh();
    await page.getByText("该验证记录已删除。", { exact: false }).waitFor();
    assert.ok(
      page
        .url()
        .endsWith(scenario.endsWith("default") ? campaignPath : "/runs/first"),
    );
    assert.equal(
      await page.getByRole("button", { name: "一键交付", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "返回需求", exact: true }).click();
    await page.getByText("暂无验证。", { exact: false }).waitFor();
    assert.equal(writes.length, 0);
    return { scenario, status: "passed", writes, requests };
  }
  await page.getByRole("tab", { name: "检查清单" }).click();
  const one = page.getByRole("form", { name: "人工评审 one" }),
    two = page.getByRole("form", { name: "人工评审 two" });
  await one.getByRole("button", { name: "添加检查项评论" }).click();
  await two.getByRole("button", { name: "添加检查项评论" }).click();
  await one.getByRole("textbox").fill("本次提交草稿");
  await two.getByRole("textbox").fill("另一项保留草稿");
  if (scenario === "B14") {
    await page.getByRole("searchbox", { name: "搜索检查项" }).fill("one");
    await page.getByRole("button", { name: "一键交付", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("本轮共 2 项", { exact: false }).waitFor();
    await dialog.getByText("two · two", { exact: false }).first().waitFor();
    await dialog
      .getByText("以下项目原始验证未通过。", { exact: false })
      .waitFor();
    await dialog.getByRole("button", { name: "确认交付", exact: true }).click();
    await page
      .getByRole("button", { name: "本轮已交付", exact: true })
      .waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].endpoint, "/runs/first/accept-all");
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario === "B05") {
    await page.getByRole("tab", { name: "讨论", exact: false }).click();
    await page.getByRole("textbox", { name: "整轮评论内容" }).fill("整轮草稿");
    await refresh();
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="整轮评论"] textarea')?.disabled,
    );
    assert.equal(
      await page
        .getByRole("tab", { name: "讨论", exact: false })
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "整轮评论内容" }).inputValue(),
      "整轮草稿",
    );
    await page.getByRole("tab", { name: "检查清单" }).click();
    await page.locator("#check-two > button").click();
    await refresh();
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="人工评审 one"] textarea')
          ?.disabled,
    );
    assert.equal(
      await page.locator("#check-two").getAttribute("data-state"),
      "closed",
    );
    await page.locator("#check-two > button").click();
    assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
    assert.equal(writes.length, 0);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario === "B06") {
    activeCampaign.latestRunId = "second";
    runs = [second, first];
    await refresh();
    await page.getByRole("button", { name: "查看最新验证" }).waitFor();
    assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
    assert.ok(page.url().endsWith("/runs/first"));
    await page.getByRole("button", { name: "查看最新验证" }).click();
    await page.getByText("second 报告", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "检查清单" }).click();
    await two.getByRole("button", { name: "添加检查项评论" }).click();
    assert.equal(await two.getByRole("textbox").inputValue(), "");
    assert.equal(writes.length, 0);
    return { scenario, status: "passed", writes, requests };
  }
  await one.getByRole("button", { name: "保存检查项评论" }).click();
  if (scenario === "B04") {
    await writeStarted.promise;
    assert.equal(
      await two.getByRole("button", { name: "保存检查项评论" }).isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "一键交付", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: /报告信息/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "删除验证记录", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("tab", { name: "讨论", exact: false }).click();
    assert.equal(
      await page.getByRole("button", { name: "添加整轮评论" }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "报告整体有误：作废" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "作废原因" }).isDisabled(),
      true,
    );
    holdWrite = false;
    writeGate.resolve();
    await runStarted.promise;
    await peripheralStarted.promise;
    assert.equal(
      await page
        .getByRole("button", { name: "一键交付", exact: true })
        .isDisabled(),
      true,
    );
    holdRead = false;
    runGate.resolve();
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="整轮评论"] textarea')?.disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "一键交付", exact: true })
        .isDisabled(),
      false,
    );
    holdPeripheral = false;
    peripheralGate.resolve();
    assert.equal(writes.length, 1);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario === "B08") {
    await writeStarted.promise;
    const visit = async (path) => {
      await page.evaluate((path) => {
        history.pushState(null, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    };
    for (const destination of [
      campaignPath + "/runs/second",
      "/",
      "/projects/other",
    ]) {
      await visit(destination);
      await page.waitForURL(base + destination);
      await visit(campaignPath + "/runs/first");
      await page.getByText("正在保存此验证记录，请等待结果。").waitFor();
      assert.equal(
        await one.getByRole("button", { name: "添加检查项评论" }).count(),
        0,
      );
    }
    await visit(campaignPath + "/runs/second");
    await page.getByText("second 报告", { exact: true }).first().waitFor();
    holdWrite = false;
    writeGate.resolve();
    await writeCompleted.promise;
    await page.getByRole("tab", { name: "检查清单" }).click();
    await one.getByRole("button", { name: "添加检查项评论" }).click();
    await one.getByRole("textbox").fill("新页面草稿");
    assert.ok(page.url().endsWith("/runs/second"));
    assert.equal(await one.getByRole("textbox").inputValue(), "新页面草稿");
    assert.equal(writes.length, 1);
    return { scenario, status: "passed", writes, requests };
  }

  if (scenario.startsWith("B13-")) {
    await page
      .getByText("外围读取测试失败", { exact: false })
      .first()
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="人工评审 two"] textarea')
          ?.disabled,
    );
    assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
    await page
      .getByRole("complementary", { name: "运行记录", exact: true })
      .getByText("1/2 已验收", { exact: false })
      .waitFor();
    peripheralFailure = "";
    await refresh();
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="人工评审 two"] textarea')
          ?.disabled,
    );
    assert.equal(
      await page.getByText("外围读取测试失败", { exact: false }).count(),
      0,
    );
    assert.equal(writes.length, 1);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario === "B03") {
    await one.getByText(/提交结果未知/).waitFor();
    assert.equal(await one.getByRole("textbox").inputValue(), "本次提交草稿");
    await one
      .getByRole("button", { name: "保存检查项评论" })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="人工评审 one"] textarea')
          ?.disabled,
    );
    assert.equal(writes.length, 1);
    return { scenario, status: "passed", writes, requests };
  }
  if (scenario === "B01") {
    await one.getByRole("button", { name: "添加检查项评论" }).waitFor();
    assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
    await one.getByRole("button", { name: "添加检查项评论" }).click();
    assert.equal(await one.getByRole("textbox").inputValue(), "");
    assert.equal(writes.length, 1);
    return { scenario, status: "passed", writes, requests };
  }
  await page.getByText("读取测试失败", { exact: false }).first().waitFor();
  assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
  assert.equal(writes.length, 1);
  failRun = false;
  await page
    .getByRole("button", { name: "重试刷新", exact: true })
    .first()
    .click();
  await one.getByRole("button", { name: "添加检查项评论" }).waitFor();
  assert.equal(await two.getByRole("textbox").inputValue(), "另一项保留草稿");
  assert.equal(writes.length, 1);
  return { scenario, status: "passed", writes, requests };
}
