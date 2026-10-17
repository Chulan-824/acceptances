import { Alert } from "./components/reui/alert";
import { Badge } from "./components/reui/badge";
import { useEffect, useState } from "react";
import { request } from "@acceptances/api-client";
export { request };
export function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
export function useResource<T>(path: string, revision = 0, retainData = false) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    path?: string;
    revision?: number;
  }>({});
  useEffect(() => {
    let active = true;
    void request<T>(path)
      .then((data) => {
        if (active) setState({ data, path, revision });
      })
      .catch((error) => {
        if (active) setState({ error: message(error), path, revision });
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return state.path === path &&
    (state.revision === revision || (retainData && state.data !== undefined))
    ? state
    : {};
}
export function Status({
  value,
  context,
}: {
  value: string;
  context?: "run" | "campaign" | "document";
}) {
  const labels: Record<string, string> = {
    pending: "待审",
    accepted: "通过",
    rejected: "不通过",
    void: "已作废",
    passed: "通过",
    failed: "失败",
    blocked: "阻塞",
    skipped: "未执行",
    comment: "评论",
    valid: "有效交付",
    invalidated: "已失效",
    revoked: "已撤销",
    superseded: "已被替代",
    generating: "生成中",
    succeeded: "生成成功",
  };
  const contextual: Record<string, Record<string, string>> = {
    run: {
      pending: "本轮待评审",
      accepted: "本轮已验收",
      rejected: "本轮人工不通过",
      void: "本轮已作废",
    },
    campaign: {
      pending: "整体待评审",
      accepted: "完整范围已验收",
      rejected: "最新一轮人工不通过",
    },
    document: { generating: "生成中", succeeded: "已生成", failed: "生成失败" },
  };
  return (
    <Badge className={`badge ${value}`}>
      {(context && contextual[context]?.[value]) || labels[value] || value}
    </Badge>
  );
}
export function Load({ error }: { error?: string }) {
  return error ? (
    <Alert variant="destructive">{error}</Alert>
  ) : (
    <p role="status">正在加载…</p>
  );
}
