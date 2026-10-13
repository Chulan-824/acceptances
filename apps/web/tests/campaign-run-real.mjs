/** Real browser + isolated Go HTTP only. No intercepted or mocked requests. */
export async function run(page, base, apiBase = base) {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const evidence = [];
  const request = async (path, method = "GET", data) => {
    const response = await page.request.fetch(`${apiBase}/api/v1${path}`, {
      method,
      data,
    });
    assert(
      response.ok(),
      `${method} ${path}: ${response.status()} ${await response.text()}`,
    );
    return response.status() === 204 ? undefined : response.json();
  };
  const project = await request("/projects", "POST", {
    name: `Refresh HTTP ${Date.now()}`,
  });
  const campaign = await request(`/projects/${project.id}/campaigns`, "POST", {
    title: "Real refresh lifecycle",
  });
  const route = (id) =>
    `${base}/projects/${project.id}/campaigns/${campaign.id}/runs/${id}`;
  const upload = async (name, scopeType = "full", followUp) => {
    const report = {
      title: name,
      description: "Isolated lifecycle fixture",
      verifiedAt: new Date().toISOString(),
      scope: "Lifecycle fixture",
      scopeType,
      environment: "isolated-browser-http",
      versions: [],
      checks: ["passed", "failed", "blocked", "skipped"].map(
        (status, index) => ({
          id: `c${index + 1}`,
          title: `Behavior ${index + 1}`,
          expected: "Expected observation",
          actual: `Original ${status}`,
          status,
          evidence: [],
        }),
      ),
      evidence: [],
      ...(followUp ? { followUp } : {}),
    };
    const response = await page.request.post(
      `${apiBase}/api/v1/campaigns/${campaign.id}/runs`,
      {
        multipart: {
          report: JSON.stringify(report),
          submissionId: `${project.id}-${name}`,
        },
      },
    );
    assert(
      response.status() === 201,
      `upload: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  };
  const read = (id) => request(`/runs/${id}`);
  const getCampaign = () => request(`/campaigns/${campaign.id}`);
  const open = async (item) => {
    await page.goto(route(item.id));
    await page
      .locator(".report-name")
      .filter({ hasText: item.report.title })
      .waitFor();
  };
  const form = (index) =>
    page.getByRole("form", { name: `人工评审 Behavior ${index}` });
  const action = async (id, suffix, click) => {
    const written = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/runs/${id}/${suffix}`) &&
        response.request().method() === "POST",
    );
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/runs/${id}`) &&
        response.request().method() === "GET",
    );
    await click();
    assert((await written).ok(), `${suffix} write failed`);
    await refreshed;
    return read(id);
  };
  const judge = async (item, index, kind, body = "Real browser judgment") => {
    await page.getByRole("tab", { name: /检查清单/ }).click();
    const target = form(index);
    if (!(await target.isVisible()))
      await page.locator(`#check-c${index} > button`).click();
    if (kind === "accepted" && index === 1)
      return action(item.id, "reviews", () =>
        target.getByRole("button", { name: "人工通过", exact: true }).click(),
      );
    if (kind === "pending")
      return action(item.id, "reviews", () =>
        target.getByRole("button", { name: "撤回到待审" }).click(),
      );
    await target
      .getByRole("button", {
        name: kind === "accepted" ? "人工通过" : "人工不通过",
        exact: true,
      })
      .click();
    await target.getByRole("textbox").fill(body);
    return action(item.id, "reviews", () =>
      target
        .getByRole("button", {
          name: kind === "accepted" ? "确认人工通过" : "确认不通过",
        })
        .click(),
    );
  };
  const comment = async (item, body) => {
    await page.getByRole("tab", { name: /讨论/ }).click();
    await page.getByLabel("整轮评论内容").fill(body);
    return action(item.id, "reviews", () =>
      page.getByRole("button", { name: "添加整轮评论", exact: true }).click(),
    );
  };
  const bulk = async (item) => {
    await page.getByRole("button", { name: "一键交付", exact: true }).click();
    return action(item.id, "accept-all", () =>
      page.getByRole("button", { name: "确认交付", exact: true }).click(),
    );
  };
  const remove = async (item) => {
    await open(item);
    const trigger = page.getByRole("button", {
      name: "删除验证记录",
      exact: true,
    });
    if (!(await trigger.isVisible()))
      await page.getByRole("button", { name: /报告信息/ }).click();
    await trigger.click();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/runs/${item.id}`) &&
        r.request().method() === "DELETE",
    );
    await page
      .getByRole("button", { name: "确认永久删除", exact: true })
      .click();
    assert((await response).status() === 204, "DELETE did not commit");
    await page.waitForURL((url) => !url.pathname.endsWith(`/runs/${item.id}`));
  };
  const first = await upload("H01 original");
  await open(first);
  const original = JSON.stringify(first.report);
  await judge(first, 1, "accepted");
  let state = await judge(first, 2, "rejected");
  assert(
    state.status === "rejected" && (await getCampaign()).status === "rejected",
    "rejection status",
  );
  state = await judge(first, 1, "pending");
  assert(
    state.checkReviews.find((item) => item.checkId === "c1").status ===
      "pending",
    "withdrawal missing",
  );
  state = await comment(first, "H01 durable overall comment");
  assert(state.status === "rejected", "comment changed judgment");
  state = await bulk(first);
  assert(
    state.status === "accepted" && (await getCampaign()).status === "accepted",
    "full acceptance not reflected",
  );
  assert(
    JSON.stringify(state.report) === original && state.reviews.length === 8,
    "immutable report or review history changed",
  );
  await page.getByRole("button", { name: "本轮已交付", exact: true }).waitFor();
  evidence.push({
    id: "H01",
    status: "passed",
    runId: first.id,
    reviewCount: state.reviews.length,
  });
  for (const scope of ["partial", "unknown"]) {
    const item = await upload(`H02 ${scope}`, scope);
    await open(item);
    const accepted = await bulk(item);
    assert(
      accepted.status === "accepted" &&
        (await getCampaign()).status === "pending",
      `${scope} scope accepted Campaign`,
    );
  }
  const latest = await upload("H02 fresh full");
  assert(
    latest.status === "pending" &&
      latest.reviews.length === 0 &&
      latest.reviewCounts.pending === 4,
    "new Run inherited review",
  );
  await open(latest);
  await bulk(latest);
  await open(first);
  await judge(first, 1, "rejected", "Historical reassessment");
  assert(
    (await getCampaign()).status === "accepted",
    "historical review changed latest Campaign",
  );
  evidence.push({ id: "H02", status: "passed", latest: latest.id });
  await open(latest);
  const incoming = await upload("H03 incoming");
  await page.getByRole("button", { name: "需求操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "刷新报告", exact: true })
    .first()
    .click();
  const latestRun = page
    .locator(".run-list-item")
    .filter({ hasText: incoming.report.title });
  await latestRun.waitFor();
  assert(
    (await page.getByText("有新的验证记录", { exact: false }).count()) === 0,
    "historical Run shows new verification notice",
  );
  assert(
    (await page
      .getByText("这是历史报告，对它的决定不会改变需求当前状态。", {
        exact: true,
      })
      .count()) === 0,
    "historical Run shows decision notice",
  );
  assert(
    await page
      .locator(".report-name")
      .filter({ hasText: latest.report.title })
      .isVisible(),
    "refresh switched selected Run",
  );
  await latestRun.click();
  await page
    .locator(".report-name")
    .filter({ hasText: incoming.report.title })
    .waitFor();
  evidence.push({
    id: "H03",
    status: "passed",
    retained: latest.id,
    incoming: incoming.id,
  });
  await page.getByRole("tab", { name: /讨论/ }).click();
  await page.getByRole("button", { name: "报告整体有误：作废" }).click();
  await page
    .getByLabel("作废原因", { exact: true })
    .fill("Isolated invalid report");
  state = await action(incoming.id, "void", () =>
    page.getByRole("button", { name: "确认作废" }).click(),
  );
  assert(state.status === "void", "void not persisted");
  await page.getByRole("tab", { name: /检查清单/ }).click();
  assert(
    await form(1)
      .getByRole("button", { name: "人工通过", exact: true })
      .isDisabled(),
    "void allowed judgment",
  );
  state = await comment(incoming, "Void still permits comments");
  assert(
    state.status === "void" &&
      state.reviews.some((item) => item.body === "Void still permits comments"),
    "void comment missing",
  );
  await remove(incoming);
  let currentCampaign = await getCampaign();
  assert(
    !currentCampaign.latestRunId && currentCampaign.status === "pending",
    "deleted latest promoted history",
  );
  const source = await upload("H04 source");
  await open(source);
  state = await comment(source, "Follow-up feedback");
  const reviewId = state.reviews[0].id;
  const followUp = {
    sourceRunId: source.id,
    responses: [
      { reviewId, explanation: "Verified follow-up", checkIds: ["c1"] },
    ],
  };
  const follow = await upload("H04 follow-up", "full", followUp);
  assert(
    (await read(source.id)).feedbackResponses.length === 1 &&
      (await read(follow.id)).sourceRunAvailable,
    "follow-up relation missing",
  );
  await remove(follow);
  assert(
    (await read(source.id)).feedbackResponses.length === 0,
    "deleted follow-up remained linked",
  );
  const follow2 = await upload("H04 follow-up retained", "full", followUp);
  await remove(source);
  assert(
    (await read(follow2.id)).sourceRunAvailable === false,
    "deleted source remained available",
  );
  await open(follow2);
  await page.getByRole("tab", { name: /检查清单/ }).click();
  await page.getByText(/来源已删除/).waitFor();
  evidence.push({
    id: "H04",
    status: "passed",
    source: source.id,
    followUp: follow2.id,
  });
  await open(first);
  await page.goto(base);
  await open(first);
  await page.reload();
  await page
    .locator(".report-name")
    .filter({ hasText: first.report.title })
    .waitFor();
  await page.getByRole("tab", { name: /讨论/ }).click();
  await page
    .getByText("H01 durable overall comment", { exact: true })
    .waitFor();
  state = await read(first.id);
  assert(
    state.status === "rejected" &&
      state.reviews.length === 9 &&
      JSON.stringify(state.report) === original,
    "reload lost persisted history",
  );
  evidence.push({
    id: "H05",
    status: "passed",
    runId: first.id,
    reviewCount: state.reviews.length,
  });
  return { projectId: project.id, campaignId: campaign.id, evidence };
}
