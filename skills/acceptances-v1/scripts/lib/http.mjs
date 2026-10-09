import { fail, token, uuid } from "./local.mjs";
export class API {
  constructor(config) {
    this.config = config;
    this.secret = token(config.tokenFile);
  }
  async request(method, path, body, headers = {}) {
    let response;
    try {
      response = await fetch(this.config.url + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${this.secret}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      fail("SERVICE_UNAVAILABLE", "请求失败；重试复用原身份，先确认服务状态");
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      fail("API_INVALID", "服务未返回 V1 JSON");
    }
    if (!response.ok)
      fail(
        envelope.error?.code || "API_REJECTED",
        "服务拒绝请求；检查 token 项目、权限、有效期或版本冲突",
      );
    return { data: envelope.data, etag: response.headers.get("etag") };
  }
  async list(path) {
    const items = [],
      seen = new Set();
    let cursor = "";
    do {
      const result = await this.request(
        "GET",
        `${path}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!Array.isArray(result.data?.items))
        fail("API_INVALID", "分页响应无效");
      items.push(...result.data.items);
      cursor = result.data.nextCursor || "";
      if (cursor && seen.has(cursor)) fail("API_INVALID", "分页游标重复");
      seen.add(cursor);
    } while (cursor);
    return items;
  }
  get base() {
    return `/api/v1/projects/${uuid(this.config.projectId)}`;
  }
}
export async function chooseBasis(
  api,
  campaignId,
  planId,
  targetId,
  confirmedETag,
  reason,
) {
  const path = `${api.base}/campaigns/${uuid(campaignId)}`;
  const current = await api.request("GET", path);
  if (current.data.planId === planId && current.data.targetId === targetId)
    return { status: "unchanged" };
  const initial = !current.data.planId && !current.data.targetId;
  if (!initial && (!confirmedETag || confirmedETag !== current.etag))
    return {
      status: "confirmation_required",
      etag: current.etag,
      current: current.data,
      proposed: { planId, targetId },
    };
  if (!current.etag) fail("API_INVALID", "验收依据缺少 ETag");
  const result = await api.request(
    "PATCH",
    path + "/basis",
    { planId: uuid(planId), targetId: uuid(targetId), reason },
    {
      "If-Match": current.etag,
      "Idempotency-Key": `basis-${campaignId}-${planId}-${targetId}-${current.etag}`,
    },
  );
  return {
    status: initial ? "initial_adopted" : "confirmed_adopted",
    ...result.data,
  };
}
