import type { CampaignDeliveryOverview } from "@acceptances/api-client";

// Consume the server's verdict; presentation never grants permission to freeze.
export function describeCampaignDelivery(data: CampaignDeliveryOverview) {
  const prep = data.preparation;
  const current = data.currentDelivery;
  const sameRun = !!current && current.runId === prep?.runId;
  const review = !prep
    ? "暂无最新验证记录"
    : prep.status === "void"
      ? "最新报告已作废"
      : prep.status === "rejected"
        ? "最新一轮人工不通过"
        : prep.status !== "accepted"
          ? "最新一轮待评审"
          : prep.scopeType !== "full"
            ? "本轮已验收，需求待完整验证"
            : "完整范围已人工验收";
  const next = !prep
    ? "待开展验证"
    : prep.status === "void"
      ? "待重新验证"
      : prep.status === "rejected"
        ? "待处理评审反馈"
        : prep.scopeType !== "full"
          ? "待完整验证"
          : prep.status !== "accepted"
            ? "待完成评审"
            : prep.eligible
              ? "待确认交付"
              : "交付准备未完成";
  const label = current
    ? `已交付 v${current.version}${sameRun ? "" : prep ? " · 最新一轮尚未交付" : " · 当前无最新报告"}`
    : data.latestDelivery
      ? `交付 v${data.latestDelivery.version} ${deliveryEffectLabels[data.latestDelivery.status]}`
      : next;
  const doc = data.latestDocument;
  const document = doc
    ? `测试报告 v${doc.version} · ${documentLabels[doc.status]}`
    : "尚未生成测试报告";
  const guide = data.latestGuide
    ? `业务指南 v${data.latestGuide.version} · ${documentLabels[data.latestGuide.status]}`
    : "尚未生成业务指南";
  return { review, next, label, document, guide, sameRun };
}
const deliveryEffectLabels = {
  valid: "有效",
  invalidated: "已失效",
  revoked: "已撤销",
  superseded: "已被替代",
};
const documentLabels = {
  generating: "生成中",
  succeeded: "已生成",
  failed: "生成失败",
};

export function deliveryIssueAction(code: string) {
  const actions: Record<string, string> = {
    RUN_NOT_LATEST: "请从需求顶部查看最新验证记录的交付准备。",
    FULL_SCOPE_REQUIRED:
      "按约定范围开展完整验证，在同一个真实报告中覆盖必验项。",
    HUMAN_ACCEPTANCE_REQUIRED:
      "审阅检查项并完成本轮人工评审；作废报告需重新验证。",
    SOURCE_IDENTITY_REQUIRED:
      "先提交源码，再针对明确且无未提交改动的版本实际验证。",
    EVIDENCE_UNAVAILABLE: "核对本轮证据是否完整可读，保留已有验证与审核事实。",
    DELIVERY_MATERIALS_INVALID:
      "在下一次真实报告发布前，准备并上传需求、地图、构建清单与业务说明素材。",
  };
  return actions[code] ?? "请核对材料与验证记录后重新检查交付准备。";
}
