import type {
  Campaign,
  Run,
  ReviewInput,
  DeletePreview,
} from "@acceptances/api-client";

export type WriteResult =
  | { kind: "committed"; warning?: "evidence-cleanup-failed" }
  | { kind: "rejected" | "unknown"; message: string };
export interface CampaignRunScope {
  projectId?: string;
  campaignId?: string;
  runId?: string;
}
export interface ReadState<T> {
  status: "idle" | "loading" | "ready" | "refreshing" | "error" | "missing";
  data?: T;
  error?: string;
}
export interface CampaignRunAdapter {
  campaigns(projectId: string): Promise<{ items: Campaign[] }>;
  campaign(campaignId: string): Promise<Campaign>;
  runs(campaignId: string): Promise<{ items: Run[] }>;
  run(runId: string): Promise<Run>;
  review(runId: string, input: ReviewInput): Promise<unknown>;
  acceptAll(runId: string): Promise<unknown>;
  voidRun(runId: string, reason: string): Promise<unknown>;
  deleteRun(runId: string): Promise<unknown>;
  previewDeleteRun(runId: string): Promise<DeletePreview>;
}
export interface Operation {
  deleted?: boolean;
  phase: "submitting" | "checking" | "settled";
  result?: WriteResult;
}
export interface CampaignRunView {
  scope: CampaignRunScope;
  campaigns: ReadState<{ items: Campaign[] }>;
  campaign: ReadState<Campaign>;
  runs: ReadState<{ items: Run[] }>;
  run: ReadState<Run>;
  selectedRunId?: string;
  isLatest: boolean;
  hasNewRun: boolean;
  writeLocked: boolean;
  operation?: Operation;
  navigationIntent?: CampaignRunScope & { runId: string; token: number };
  cleanupWarning?: "evidence-cleanup-failed";
}
const rejectedCodes = new Set([
  "INVALID_INPUT",
  "LOCAL_HOST_REQUIRED",
  "ORIGIN_NOT_ALLOWED",
  "INVALID_REVIEW_KIND",
  "BODY_REQUIRED",
  "CHECK_REQUIRED",
  "CHECK_NOT_FOUND",
  "REASON_REQUIRED",
  "RUN_NOT_FOUND",
  "NOT_FOUND",
  "RUN_VOID",
  "RUN_ALREADY_VOID",
]);
function classify(error: unknown, deleting = false): WriteResult {
  const detail = error as { status?: number; code?: string };
  if (deleting && detail?.code === "EVIDENCE_CLEANUP_FAILED")
    return { kind: "committed", warning: "evidence-cleanup-failed" };
  if (detail?.status && detail.status >= 200 && detail.status < 300)
    return { kind: "committed" };
  return {
    kind:
      detail?.code && rejectedCodes.has(detail.code) ? "rejected" : "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}
export function createCampaignRunController(adapter: CampaignRunAdapter) {
  let view: CampaignRunView = {
    scope: {},
    campaigns: { status: "idle" },
    campaign: { status: "idle" },
    runs: { status: "idle" },
    run: { status: "idle" },
    isLatest: false,
    hasNewRun: false,
    writeLocked: true,
  };
  const listeners = new Set<() => void>();
  const operations = new Map<string, Operation>();
  let generation = 0;
  let navigationSequence = 0;
  let reading: Promise<void> | undefined;
  const peripheralReads: Partial<
    Record<"campaigns" | "campaign" | "runs", Promise<void>>
  > = {};
  let snapshot = view;
  const publish = () => {
    const operation = view.selectedRunId
      ? operations.get(view.selectedRunId)
      : undefined;
    view = {
      ...view,
      operation,
      isLatest:
        !!view.selectedRunId &&
        view.selectedRunId === view.campaign.data?.latestRunId,
      hasNewRun:
        !!view.selectedRunId &&
        !!view.campaign.data?.latestRunId &&
        view.selectedRunId !== view.campaign.data.latestRunId,
      writeLocked:
        view.campaigns.status === "missing" ||
        view.campaign.status === "missing" ||
        !view.run.data ||
        view.run.status !== "ready" ||
        (!!operation && operation.phase !== "settled"),
    };
    snapshot = { ...view };
    if (view.run.data && view.runs.data)
      snapshot.runs = {
        ...view.runs,
        data: {
          items: view.runs.data.items.map((item) =>
            item.id === view.run.data?.id ? view.run.data : item,
          ),
        },
      };
    if (view.campaign.data && view.campaigns.data)
      snapshot.campaigns = {
        ...view.campaigns,
        data: {
          items: view.campaigns.data.items.map((item) =>
            item.id === view.campaign.data?.id ? view.campaign.data : item,
          ),
        },
      };
    listeners.forEach((listener) => listener());
  };
  function invalidate() {
    generation++;
    reading = undefined;
    delete peripheralReads.campaign;
    delete peripheralReads.campaigns;
    delete peripheralReads.runs;
  }
  function readRun(id: string): Promise<void> {
    if (operations.get(id)?.deleted) {
      view.run = { status: "missing" };
      publish();
      return Promise.resolve();
    }
    if (reading) return reading;
    if (operations.get(id)?.phase === "submitting") return Promise.resolve();
    const token = generation;
    view.run = {
      ...view.run,
      status: view.run.data ? "refreshing" : "loading",
      error: undefined,
    };
    publish();
    const pending = (async () => {
      try {
        const data = await adapter.run(id);
        if (token !== generation || view.selectedRunId !== id) return;
        view.run = { status: "ready", data };
        const operation = operations.get(id);
        if (operation) operations.set(id, { ...operation, phase: "settled" });
      } catch (error) {
        if (token !== generation || view.selectedRunId !== id) return;
        view.run = {
          ...view.run,
          status:
            (error as { status?: number })?.status === 404
              ? "missing"
              : "error",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (token === generation) {
          reading = undefined;
          publish();
        }
      }
    })();
    reading = pending;
    return pending;
  }
  function chooseRun() {
    if (
      view.selectedRunId ||
      view.campaign.status !== "ready" ||
      !view.campaign.data
    )
      return;
    const id =
      view.campaign.data.latestRunId ||
      (view.runs.status === "ready" ? view.runs.data?.items[0]?.id : undefined);
    if (id) {
      view.selectedRunId = id;
      publish();
      void readRun(id);
    }
  }
  function readPeripheral<K extends "campaigns" | "campaign" | "runs">(
    key: K,
    fetch: () => Promise<NonNullable<CampaignRunView[K]["data"]>>,
  ): Promise<void> {
    if (peripheralReads[key]) return peripheralReads[key];
    const token = generation;
    view = {
      ...view,
      [key]: {
        ...view[key],
        status:
          view[key].status === "missing"
            ? "missing"
            : view[key].data
              ? "refreshing"
              : "loading",
        error: undefined,
      },
    };
    publish();
    const pending = (async () => {
      try {
        const data = await fetch();
        if (token !== generation) return;
        view = { ...view, [key]: { status: "ready", data } };
        chooseRun();
      } catch (error) {
        if (token !== generation) return;
        view = {
          ...view,
          [key]: {
            ...view[key],
            status:
              (error as { status?: number })?.status === 404
                ? "missing"
                : "error",
            error: error instanceof Error ? error.message : String(error),
          },
        };
      } finally {
        if (token === generation) {
          delete peripheralReads[key];
          publish();
        }
      }
    })();
    peripheralReads[key] = pending;
    return pending;
  }
  function refreshCampaigns() {
    const id = view.scope.projectId;
    return id
      ? readPeripheral("campaigns", () => adapter.campaigns(id))
      : Promise.resolve();
  }
  function refresh(includeRun = true) {
    const tasks = [refreshCampaigns()];
    const campaignId = view.scope.campaignId;
    if (campaignId) {
      tasks.push(
        readPeripheral("campaign", () => adapter.campaign(campaignId)),
        readPeripheral("runs", () => adapter.runs(campaignId)),
      );
    }
    if (includeRun && view.selectedRunId)
      tasks.push(readRun(view.selectedRunId));
    return Promise.all(tasks).then(() => {});
  }
  async function write(
    id: string | undefined,
    operation: () => Promise<unknown>,
    deleting = false,
  ): Promise<WriteResult> {
    if (!id || id !== view.selectedRunId || view.writeLocked)
      return { kind: "rejected", message: "正在刷新或保存，请稍后再试。" };
    invalidate();
    operations.set(id, { phase: "submitting" });
    publish();
    let result: WriteResult;
    let stale = false;
    try {
      await operation();
      result = { kind: "committed" };
    } catch (error) {
      result = classify(error, deleting);
      stale = new Set([
        "RUN_NOT_FOUND",
        "NOT_FOUND",
        "RUN_VOID",
        "RUN_ALREADY_VOID",
        "CHECK_NOT_FOUND",
      ]).has((error as { code?: string })?.code || "");
    }
    operations.set(id, {
      phase: result.kind === "rejected" && !stale ? "settled" : "checking",
      result,
    });
    if (deleting && result.kind === "committed") {
      operations.set(id, { phase: "settled", result, deleted: true });
      if (result.warning) view.cleanupWarning = result.warning;
      if (view.selectedRunId === id) {
        invalidate();
        view.run = { status: "missing" };
        view.navigationIntent = {
          ...view.scope,
          runId: id,
          token: ++navigationSequence,
        };
        publish();
        void refresh(false);
      } else publish();
    } else if (view.selectedRunId === id) {
      invalidate();
      publish();
      void refresh(result.kind !== "rejected" || stale);
    }
    return result;
  }
  function recoverCampaign() {
    // Recovery is a new selection intent even if the browser URL is unchanged.
    view.scope = { ...view.scope, runId: undefined };
    view.selectedRunId = undefined;
    view.navigationIntent = undefined;
    view.run = { status: "idle" };
    invalidate();
    publish();
    return refresh();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(scope: CampaignRunScope) {
      if (
        view.scope.projectId === scope.projectId &&
        view.scope.campaignId === scope.campaignId &&
        view.scope.runId === scope.runId
      )
        return;
      const old = view.selectedRunId;
      if (
        old &&
        operations.get(old)?.phase === "settled" &&
        operations.get(old)?.result?.kind !== "unknown"
      )
        operations.delete(old);
      invalidate();
      view = {
        ...view,
        scope: { ...scope },
        selectedRunId: scope.runId,
        navigationIntent: undefined,
        run: { status: "idle" },
        campaign:
          scope.campaignId === view.scope.campaignId
            ? view.campaign
            : { status: "idle" },
        runs:
          scope.campaignId === view.scope.campaignId
            ? view.runs
            : { status: "idle" },
        campaigns:
          scope.projectId === view.scope.projectId
            ? view.campaigns
            : { status: "idle" },
      };
      publish();
      void refresh();
    },
    acknowledgeNavigation(token: number) {
      if (view.navigationIntent?.token === token) {
        view.navigationIntent = undefined;
        void recoverCampaign();
      }
    },
    actions(target: CampaignRunScope = view.scope) {
      const scope = { ...target };
      const id =
        scope.runId ||
        (scope.projectId === view.scope.projectId &&
        scope.campaignId === view.scope.campaignId
          ? view.selectedRunId
          : undefined);
      const current = () =>
        scope.projectId === view.scope.projectId &&
        scope.campaignId === view.scope.campaignId &&
        id === view.selectedRunId;
      const submit = (
        operation: () => Promise<unknown>,
        deleting = false,
      ): Promise<WriteResult> =>
        current()
          ? write(id, operation, deleting)
          : Promise.resolve({
              kind: "rejected",
              message: "验证记录已切换，请重新操作。",
            });
      return {
        refresh: () => (current() ? refresh() : Promise.resolve()),
        recoverCampaign: () =>
          current() ? recoverCampaign() : Promise.resolve(),
        refreshCampaigns: () =>
          scope.projectId === view.scope.projectId
            ? refreshCampaigns()
            : Promise.resolve(),
        review: (input: ReviewInput) =>
          submit(() => adapter.review(id!, input)),
        acceptAll: () => submit(() => adapter.acceptAll(id!)),
        voidRun: (reason: string) => submit(() => adapter.voidRun(id!, reason)),
        deleteRun: () => submit(() => adapter.deleteRun(id!), true),
        previewDeleteRun: () => {
          if (!id) return Promise.reject(new Error("未选择验证记录"));
          return adapter.previewDeleteRun(id);
        },
      };
    },
  };
}
