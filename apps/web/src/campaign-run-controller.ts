import type {
  Campaign,
  Project,
  Run,
  ReviewInput,
  DeletePreview,
  CampaignDeliveryOverview,
} from "@acceptances/api-client";

import {
  deletionKey,
  deletionCovers,
  type DeletionTarget,
} from "./deletion.ts";

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
  delivery(campaignId: string): Promise<CampaignDeliveryOverview>;
  runs(campaignId: string): Promise<{ items: Run[] }>;
  run(runId: string): Promise<Run>;
  review(runId: string, input: ReviewInput): Promise<unknown>;
  acceptAll(runId: string): Promise<unknown>;
  voidRun(runId: string, reason: string): Promise<unknown>;
  project(projectId: string): Promise<Project>;
  deleteTarget(target: DeletionTarget): Promise<unknown>;
  previewDeletion(target: DeletionTarget): Promise<DeletePreview>;
}
interface DeletionData {
  target: DeletionTarget;
  attempt: number;
  preview: ReadState<DeletePreview>;
  presence: "present" | "missing" | "error";
  error?: string;
}
export interface DeletionState extends DeletionData {
  phase: Operation["phase"];
  result?: WriteResult;
  deleted?: boolean;
}
export interface DeletionNotice {
  id: number;
  target: DeletionTarget;
}
export interface Operation {
  deletion?: DeletionData;
  deleted?: boolean;
  phase: "submitting" | "checking" | "settled";
  result?: WriteResult;
}
export interface CampaignRunView {
  scope: CampaignRunScope;
  campaigns: ReadState<{ items: Campaign[] }>;
  campaign: ReadState<Campaign>;
  delivery: ReadState<CampaignDeliveryOverview>;
  runs: ReadState<{ items: Run[] }>;
  run: ReadState<Run>;
  selectedRunId?: string;
  isLatest: boolean;
  writeLocked: boolean;
  operation?: Operation;
  navigationIntent?: { target: DeletionTarget; token: number };
  deletions: Record<string, DeletionState>;
  notices: DeletionNotice[];
  projectsRevision: number;
  dashboardRevision: number;
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
    delivery: { status: "idle" },
    runs: { status: "idle" },
    run: { status: "idle" },
    isLatest: false,
    writeLocked: true,
    deletions: {},
    notices: [],
    projectsRevision: 0,
    dashboardRevision: 0,
  };
  const listeners = new Set<() => void>();
  const operations = new Map<string, Operation>();
  let generation = 0;
  let sequence = 0;
  const deletionReads = new Map<
    string,
    { attempt: number; promise: Promise<void> }
  >();
  const runKey = (id: string) => `run:${id}`;
  const gone = (key: string) => {
    const operation = operations.get(key);
    return !!operation?.deleted || operation?.deletion?.presence === "missing";
  };
  const currentTarget = (target: DeletionTarget) =>
    deletionCovers(target, { ...view.scope, runId: view.selectedRunId });
  let reading: Promise<void> | undefined;
  const peripheralReads: Partial<
    Record<"campaigns" | "campaign" | "runs" | "delivery", Promise<void>>
  > = {};
  let snapshot = view;
  const publish = () => {
    const operation = view.selectedRunId
      ? operations.get(runKey(view.selectedRunId))
      : undefined;
    view = {
      ...view,
      operation,
      deletions: Object.fromEntries(
        [...operations].flatMap(([key, entry]) =>
          entry.deletion
            ? [
                [
                  key,
                  {
                    ...entry.deletion,
                    phase: entry.phase,
                    result: entry.result,
                    deleted: entry.deleted,
                  },
                ],
              ]
            : [],
        ),
      ),
      isLatest:
        !!view.selectedRunId &&
        view.selectedRunId === view.campaign.data?.latestRunId,
      writeLocked:
        gone(`project:${view.scope.projectId}`) ||
        gone(`campaign:${view.scope.campaignId}`) ||
        view.campaigns.status === "missing" ||
        view.campaign.status === "missing" ||
        !view.run.data ||
        view.run.status !== "ready" ||
        (!!operation && operation.phase !== "settled"),
    };
    snapshot = { ...view };
    if (view.runs.data)
      snapshot.runs = {
        ...view.runs,
        data: {
          items: view.runs.data.items
            .filter((item) => !gone(runKey(item.id)))
            .map((item) =>
              item.id === view.run.data?.id ? view.run.data : item,
            ),
        },
      };
    if (view.campaigns.data)
      snapshot.campaigns = {
        ...view.campaigns,
        data: {
          items: view.campaigns.data.items
            .filter((item) => !gone(`campaign:${item.id}`))
            .map((item) =>
              item.id === view.campaign.data?.id ? view.campaign.data : item,
            ),
        },
      };
    if (gone(`project:${view.scope.projectId}`))
      snapshot.campaigns = { status: "missing" };
    if (gone(`campaign:${view.scope.campaignId}`))
      snapshot.campaign = { status: "missing" };
    listeners.forEach((listener) => listener());
  };
  function invalidate() {
    generation++;
    reading = undefined;
    delete peripheralReads.campaign;
    delete peripheralReads.campaigns;
    delete peripheralReads.runs;
    delete peripheralReads.delivery;
  }
  function readRun(id: string): Promise<void> {
    const deletion = operations.get(runKey(id))?.deletion;
    if (
      deletion &&
      operations.get(runKey(id))?.result &&
      !operations.get(runKey(id))?.deleted
    )
      return recheckDeletion(deletion.target);
    if (operations.get(runKey(id))?.deleted) {
      view.run = { status: "missing" };
      publish();
      return Promise.resolve();
    }
    if (reading) return reading;
    if (operations.get(runKey(id))?.phase === "submitting")
      return Promise.resolve();
    const token = generation;
    view.run = {
      ...view.run,
      status:
        view.run.status === "missing"
          ? "missing"
          : view.run.data
            ? "refreshing"
            : "loading",
      error: undefined,
    };
    publish();
    const pending = (async () => {
      try {
        const data = await adapter.run(id);
        if (token !== generation || view.selectedRunId !== id) return;
        view.run = { status: "ready", data };
        const operation = operations.get(runKey(id));
        if (operation)
          operations.set(runKey(id), { ...operation, phase: "settled" });
      } catch (error) {
        if (token !== generation || view.selectedRunId !== id) return;
        view.run = {
          ...view.run,
          status:
            view.run.status === "missing" ||
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
    if (id && !gone(runKey(id))) {
      view.selectedRunId = id;
      publish();
      void readRun(id);
    }
  }
  function readPeripheral<
    K extends "campaigns" | "campaign" | "runs" | "delivery",
  >(
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
              view[key].status === "missing" ||
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
    return id && !gone(`project:${id}`)
      ? readPeripheral("campaigns", () => adapter.campaigns(id))
      : Promise.resolve();
  }
  function refresh(includeRun = true) {
    const tasks = [refreshCampaigns()];
    const campaignId = view.scope.campaignId;
    if (
      campaignId &&
      !gone(`project:${view.scope.projectId}`) &&
      !gone(`campaign:${campaignId}`)
    ) {
      tasks.push(
        readPeripheral("campaign", () => adapter.campaign(campaignId)),
        readPeripheral("runs", () => adapter.runs(campaignId)),
        readPeripheral("delivery", () => adapter.delivery(campaignId)),
      );
    }
    if (includeRun && view.selectedRunId)
      tasks.push(readRun(view.selectedRunId));
    return Promise.all(tasks).then(() => {});
  }
  function deletionBlocked(target: DeletionTarget) {
    const operation = operations.get(deletionKey(target));
    return (
      !currentTarget(target) ||
      gone(deletionKey(target)) ||
      gone(`project:${target.projectId}`) ||
      (target.kind !== "project" && gone(`campaign:${target.campaignId}`)) ||
      (operation !== undefined && operation.phase !== "settled") ||
      (target.kind === "run" && view.writeLocked)
    );
  }
  async function previewDeletion(target: DeletionTarget) {
    if (deletionBlocked(target)) return;
    const key = deletionKey(target);
    const previous = operations.get(key);
    if (previous?.deletion?.preview.status === "loading") return;
    const attempt = ++sequence;
    operations.set(key, {
      phase: "settled",
      result: previous?.deletion ? previous.result : undefined,
      deletion: {
        target: { ...target },
        attempt,
        presence: "present",
        preview: { status: "loading" },
      },
    });
    publish();
    try {
      const data = await adapter.previewDeletion(target);
      const operation = operations.get(key);
      if (operation?.deletion?.attempt !== attempt) return;
      operations.set(key, {
        ...operation,
        deletion: { ...operation.deletion, preview: { status: "ready", data } },
      });
    } catch (error) {
      const operation = operations.get(key);
      if (operation?.deletion?.attempt !== attempt) return;
      operations.set(key, {
        ...operation,
        deletion: {
          ...operation.deletion,
          preview: {
            status: "error",
            error: String(error instanceof Error ? error.message : error),
          },
        },
      });
    }
    publish();
  }
  function cancelDeletionPreview(target: DeletionTarget) {
    const key = deletionKey(target);
    const operation = operations.get(key);
    if (!operation?.deletion || operation.phase !== "settled") return;
    operations.set(key, {
      ...operation,
      deletion: {
        ...operation.deletion,
        attempt: ++sequence,
        preview: { status: "idle" },
      },
    });
    publish();
  }
  function refreshDeletionLists(target: DeletionTarget) {
    view.dashboardRevision++;
    if (target.kind === "project") view.projectsRevision++;
    if (view.scope.projectId === target.projectId) {
      invalidate();
      // Restart reads retired by invalidation, including a newly selected Run.
      void refresh(!currentTarget(target));
    }
    publish();
  }
  function recheckDeletion(target: DeletionTarget): Promise<void> {
    const key = deletionKey(target);
    const operation = operations.get(key);
    if (
      !operation?.deletion ||
      operation.deleted ||
      operation.phase === "submitting"
    )
      return Promise.resolve();
    const { attempt } = operation.deletion;
    const pending = deletionReads.get(key);
    if (pending?.attempt === attempt) return pending.promise;
    operations.set(key, {
      ...operation,
      phase: "checking",
      deletion: { ...operation.deletion, error: undefined },
    });
    if (target.kind === "run" && currentTarget(target)) {
      view.run = {
        ...view.run,
        status:
          view.run.status === "missing"
            ? "missing"
            : view.run.data
              ? "refreshing"
              : "loading",
        error: undefined,
      };
    }
    publish();
    const active = () => operations.get(key)?.deletion?.attempt === attempt;
    const promise = (async () => {
      try {
        if (target.kind === "project") await adapter.project(target.projectId);
        else if (target.kind === "campaign") {
          const data = await adapter.campaign(target.campaignId);
          if (active() && currentTarget(target))
            view.campaign = { status: "ready", data };
        } else {
          const data = await adapter.run(target.runId);
          if (active() && currentTarget(target))
            view.run = { status: "ready", data };
        }
        const latest = operations.get(key);
        if (!active() || !latest?.deletion) return;
        const wasMissing = latest.deletion.presence === "missing";
        operations.set(key, {
          ...latest,
          phase: "settled",
          deletion: {
            ...latest.deletion,
            presence: "present",
            error: undefined,
          },
        });
        if (wasMissing) refreshDeletionLists(target);
      } catch (error) {
        const latest = operations.get(key);
        if (!active() || !latest?.deletion) return;
        const missing = (error as { status?: number })?.status === 404;
        const presence =
          missing || latest.deletion.presence === "missing"
            ? "missing"
            : "error";
        const message = error instanceof Error ? error.message : String(error);
        operations.set(key, {
          ...latest,
          deletion: {
            ...latest.deletion,
            presence,
            error: missing ? undefined : message,
          },
        });
        if (target.kind === "run" && currentTarget(target))
          view.run = {
            ...view.run,
            status: presence,
            error: missing ? undefined : message,
          };
        if (missing && latest.deletion.presence !== "missing")
          refreshDeletionLists(target);
      } finally {
        if (deletionReads.get(key)?.attempt === attempt)
          deletionReads.delete(key);
        if (active()) publish();
      }
    })();
    deletionReads.set(key, { attempt, promise });
    return promise;
  }
  async function confirmDeletion(target: DeletionTarget): Promise<WriteResult> {
    const key = deletionKey(target);
    const previous = operations.get(key);
    if (
      deletionBlocked(target) ||
      previous?.deletion?.preview.status !== "ready"
    )
      return { kind: "rejected", message: "请重新查看删除范围并确认。" };
    const attempt = ++sequence;
    const deletion: DeletionData = {
      ...previous.deletion,
      attempt,
      preview: { status: "idle" },
      error: undefined,
    };
    // Parent deletion has no global child-write lock. Keep unrelated Run reads
    // alive until deletion is confirmed or absence is established.
    if (target.kind === "run") invalidate();
    operations.set(key, { phase: "submitting", deletion });
    publish();
    let result: WriteResult;
    let missing = false;
    try {
      await adapter.deleteTarget(target);
      result = { kind: "committed" };
    } catch (error) {
      result = classify(error, true);
      missing = new Set([
        "NOT_FOUND",
        "RUN_NOT_FOUND",
        "CAMPAIGN_NOT_FOUND",
        "PROJECT_NOT_FOUND",
      ]).has((error as { code?: string })?.code || "");
    }
    if (result.kind === "committed") {
      operations.set(key, {
        phase: "settled",
        result,
        deleted: true,
        deletion: { ...deletion, presence: "missing" },
      });
      if (result.warning)
        view.notices = [
          ...view.notices,
          { id: attempt, target: deletion.target },
        ];
      if (currentTarget(target)) {
        if (target.kind === "run") view.run = { status: "missing" };
        view.navigationIntent = { target: deletion.target, token: ++sequence };
      }
      refreshDeletionLists(target);
    } else {
      operations.set(key, {
        phase: result.kind === "unknown" || missing ? "checking" : "settled",
        result,
        deletion,
      });
      publish();
      if (result.kind === "unknown" || missing) void recheckDeletion(target);
      if (target.kind === "run" && currentTarget(target)) void refresh(false);
    }
    return result;
  }
  async function write(
    id: string | undefined,
    operation: () => Promise<unknown>,
  ): Promise<WriteResult> {
    if (!id || id !== view.selectedRunId || view.writeLocked)
      return { kind: "rejected", message: "正在刷新或保存，请稍后再试。" };
    invalidate();
    operations.set(runKey(id), { phase: "submitting" });
    publish();
    let result: WriteResult;
    let stale = false;
    try {
      await operation();
      result = { kind: "committed" };
    } catch (error) {
      result = classify(error);
      stale = new Set([
        "RUN_NOT_FOUND",
        "NOT_FOUND",
        "RUN_VOID",
        "RUN_ALREADY_VOID",
        "CHECK_NOT_FOUND",
      ]).has((error as { code?: string })?.code || "");
    }
    operations.set(runKey(id), {
      phase: result.kind === "rejected" && !stale ? "settled" : "checking",
      result,
    });
    if (view.selectedRunId === id) {
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
      for (const [key, entry] of operations) {
        if (
          entry.deletion &&
          entry.phase === "settled" &&
          entry.deletion.preview.status !== "idle"
        )
          operations.set(key, {
            ...entry,
            deletion: {
              ...entry.deletion,
              attempt: ++sequence,
              preview: { status: "idle" },
            },
          });
      }
      const old = view.selectedRunId;
      if (
        old &&
        !operations.get(runKey(old))?.deletion &&
        operations.get(runKey(old))?.phase === "settled" &&
        operations.get(runKey(old))?.result?.kind !== "unknown"
      )
        operations.delete(runKey(old));
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
        delivery:
          scope.campaignId === view.scope.campaignId
            ? view.delivery
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
      for (const entry of operations.values()) {
        if (
          entry.deletion &&
          !entry.deleted &&
          entry.phase === "checking" &&
          currentTarget(entry.deletion.target)
        )
          void recheckDeletion(entry.deletion.target);
      }
    },
    deletion(target: DeletionTarget) {
      const bound = { ...target };
      return {
        preview: () => previewDeletion(bound),
        cancel: () => cancelDeletionPreview(bound),
        confirm: () => confirmDeletion(bound),
        recheck: () => recheckDeletion(bound),
      };
    },
    dismissNotice(id: number) {
      view.notices = view.notices.filter((notice) => notice.id !== id);
      publish();
    },
    acknowledgeNavigation(token: number) {
      const intent = view.navigationIntent;
      if (intent?.token === token) {
        view.navigationIntent = undefined;
        if (intent.target.kind === "run") void recoverCampaign();
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
      ): Promise<WriteResult> =>
        current()
          ? write(id, operation)
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
      };
    },
  };
}
