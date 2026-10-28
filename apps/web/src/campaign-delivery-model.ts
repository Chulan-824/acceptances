import type {
  Campaign,
  CampaignDeliveryOverview,
} from "@acceptances/api-client";

export function buildDeliveryRegressionPrompt(
  campaign: Pick<Campaign, "id" | "projectId" | "title">,
  origin: string,
) {
  const url = new URL(
    `/projects/${encodeURIComponent(campaign.projectId)}/campaigns/${encodeURIComponent(campaign.id)}`,
    origin,
  );
  return `使用 $Acceptances-Cl，对以下需求执行“需求交付前全量回归”。

需求名称：${campaign.title}
Project ID：${campaign.projectId}
Campaign ID：${campaign.id}
需求页面：${url.href}

本次参数：
- 需求依据与版本：【填写当前已确认的需求或 PRD Snapshot】
- 业务代码目录：【填写本地仓库路径；多仓库分别列出】
- 待交付版本：【填写各仓库 commit 和实际构建版本】
- 验证环境与地址：【填写验证环境及入口】
- 浏览器回归方式：【填写本次使用的工具及登录状态】

先结合当前需求、范围地图、全部历史 Run 及人工反馈整理完整回归清单，包含合并归档的早期 Run。合并条件和预期相同的重复项，保留来源映射，补齐历史未覆盖的需求及跨功能流程。需求调整后不再适用的检查项说明依据。

在同一组待交付版本和约定环境重新执行完整清单。历史已通过的项也要复验，使用本轮实际结果与证据；浏览器按本次指定方式执行。输入仍有缺口时先查已有资料，不能确认的范围或环境再向我询问。

按正式交付材料要求准备本轮需求、范围地图、业务说明素材与真实构建信息。在原 Campaign 归档新的最终 Run、本轮证据及 regression-coverage.md，列出逐项结果、历史问题复验结论、失败、阻塞、跳过和交付材料缺口，提供最终 Run 链接供我评审。不能用历史通过拼接成本轮通过。

本次只授权验证与归档；需要修改业务代码时先说明问题，不自行修复。保留原始验证结果，不代替我提交人工通过或确认正式交付。`;
}

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
