import type { ReviewInput, Run } from "@acceptances/api-client";
import type { WriteResult } from "./campaign-run-controller";
import { filterChecklist } from "./checklist-filter.ts";

type ReviewContext = {
  run?: Run;
  writeLocked: boolean;
  filters: { query: string; status: string; humanStatus: string };
  checklistVisible: boolean;
};
export type CheckReviewContinuation =
  | { kind: "idle" }
  | {
      kind: "reveal";
      checkId: string;
      apply(action: () => boolean): boolean;
    }
  | { kind: "complete"; judgment: "accepted" | "rejected" };
type Intent = {
  checkId: string;
  judgment: "accepted" | "rejected";
  sourceRun: Run;
  committed: boolean;
};
const idle: CheckReviewContinuation = { kind: "idle" };

export function createCheckReviewFlow({
  runId,
  review,
}: {
  runId: string;
  review(input: ReviewInput): Promise<WriteResult>;
}) {
  let context: ReviewContext | undefined;
  let intent: Intent | undefined;
  let snapshot: CheckReviewContinuation = idle;
  const listeners = new Set<() => void>();
  function publish(next: CheckReviewContinuation) {
    if (snapshot === next) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function confirmed(current: Intent) {
    // An already matching judgment still needs this write's new readback.
    return Boolean(
      context?.run?.id === runId &&
      context.run !== current.sourceRun &&
      !context.writeLocked &&
      context.checklistVisible &&
      context.run.checkReviews.some(
        (item) =>
          item.checkId === current.checkId && item.status === current.judgment,
      ),
    );
  }
  function reconcile() {
    const current = intent;
    const latest = context;
    if (!current?.committed || !latest?.run || !confirmed(current)) {
      publish(idle);
      return;
    }
    const { run, filters } = latest;
    const humanStates = new Map(
      run.checkReviews.map((item) => [item.checkId, item.status]),
    );
    const checks = run.report.checks;
    const sourceIndex = checks.findIndex(
      (check) => check.id === current.checkId,
    );
    const remaining = filterChecklist(
      checks,
      humanStates,
      filters,
    ).checks.filter(
      (check) =>
        check.id !== current.checkId &&
        humanStates.get(check.id) !== "accepted",
    );
    const next =
      remaining.find((check) => checks.indexOf(check) > sourceIndex) ||
      remaining[0];
    if (!next) {
      if (snapshot.kind !== "complete")
        publish({ kind: "complete", judgment: current.judgment });
      return;
    }
    if (snapshot.kind === "reveal" && snapshot.checkId === next.id) return;
    const request: CheckReviewContinuation = {
      kind: "reveal",
      checkId: next.id,
      apply(action) {
        if (snapshot !== request || intent !== current || !confirmed(current))
          return false;
        if (!action()) return false;
        intent = undefined;
        publish(idle);
        return true;
      },
    };
    publish(request);
  }
  function cancel() {
    intent = undefined;
    publish(idle);
  }
  return {
    async review(input: ReviewInput, collapseCurrent: () => void) {
      cancel();
      const current: Intent | undefined =
        context?.run?.id === runId &&
        context.checklistVisible &&
        input.checkId &&
        (input.kind === "accepted" || input.kind === "rejected")
          ? {
              checkId: input.checkId,
              judgment: input.kind,
              sourceRun: context.run,
              committed: false,
            }
          : undefined;
      intent = current;
      const result = await review(input);
      if (current && intent === current) {
        if (result.kind === "committed") {
          current.committed = true;
          collapseCurrent();
          reconcile();
        } else cancel();
      }
      return result;
    },
    observe(next: ReviewContext) {
      context = next;
      reconcile();
    },
    cancel,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      // A StrictMode effect setup may observe again, but old intents stay canceled.
      context = undefined;
      cancel();
      listeners.clear();
    },
  };
}
export type CheckReviewFlow = ReturnType<typeof createCheckReviewFlow>;
