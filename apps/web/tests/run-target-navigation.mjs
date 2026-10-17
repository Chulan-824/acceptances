// Browser seam; the runner supplies a Playwright Page and isolated Vite origin.
// All HTTP responses are controlled fixtures. No daily database is accessed.
const assert = {
  equal: (a, b, m) => {
    if (a !== b) throw new Error(m || `${a} != ${b}`);
  },
  deepEqual: (a, b, m) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(m || "not equal");
  },
};

const createdAt = "2026-10-12T00:00:00Z";
const project = {
  id: "navigation-project",
  name: "定位测试项目",
  description: "",
  createdAt,
};
const campaign = {
  id: "navigation-campaign",
  projectId: project.id,
  title: "定位验收",
  description: "",
  status: "pending",
  latestRunId: "second",
  createdAt,
};
const path = `/projects/${project.id}/campaigns/${campaign.id}/runs/`;
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
      description: "导航隔离数据",
      verifiedAt: createdAt,
      scope: "定位",
      scopeType: "full",
      environment: "test",
      versions: [],
      checks: [
        {
          id: "target",
          title: `${id} 目标检查`,
          expected: "目标预期",
          actual: `${id} 实际结果`,
          status: "passed",
          evidence: [],
        },
        {
          id: "other",
          title: "其他检查",
          expected: "其他预期",
          actual: "其他实际",
          status: "failed",
          evidence: [],
        },
      ],
      evidence: [{ path: "proof.txt", description: "定位证据" }],
    },
    reviews: [
      {
        id: `${id}-review`,
        runId: id,
        checkId: "target",
        kind: "comment",
        body: `${id} 检查反馈正文`,
        createdAt,
        legacy: false,
      },
      {
        id: `${id}-discussion`,
        runId: id,
        kind: "comment",
        body: `${id} 整轮反馈正文`,
        createdAt,
        legacy: false,
      },
    ],
    checkReviews: [{ checkId: "target", status: "accepted", lastReviewId: "" }],
    reviewCounts: { accepted: 1, pending: 1, rejected: 0 },
    feedbackResponses: [],
  };
}
export async function run(
  page,
  base = "http://127.0.0.1:15173",
  scenario = "invalid",
) {
  if (
    ![
      "invalid",
      "repeat",
      "cross",
      "targets",
      "recovery",
      "loading",
      "stale",
      "failure",
      "deleted",
      "native",
      "missing-viewport",
      "refresh",
    ].includes(scenario)
  )
    throw new Error(`Unknown navigation scenario: ${scenario}`);
  const first = makeRun("first"),
    second = makeRun("second");
  second.report.followUp = {
    sourceRunId: "first",
    responses: [
      {
        reviewId: "first-review",
        explanation: "复验处理",
        checkIds: ["target"],
      },
      { reviewId: "first-discussion", explanation: "整轮处理", checkIds: [] },
    ],
  };
  first.feedbackResponses = [
    {
      runId: "second",
      reviewId: "first-review",
      explanation: "复验完成",
      checkIds: ["target"],
    },
    {
      runId: "second",
      reviewId: "first-discussion",
      explanation: "无检查关联",
      checkIds: [],
    },
  ];
  if (scenario === "deleted") second.sourceRunAvailable = false;
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const writes = [];
  await page.context().unrouteAll({ behavior: "wait" });
  await page.context().route("**/api/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      writes.push(request.url());
      if (
        scenario === "refresh" &&
        request.method() === "POST" &&
        request.url().endsWith("/runs/second/reviews")
      ) {
        firstStarted();
        await released;
        second.reviews.push({
          id: "refresh-review",
          runId: "second",
          checkId: "target",
          kind: "pending",
          body: "刷新后的评审",
          createdAt,
          legacy: false,
        });
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(second.reviews.at(-1)),
        });
      }
      return route.fulfill({ status: 405, body: "{}" });
    }
    const endpoint = new URL(request.url()).pathname.replace("/api/v1", "");
    if (endpoint === "/runs/first" && ["loading", "stale"].includes(scenario)) {
      firstStarted();
      await released;
    }
    if (endpoint === "/runs/first" && scenario === "failure") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "导航测试读取失败" }),
      });
    }
    const data = {
      "/projects": { items: [project] },
      [`/projects/${project.id}`]: project,
      [`/projects/${project.id}/campaigns`]: { items: [campaign] },
      [`/projects/${project.id}/repositories`]: { items: [] },
      [`/campaigns/${campaign.id}`]: campaign,
      [`/campaigns/${campaign.id}/delivery`]: {
        campaignId: campaign.id,
        preparation: null,
        currentDelivery: null,
        latestDelivery: null,
        latestDocument: null,
      },
      [`/campaigns/${campaign.id}/runs`]: { items: [second, first] },
      "/runs/first": first,
      "/runs/second": second,
    }[endpoint];
    await route.fulfill({
      status: data ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(data || { message: "找不到资源" }),
    });
  });
  page.setDefaultTimeout(5000);
  const open = async (suffix) => {
    await page.goto(base + path + suffix);
    await page.getByRole("tab", { name: /检查清单/ }).waitFor();
  };
  const visibleTarget = async (selector) => {
    const locator = page.locator(selector);
    await locator.waitFor({ state: "visible" });
    await page.waitForFunction((selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const bar = document
        .querySelector(".review-bar")
        ?.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.top >= -1 &&
        box.top < Math.min(innerHeight, bar?.top ?? innerHeight) &&
        box.bottom > 0
      );
    }, selector);
  };
  const selected = async (name) =>
    assert.equal(
      await page.getByRole("tab", { name }).getAttribute("aria-selected"),
      "true",
    );
  const hash = async (value) => {
    await page.evaluate((value) => {
      location.hash = value;
    }, value);
  };
  try {
    if (scenario === "refresh") {
      await open("second#check-target");
      await visibleTarget("#check-target");
      await page
        .locator("#check-target")
        .getByRole("button", { name: "撤回到待审" })
        .click();
      await started;
      await page.locator("#check-target > button").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/runs/second",
      );
      releaseFirst();
      await (await refreshed).finished();
      await page
        .getByText("刷新后的评审", { exact: true })
        .waitFor({ state: "attached" });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page
          .locator("#check-target > button")
          .getAttribute("aria-expanded"),
        "false",
        "Ordinary refresh must preserve collapsed target",
      );
      assert.equal(
        await page.evaluate(() => window.scrollY),
        scrollBefore,
        "Ordinary refresh must preserve scroll position",
      );
      await page.getByRole("link", { name: "target", exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#check-target > button")
            ?.getAttribute("aria-expanded") === "true",
      );
      await visibleTarget("#check-target");
      assert.equal(
        await page
          .locator("#check-target > button")
          .getAttribute("aria-expanded"),
        "true",
        "Explicit repeated target must still reveal after refresh",
      );
    }
    if (scenario === "missing-viewport") {
      await open("second#feedback-second-review");
      await visibleTarget("#feedback-second-review");
      await hash("unknown-from-bottom");
      await page.getByText("目标不存在或已不可用", { exact: true }).waitFor();
      await visibleTarget('[role="alert"]');
      await visibleTarget('[role="alert"] button');
      await page.getByRole("button", { name: "返回本轮概览" }).click();
      await visibleTarget(".report-version-line");
      assert.equal(new URL(page.url()).hash, "");
    }
    if (scenario === "cross") {
      await open("second");
      await page.locator('a[href$="#feedback-first-review"]').click();
      await visibleTarget("#feedback-first-review");
      await selected(/检查清单/);
      assert.equal(
        await page
          .locator("#feedback-first-review")
          .textContent()
          .then((t) => t.includes("first 检查反馈正文")),
        true,
      );
      await page
        .locator("#feedback-first-review")
        .getByRole("link", { name: /查看后续复验/ })
        .click();
      await visibleTarget("#check-target");
      await page.getByText("second 实际结果", { exact: true }).waitFor();
      await visibleTarget("#check-target");
      await page.locator('a[href$="#feedback-first-discussion"]').click();
      await visibleTarget("#feedback-first-discussion");
      await selected(/讨论/);
      await page
        .locator("#feedback-first-discussion")
        .getByRole("link", { name: /查看后续复验/ })
        .click();
      await visibleTarget("#follow-up");
      await selected(/检查清单/);
      assert.equal(new URL(page.url()).hash, "#follow-up");
    }
    if (scenario === "targets") {
      await open("second#feedback-second-review");
      await visibleTarget("#feedback-second-review");
      await page
        .getByRole("button", { name: /评审历史 · 1 条/ })
        .first()
        .click();
      await page.locator("#check-target > button").click();
      await hash("check-other");
      await visibleTarget("#check-other");
      await hash("feedback-second-review");
      await visibleTarget("#feedback-second-review");
      await hash("feedback-second-discussion");
      await visibleTarget("#feedback-second-discussion");
      await selected(/讨论/);
      await hash("evidence-proof.txt");
      await visibleTarget('[id="evidence-proof.txt"]');
      await selected(/文件/);
      const url = page.url(),
        historyLength = await page.evaluate(() => history.length);
      await page.getByRole("button", { name: "讨论", exact: true }).click();
      await visibleTarget("#run-feedback");
      await page.getByRole("button", { name: "逐项评审", exact: true }).click();
      await visibleTarget("#checks-title");
      assert.equal(page.url(), url);
      assert.equal(await page.evaluate(() => history.length), historyLength);
      await page.getByRole("link", { name: "target", exact: true }).focus();
      await page.keyboard.press("Enter");
      await visibleTarget("#check-target");
      await page.goBack();
      await visibleTarget('[id="evidence-proof.txt"]');
      await selected(/文件/);
      await page.goForward();
      await visibleTarget("#check-target");
    }
    if (scenario === "recovery") {
      await open("second#check-target");
      await visibleTarget("#check-target");
      await hash("unrecognized-target");
      await page.getByText("目标不存在或已不可用", { exact: true }).waitFor();
      const length = await page.evaluate(() => history.length);
      await page.getByRole("button", { name: "返回本轮概览" }).click();
      await visibleTarget(".report-version-line");
      await selected(/检查清单/);
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(await page.evaluate(() => history.length), length);
      await page.goBack();
      await visibleTarget("#check-target");
      assert.equal(new URL(page.url()).hash, "#check-target");
      await page.goForward();
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(
        await page.getByText("目标不存在或已不可用", { exact: true }).count(),
        0,
      );
    }
    if (["loading", "stale", "failure"].includes(scenario)) {
      await open("second");
      await page.locator('a[href$="#feedback-first-review"]').click();
      if (scenario === "failure") {
        await page
          .getByRole("alert")
          .filter({ hasText: "导航测试读取失败" })
          .waitFor();
      } else {
        await started;
        await page.getByText("正在加载…", { exact: true }).waitFor();
        assert.equal(
          await page.getByText("目标不存在或已不可用", { exact: true }).count(),
          0,
        );
        if (scenario === "stale") {
          await page.goBack();
          await page
            .getByRole("link", { name: "target", exact: true })
            .waitFor();
          await page.getByRole("button", { name: "讨论", exact: true }).click();
          await visibleTarget("#run-feedback");
        }
        const responsePromise = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/runs/first",
        );
        releaseFirst();
        await (await responsePromise).finished();
        if (scenario === "loading")
          await visibleTarget("#feedback-first-review");
        else {
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          await selected(/讨论/);
          assert.equal(new URL(page.url()).pathname.endsWith("/second"), true);
          await page
            .getByText("second 整轮反馈正文", { exact: true })
            .waitFor();
        }
      }
      assert.equal(
        await page.getByText("目标不存在或已不可用", { exact: true }).count(),
        0,
      );
    }
    if (scenario === "deleted") {
      await open("second");
      await page.getByText(/来源已删除/).waitFor();
      assert.equal(await page.locator('a[href*="/runs/first"]').count(), 0);
      assert.equal(
        await page.getByText("目标不存在或已不可用", { exact: true }).count(),
        0,
      );
      await selected(/检查清单/);
    }
    if (scenario === "native") {
      await open("second");
      for (const selector of [
        'a[href$="#check-target"]',
        'a[href$="#feedback-first-review"]',
        'a[href$="/runs/first"]',
      ]) {
        const link = page.locator(selector);
        // Observe the link's uncancelled browser event; prevent its default only
        // after React to avoid actually opening windows/downloads for each modifier.
        for (const modifier of [
          "metaKey",
          "ctrlKey",
          "shiftKey",
          "altKey",
          "middle",
        ]) {
          const result = await link.evaluate((element, modifier) => {
            let prevented;
            const observe = (event) => {
              prevented = event.defaultPrevented;
              event.preventDefault();
            };
            window.addEventListener("click", observe, { once: true });
            element.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                button: modifier === "middle" ? 1 : 0,
                [modifier]: modifier !== "middle",
              }),
            );
            return { prevented, href: element.href };
          }, modifier);
          assert.equal(
            result.prevented,
            false,
            `${selector} ${modifier} must preserve browser default`,
          );
          assert.equal(result.href.startsWith(base + path), true);
        }
      }
      // Also exercise one actual browser new-tab action through the link.
      const popupPromise = page.context().waitForEvent("page");
      await page
        .getByRole("link", { name: "target", exact: true })
        .click({ modifiers: ["ControlOrMeta"] });
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(new URL(popup.url()).hash, "#check-target");
      await popup.getByText("second 实际结果", { exact: true }).waitFor();
      await popup.close();
      assert.equal(new URL(page.url()).hash, "");
      await page.getByRole("link", { name: "first", exact: true }).click();
      await page.getByRole("tab", { name: /检查清单/ }).waitFor();
      await selected(/检查清单/);
      assert.equal(new URL(page.url()).hash, "");
    }
    if (scenario === "invalid") {
      await open("second#check-missing");
      await page.getByText("目标不存在或已不可用", { exact: true }).waitFor();
      await page.getByRole("button", { name: "返回本轮概览" }).click();
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(
        await page
          .getByRole("tab", { name: /检查清单/ })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await page.getByText("目标不存在或已不可用", { exact: true }).count(),
        0,
      );
      await open("second#%E0%A4%A");
      await page.getByText("目标不存在或已不可用", { exact: true }).waitFor();
    }
    if (scenario === "repeat") {
      await open("second");
      const link = page.getByRole("link", { name: "target", exact: true });
      await link.click();
      await page.getByText("second 实际结果", { exact: true }).waitFor();
      await visibleTarget("#check-target");
      const initial = await page.evaluate(() => history.length);
      await page.locator("#check-target > button").click();
      await link.click();
      await page.getByText("second 实际结果", { exact: true }).waitFor();
      await visibleTarget("#check-target");
      assert.equal(
        await page.evaluate(() => history.length),
        initial,
        "Repeated target must not add history",
      );
      await page.getByRole("searchbox", { name: "搜索检查项" }).fill("absent");
      await page.getByRole("combobox", { name: "原始验证结果筛选" }).click();
      await page.getByRole("option", { name: /失败/ }).click();
      await link.click();
      await page.getByText("second 实际结果", { exact: true }).waitFor();
      await visibleTarget("#check-target");
      assert.equal(
        await page.getByRole("searchbox", { name: "搜索检查项" }).inputValue(),
        "",
      );
      assert.equal(
        await page
          .getByRole("combobox", { name: "原始验证结果筛选" })
          .textContent(),
        "全部 2",
      );
      await page.goBack();
      assert.equal(new URL(page.url()).hash, "");
      await page.goForward();
      await page.getByText("second 实际结果", { exact: true }).waitFor();
      await visibleTarget("#check-target");
      assert.equal(new URL(page.url()).hash, "#check-target");
    }
    assert.deepEqual(
      writes,
      scenario === "refresh" ? [base + "/api/v1/runs/second/reviews"] : [],
      "Navigation must not add writes beyond the explicit refresh fixture review",
    );
    return { scenario, status: "passed" };
  } finally {
    releaseFirst();
  }
}
