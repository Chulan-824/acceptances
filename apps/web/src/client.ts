import { api } from "@acceptances/api-client";
let csrf = "";
let expired = false;
export function setCSRF(value: string) {
  csrf = value;
  if (value) expired = false;
}
api.use({
  onRequest({ request }) {
    if (!["GET", "HEAD"].includes(request.method)) {
      if (expired && new URL(request.url).pathname !== "/api/v1/session")
        throw new Error("会话已过期，请重新登录。");
      if (csrf) request.headers.set("X-CSRF-Token", csrf);
      if (!request.headers.has("Idempotency-Key"))
        request.headers.set("Idempotency-Key", crypto.randomUUID());
    }
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) {
      expired = true;
      csrf = "";
      window.dispatchEvent(new Event("acceptances:session-expired"));
    }
    return response;
  },
});
export { api };
export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
export function rows(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function errorMessage(error: unknown): string {
  const e = record(record(error).error);
  return `${text(e.code) || "REQUEST_FAILED"}：${text(e.message) || "操作失败，请检查服务状态。"}`;
}

export function mutationHeaders() {
  return { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() };
}

// Follow server cursors rather than deriving a decision from a truncated first page.
export async function readPages(
  fetchPage: (cursor?: string) => Promise<{ data?: unknown; error?: unknown }>,
) {
  const items: RecordValue[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (page.error) throw new Error(errorMessage(page.error));
    const data = record(record(page.data).data);
    items.push(...rows(data.items));
    const next = text(data.nextCursor);
    if (next && seen.has(next)) throw new Error("服务返回了重复分页游标。");
    if (next) seen.add(next);
    cursor = next || undefined;
  } while (cursor);
  return items;
}
