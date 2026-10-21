// Real browser / controlled HTTP. Every scenario owns a fresh browser context.
import assert from "node:assert/strict";
const kinds = ["project", "campaign", "run"];
const outcomes = [
  "committed",
  "cleanup",
  "unknown-missing",
  "unknown-present",
  "read-failure",
  "rejected",
  "missing-rejected",
  "late",
  "preview-late",
  "preview-failure",
];
export const scenarios = kinds.flatMap((kind) =>
  outcomes.map((outcome) => `${kind}/${outcome}`),
);
export async function run(page, base, scenario) {
  assert.ok(scenarios.includes(scenario), `Unknown scenario ${scenario}`);
  const [kind, outcome] = scenario.split("/");
  const label = { project: "项目", campaign: "需求", run: "验证记录" }[kind];
  const createdAt = "2026-10-18T00:00:00Z";
  const project = { id: "p", name: "删除测试项目", description: "", createdAt };
  const other = { ...project, id: "q", name: "无关项目" };
  const campaign = {
    id: "c",
    projectId: "p",
    title: "删除测试需求",
    description: "",
    status: "pending",
    latestRunId: "r",
    createdAt,
  };
  const report = {
    title: "删除测试报告",
    description: "",
    verifiedAt: createdAt,
    scope: "测试",
    scopeType: "full",
    environment: "fixture",
    versions: [],
    evidence: [],
    checks: [
      {
        id: "one",
        title: "检查项",
        expected: "a",
        actual: "b",
        status: "passed",
        evidence: [],
      },
    ],
  };
  const record = {
    id: "r",
    campaignId: "c",
    status: "pending",
    createdAt,
    report,
    reviews: [],
    checkReviews: [],
    feedbackResponses: [],
    reviewCounts: { accepted: 0, pending: 1, rejected: 0 },
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const gate = deferred(),
    started = deferred(),
    finished = deferred();
  const apiPath = {
    project: "/projects/p",
    campaign: "/campaigns/c",
    run: "/runs/r",
  }[kind];
  const path =
    kind === "project" ? "/projects/p" : "/projects/p/campaigns/c/runs/r";
  const destination = {
    project: "/",
    campaign: "/projects/p",
    run: "/projects/p/campaigns/c",
  }[kind];
  const name = {
    project: project.name,
    campaign: campaign.title,
    run: report.title,
  }[kind];
  let removed = false,
    readFailure = false,
    writeCount = 0,
    previews = 0;
  const requests = [],
    unexpected = [];
  await page.context().route("**/api/**", async (route) => {
    const req = route.request(),
      endpoint = new URL(req.url()).pathname.replace("/api/v1", "");
    requests.push({ method: req.method(), endpoint });
    const fail = (status, code) =>
      route.fulfill({ status, json: { code, message: code } });
    if (req.method() === "DELETE" && endpoint === apiPath) {
      writeCount++;
      started.resolve();
      if (outcome === "late") await gate.promise;
      if (outcome === "rejected") return fail(403, "ORIGIN_NOT_ALLOWED");
      if (outcome === "missing-rejected") {
        readFailure = true;
        return fail(404, "NOT_FOUND");
      }
      if (outcome === "unknown-present" || outcome === "read-failure") {
        readFailure = outcome === "read-failure";
        return route.abort("failed");
      }
      removed = true;
      if (outcome === "unknown-missing") return route.abort("failed");
      if (outcome === "cleanup") return fail(500, "EVIDENCE_CLEANUP_FAILED");
      await route.fulfill({ status: 204 });
      finished.resolve();
      return;
    }
    if (req.method() !== "GET") {
      unexpected.push(`${req.method()} ${endpoint}`);
      return fail(400, "UNEXPECTED_WRITE");
    }
    if (endpoint === apiPath + "/delete-preview") {
      previews++;
      started.resolve();
      if (outcome === "preview-late") await gate.promise;
      if (outcome === "preview-failure")
        return fail(500, "PREVIEW_TEST_FAILED");
      await route.fulfill({
        json: {
          projects: kind === "project" ? 1 : 0,
          campaigns: kind === "run" ? 0 : 1,
          runs: 1,
          evidence: 2,
          reviews: 3,
          retainedDeliveries: 1,
          retainedDocuments: 2,
        },
      });
      if (outcome === "preview-late") finished.resolve();
      return;
    }
    if (endpoint === apiPath && readFailure)
      return fail(500, "READ_TEST_FAILED");
    const projectGone = removed && kind === "project",
      campaignGone = removed && kind !== "run";
    if (
      (projectGone && endpoint.startsWith("/projects/p")) ||
      (campaignGone && endpoint.startsWith("/campaigns/c")) ||
      (removed && endpoint === "/runs/r")
    )
      return fail(404, "NOT_FOUND");
    const responses = {
      // Deliberately stale collections exercise client tombstones and refresh invalidation.
      "/projects": { items: [project, other] },
      "/dashboard": {
        items: [{ ...campaign, projectName: project.name, latestRun: null }],
      },
      "/projects/p": project,
      "/projects/q": other,
      "/projects/p/repositories": { items: [] },
      "/projects/q/repositories": { items: [] },
      "/projects/p/campaigns": { items: [campaign] },
      "/projects/q/campaigns": { items: [] },
      "/campaigns/c": { ...campaign, latestRunId: removed ? "" : "r" },
      "/campaigns/c/runs": { items: removed ? [] : [record] },
      "/campaigns/c/delivery": {
        campaignId: "c",
        preparation: null,
        currentDelivery: null,
        latestDelivery: null,
        latestDocument: null,
      },
      "/runs/r": record,
    };
    if (!(endpoint in responses)) {
      unexpected.push(`GET ${endpoint}`);
      return fail(404, "UNEXPECTED_GET");
    }
    return route.fulfill({ json: responses[endpoint] });
  });
  const visit = async (next) => {
    await page.evaluate((path) => {
      history.pushState(null, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    }, next);
    await page.waitForURL(base + next);
  };
  const openPreview = async () => {
    await page
      .locator('[role="menu"][data-state="closed"]')
      .waitFor({ state: "detached" });
    if (
      kind === "campaign" &&
      (await page
        .getByRole("button", { name: "需求操作", exact: true })
        .getAttribute("data-state")) !== "open"
    )
      await page.getByRole("button", { name: "需求操作", exact: true }).click();
    if (
      kind === "run" &&
      !(await page
        .getByRole("button", { name: "删除验证记录", exact: true })
        .isVisible())
    )
      await page.getByRole("button", { name: /报告信息/ }).click();
    await page
      .getByRole(kind === "campaign" ? "menuitem" : "button", {
        name: `删除${label}`,
        exact: true,
      })
      .click();
  };
  await page.goto(base + path);
  await openPreview();
  if (outcome === "preview-late") {
    await started.promise;
    await visit("/projects/q");
    gate.resolve();
    await finished.promise;
    await page.getByRole("heading", { name: other.name }).waitFor();
    assert.equal(await page.getByRole("alertdialog").count(), 0);
    await visit(path);
    await page
      .getByRole("heading", {
        name: kind === "project" ? project.name : campaign.title,
      })
      .waitFor();
    assert.equal(await page.getByRole("alertdialog").count(), 0);
  } else if (outcome === "preview-failure") {
    await page
      .getByText("PREVIEW_TEST_FAILED", { exact: false })
      .first()
      .waitFor();
    assert.equal(await page.getByRole("alertdialog").count(), 0);
  } else {
    const dialog = page.getByRole("alertdialog");
    await dialog.getByText(/保留 1 份交付快照及 2 份交付文档/).waitFor();
    if (outcome === "committed") {
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(writeCount, 0);
      await openPreview();
      assert.equal(previews, 2);
    }
    await page
      .getByRole("button", { name: "确认永久删除", exact: true })
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "detached" });
    if (outcome === "late") {
      // started is already resolved by the preview; wait for the actual pending write.
      await page
        .getByText(`正在删除${label}，请等待结果。`, { exact: true })
        .waitFor();
      await visit("/projects/q");
      await page.getByRole("heading", { name: other.name }).waitFor();
      gate.resolve();
      await finished.promise;
      await page.getByRole("heading", { name: other.name }).waitFor();
      assert.equal(page.url(), base + "/projects/q");
    } else if (outcome === "unknown-missing") {
      await page
        .getByText("对象已不存在，本次删除结果未确认。", { exact: true })
        .waitFor();
      assert.equal(page.url(), base + path);
      assert.equal(await page.getByText(/已删除，部分附件/).count(), 0);
      if (kind !== "run")
        assert.equal(
          await page
            .getByRole("complementary", { name: "运行记录", exact: true })
            .count(),
          0,
        );
      await page
        .getByRole("button", {
          name:
            kind === "project"
              ? "返回首页"
              : kind === "campaign"
                ? "返回项目"
                : "返回需求",
          exact: true,
        })
        .click();
      await page.waitForURL(base + destination);
    } else if (
      [
        "unknown-present",
        "read-failure",
        "rejected",
        "missing-rejected",
      ].includes(outcome)
    ) {
      await page
        .getByText(
          outcome.endsWith("rejected") ? /删除请求未完成/ : /删除结果未知/,
        )
        .first()
        .waitFor();
      if (outcome === "read-failure" || outcome === "missing-rejected") {
        await page.getByText(/状态核对失败/).waitFor();
        readFailure = false;
        await page
          .getByRole("button", { name: "重试核对", exact: true })
          .click();
      }
      await openPreview();
      await page.getByRole("alertdialog").waitFor();
      assert.equal(writeCount, 1);
      assert.equal(previews, 2);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(page.url(), base + path);
    } else {
      await page.waitForURL(base + destination);
      if (outcome === "cleanup") {
        const warning = page.getByText(
          `${label}“${name}”已删除，部分附件清理失败。`,
          { exact: false },
        );
        await warning.waitFor();
        await visit("/projects/q");
        await page.getByRole("heading", { name: other.name }).waitFor();
        assert.equal(await warning.count(), 0);
        await visit(destination);
        await warning.waitFor();
        await page
          .getByRole("button", { name: `关闭${name}的清理提示`, exact: true })
          .click();
        assert.equal(await warning.count(), 0);
        await visit("/projects/q");
        await visit(destination);
        assert.equal(await warning.count(), 0);
      }
      if (kind === "project") {
        await page.getByRole("heading", { name: "交付验证看板" }).waitFor();
        assert.equal(
          await page
            .getByRole("link", { name: project.name, exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page.getByText(campaign.title, { exact: true }).count(),
          0,
        );
        assert.ok(
          requests.filter((r) => r.endpoint === "/projects").length >= 2,
        );
      }
      if (kind === "campaign")
        assert.equal(
          await page
            .locator(".campaign-list-item")
            .filter({ hasText: campaign.title })
            .count(),
          0,
        );
    }
  }
  assert.deepEqual(unexpected, []);
  assert.equal(writeCount, outcome.startsWith("preview-") ? 0 : 1);
  return { scenario, status: "passed", writeCount, previews, requests };
}
