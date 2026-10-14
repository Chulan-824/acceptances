import type { WriteResult } from "./campaign-run-controller";
import { Alert } from "./components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogTitle,
  AlertDialogDescription,
} from "./components/ui/alert-dialog";
import { DropdownMenuItem } from "./components/ui/dropdown-menu";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { useEffect, useRef, useState } from "react";
import { request, type DeletePreview } from "@acceptances/api-client";
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
export function DeleteButton({
  path,
  label,
  onDeleted,
  menuItem = false,
  disabled = false,
  commands,
}: {
  path: string;
  label: string;
  onDeleted?: () => void;
  disabled?: boolean;
  commands?: {
    preview: () => Promise<DeletePreview>;
    remove: () => Promise<WriteResult>;
  };
  menuItem?: boolean;
}) {
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<DeletePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(remove: boolean) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        if (commands) {
          const result = await commands.remove();
          if (result.kind === "committed") setPreview(undefined);
          else {
            setError(
              result.kind === "unknown"
                ? `删除结果未知，请核对当前记录。${result.message}`
                : result.message,
            );
            setPreview(undefined);
          }
        } else {
          await request(path, "DELETE");
          onDeleted?.();
        }
      } else
        setPreview(
          await (commands
            ? commands.preview()
            : request<DeletePreview>(`${path}/delete-preview`)),
        );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {menuItem ? (
        <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
          <Button
            variant="destructive"
            ref={deleteTrigger}
            disabled={busy || disabled}
            onClick={() => void act(false)}
          >
            删除{label}
          </Button>
        </DropdownMenuItem>
      ) : (
        <Button
          variant="destructive"
          ref={deleteTrigger}
          disabled={busy || disabled}
          onClick={() => void act(false)}
        >
          删除{label}
        </Button>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      <AlertDialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(undefined);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            deleteTrigger.current?.focus();
          }}
          className="delete-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <AlertDialogTitle>确认删除{label}</AlertDialogTitle>
          {preview && (
            <>
              <AlertDialogDescription>
                将永久删除 {preview.projects} 个项目、{preview.campaigns}{" "}
                个需求、
                {preview.runs} 次验证、{preview.evidence} 个附件和{" "}
                {preview.reviews} 条反馈。无法恢复。
                {(preview.retainedDeliveries ?? 0) > 0 && (
                  <span className="block">
                    保留 {preview.retainedDeliveries} 份交付快照及{" "}
                    {preview.retainedDocuments ?? 0} 份业务说明。
                    对应交付将失效，仍可从交付版本查看历史及复制证据。
                  </span>
                )}
              </AlertDialogDescription>
              {error && <Alert variant="destructive">{error}</Alert>}
              <div className="actions">
                <AlertDialogCancel
                  autoFocus
                  disabled={busy}
                  onClick={() => setPreview(undefined)}
                >
                  取消
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={busy || disabled}
                  onClick={() => void act(true)}
                >
                  确认永久删除
                </Button>
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
