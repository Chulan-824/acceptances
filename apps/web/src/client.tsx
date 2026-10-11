import { useEffect, useId, useRef, useState } from "react";
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
export function Status({ value }: { value: string }) {
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
  };
  return <span className={`badge ${value}`}>{labels[value] || value}</span>;
}
export function Load({ error }: { error?: string }) {
  return <p role={error ? "alert" : "status"}>{error || "正在加载…"}</p>;
}
export function DeleteButton({
  path,
  label,
  onDeleted,
}: {
  path: string;
  label: string;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<DeletePreview>();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(remove: boolean) {
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await request(path, "DELETE");
        onDeleted();
      } else setPreview(await request<DeletePreview>(`${path}/delete-preview`));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="danger"
        disabled={busy}
        onClick={() => void act(false)}
      >
        删除{label}
      </button>
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={() => setPreview(undefined)}
      >
        {preview && (
          <>
            <h2 id={titleId}>确认删除{label}</h2>
            <p>
              将永久删除 {preview.projects} 个项目、{preview.campaigns} 个需求、
              {preview.runs} 次验证、{preview.evidence} 个附件和{" "}
              {preview.reviews} 条反馈。无法恢复。
            </p>
            <div className="actions">
              <button
                autoFocus
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                取消
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void act(true)}
              >
                确认永久删除
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
