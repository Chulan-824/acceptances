import test from "node:test";
import assert from "node:assert/strict";
import { describeCampaignDelivery } from "../src/campaign-delivery-model.ts";
const base = {
  campaignId: "campaign",
  preparation: {
    runId: "new",
    status: "accepted",
    scopeType: "partial",
    eligible: false,
    issues: [],
  },
  currentDelivery: null,
  latestDelivery: null,
  latestDocument: null,
};
test("partial acceptance remains incomplete requirement delivery", () => {
  assert.equal(describeCampaignDelivery(base).label, "待完整验证");
  assert.equal(
    describeCampaignDelivery(base).review,
    "本轮已验收，需求待完整验证",
  );
});
test("new pending Run preserves valid old delivery and source document", () => {
  const view = describeCampaignDelivery({
    ...base,
    preparation: { ...base.preparation, status: "pending" },
    currentDelivery: { version: 1, runId: "old", status: "valid" },
    latestDocument: { version: 2, status: "failed" },
  });
  assert.equal(view.sameRun, false);
  assert.equal(view.label, "已交付 v1 · 最新一轮尚未交付");
  assert.equal(view.review, "最新一轮待评审");
  assert.equal(view.document, "说明 v2 · 生成失败");
});
test("inactive frozen version is historical, not an undelivered requirement", () => {
  const view = describeCampaignDelivery({
    ...base,
    latestDelivery: { version: 1, status: "invalidated" },
  });
  assert.equal(view.label, "交付 v1 已失效");
  assert.equal(view.sameRun, false);
});

test("no latest Run does not pretend an older report is awaiting delivery", () => {
  const view = describeCampaignDelivery({
    ...base,
    preparation: null,
    currentDelivery: { version: 1, runId: "old", status: "valid" },
  });
  assert.equal(view.label, "已交付 v1 · 当前无最新报告");
  assert.equal(view.review, "暂无最新验证记录");
});
