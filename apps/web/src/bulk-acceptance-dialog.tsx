import type { RefObject } from "react";
import type { Run as RunData } from "@acceptances/api-client";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Status } from "./client";
import { ReviewCounts } from "./review";

export function BulkAcceptanceDialog({
  run,
  busy,
  open,
  error,
  trigger,
  onOpenChange,
  onConfirm,
}: {
  run: RunData;
  busy: boolean;
  open: boolean;
  error: string;
  trigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const report = run.report;
  const rejectedIDs = new Set(
    run.checkReviews
      .filter((item) => item.status === "rejected")
      .map((item) => item.checkId),
  );
  const rejectedChecks = report.checks.filter((check) =>
    rejectedIDs.has(check.id),
  );
  const exceptionalChecks = report.checks.filter(
    (check) => check.status !== "passed",
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
        className="review-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogDescription className="sr-only">
          确认本轮全部检查项人工通过，原始验证结果与历史判断保留。
        </DialogDescription>
        <>
          <div className="section-heading">
            <DialogTitle>确认本轮交付</DialogTitle>
            <Button
              autoFocus
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
          </div>
          <p className="prose">{report.title}</p>
          <p>
            人工状态 <Status value={run.status} />
          </p>
          {run.status === "void" && (
            <Alert role="note" className="notice">
              此 Run 已作废，仅可添加补充说明。作废原因：{run.voidReason}
            </Alert>
          )}
          <p>
            本轮共 {report.checks.length}{" "}
            项，确认后全部人工通过，不受当前搜索或筛选影响。
          </p>
          <ReviewCounts counts={run.reviewCounts} />
          {rejectedChecks.length > 0 && (
            <Alert role="note" className="notice">
              <p>
                以下 {rejectedChecks.length}{" "}
                项已有人工不通过判断，将改为通过，原判断保留在历史中。
              </p>
              <ul>
                {rejectedChecks.map((check) => (
                  <li key={check.id}>
                    {check.id} · {check.title}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {exceptionalChecks.length > 0 && (
            <Alert role="note" className="notice">
              <p>
                以下项目原始验证未通过。确认交付表示你仍同意这些项目，无需填写理由；原始结果保持不变。
              </p>
              <ul>
                {exceptionalChecks.map((check) => (
                  <li key={check.id}>
                    {check.id} · {check.title} <Status value={check.status} />
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {report.scopeType !== "full" && (
            <Alert role="note" className="notice">
              {report.scopeType === "partial"
                ? "本轮为局部验证"
                : "本轮范围未知"}
              ，交付仅代表本轮范围，不能代表需求整体通过。
            </Alert>
          )}
          <p className="muted">
            已通过项保留当前判断。本轮交付后仍可逐项改判或撤回。
          </p>
          {error && (
            <Alert variant="destructive" role="alert">
              {error}
            </Alert>
          )}
          {busy && <p role="status">正在交付…</p>}
          <div className="actions">
            <Button
              variant="default"
              disabled={
                busy || run.status === "void" || run.status === "accepted"
              }
              onClick={() => void onConfirm()}
            >
              确认交付
            </Button>
          </div>
        </>
      </DialogContent>
    </Dialog>
  );
}
