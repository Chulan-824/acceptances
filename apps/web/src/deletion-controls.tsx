import { useRef } from "react";
import { useCampaignRun } from "./campaign-run";
import { DeletionPreviewContent } from "./deletion-preview";
import {
  deletionKey,
  deletionLabels,
  deletionReturnPath,
  type DeletionTarget,
} from "./deletion";
import { Alert } from "./components/reui/alert";
import { Button } from "./components/ui/button";
import { DropdownMenuItem } from "./components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogTitle,
  AlertDialogDescription,
} from "./components/ui/alert-dialog";

export function DeleteButton({
  target,
  menuItem = false,
  disabled = false,
}: {
  target: DeletionTarget;
  menuItem?: boolean;
  disabled?: boolean;
}) {
  const { view, controller } = useCampaignRun();
  const state = view.deletions[deletionKey(target)];
  const actions = controller.deletion(target);
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = state?.preview.data;
  const busy =
    disabled ||
    (state && state.phase !== "settled") ||
    state?.presence === "missing" ||
    state?.preview.status === "loading";
  const label = deletionLabels[target.kind];
  const button = (
    <Button
      variant="destructive"
      ref={trigger}
      disabled={!!busy}
      onClick={() => void actions.preview()}
    >
      删除{label}
    </Button>
  );
  return (
    <>
      {menuItem ? (
        <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
          {button}
        </DropdownMenuItem>
      ) : (
        button
      )}
      {state?.preview.error && (
        <Alert variant="destructive" role="alert">
          {state.preview.error}
        </Alert>
      )}
      <AlertDialog
        open={state?.preview.status === "ready"}
        onOpenChange={(open) => {
          if (!open) actions.cancel();
        }}
      >
        <AlertDialogContent
          className="delete-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogTitle>确认删除{label}</AlertDialogTitle>
          {preview && (
            <>
              <AlertDialogDescription>
                <DeletionPreviewContent preview={preview} />
              </AlertDialogDescription>
              <div className="actions">
                <AlertDialogCancel autoFocus onClick={actions.cancel}>
                  取消
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={!!busy}
                  onClick={() => void actions.confirm()}
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

export function DeletionFeedback({
  target,
  navigate,
}: {
  target: DeletionTarget;
  navigate: (path: string) => void;
}) {
  const { view, controller, actions } = useCampaignRun();
  const state = view.deletions[deletionKey(target)];
  if (!state) return null;
  const missing = state.presence === "missing";
  const unknown = state.result?.kind === "unknown";
  const back = () => {
    if (target.kind === "run") void actions.recoverCampaign();
    navigate(deletionReturnPath(target));
  };
  if (missing)
    return (
      <Alert role="alert">
        {state.deleted
          ? `该${deletionLabels[target.kind]}已删除。`
          : `该${deletionLabels[target.kind]}已不存在。`}
        {unknown && <p>对象已不存在，本次删除结果未确认。</p>}
        <Button onClick={back}>
          {target.kind === "project"
            ? "返回首页"
            : target.kind === "campaign"
              ? "返回项目"
              : "返回需求"}
        </Button>
      </Alert>
    );
  if (state.phase === "submitting")
    return (
      <p role="status">正在删除{deletionLabels[target.kind]}，请等待结果。</p>
    );
  if (!state.result) return null;
  return (
    <>
      {state.result.kind !== "committed" && (
        <Alert role="alert">
          {unknown
            ? "删除结果未知，请核对当前记录后再决定是否重试。"
            : "删除请求未完成。"}
          {state.result.message}
          {state.error && <p>状态核对失败：{state.error}</p>}
          {(unknown || state.phase === "checking") && (
            <Button onClick={() => void controller.deletion(target).recheck()}>
              重试核对
            </Button>
          )}
        </Alert>
      )}
      {state.phase === "checking" && !state.error && (
        <p role="status">正在核对当前状态…</p>
      )}
    </>
  );
}

export function DeletionNotices({ destination }: { destination: string }) {
  const { view, controller } = useCampaignRun();
  return (
    <>
      {view.notices
        .filter((notice) => deletionReturnPath(notice.target) === destination)
        .map((notice) => (
          <Alert role="alert" key={notice.id}>
            {deletionLabels[notice.target.kind]}“{notice.target.name}
            ”已删除，部分附件清理失败。
            <Button
              aria-label={`关闭${notice.target.name}的清理提示`}
              onClick={() => controller.dismissNotice(notice.id)}
            >
              关闭提示
            </Button>
          </Alert>
        ))}
    </>
  );
}
