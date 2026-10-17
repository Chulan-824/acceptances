import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignRunController } from "../src/campaign-run-controller.ts";
const run = (id = "a", status = "pending") => ({
  id,
  campaignId: "c",
  status,
  reviews: [],
  report: { title: id },
  checkReviews: [],
  reviewCounts: { pending: 1, accepted: 0, rejected: 0 },
});
const campaign = (latestRunId = "a") => ({
  id: "c",
  projectId: "p",
  latestRunId,
  status: "pending",
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const calls = [];
  const adapter = {
    campaigns: async () => ({ items: [campaign()] }),
    campaign: async () => campaign(),
    delivery: async () => ({
      campaignId: "c",
      preparation: null,
      currentDelivery: null,
      latestDelivery: null,
      latestDocument: null,
    }),
    runs: async () => ({ items: [run()] }),
    run: async (id) => run(id),
    review: async (...args) => {
      calls.push(args);
    },
    acceptAll: async () => {},
    voidRun: async () => {},
    deleteRun: async () => {},
    project: async (id) => ({ id, name: id }),
    deleteTarget: () => adapter.deleteRun(),
    previewDeletion: () => adapter.previewDeleteRun(),
    previewDeleteRun: async () => ({ runs: 1 }),
  };
  const controller = createCampaignRunController(adapter);
  return { adapter, controller, calls };
}
const scope = { projectId: "p", campaignId: "c", runId: "a" };
async function ready(f) {
  f.controller.select(scope);
  await tick();
  return { ...f.controller.actions(), deleteRun: removal(f) };
}
function removal(f) {
  const snapshot = f.controller.getSnapshot();
  const flow = f.controller.deletion({
    ...snapshot.scope,
    kind: "run",
    runId: snapshot.selectedRunId,
    name: snapshot.selectedRunId,
  });
  return async () => {
    await flow.preview();
    return flow.confirm();
  };
}
test("M01 committed returns before readback and keeps the Run locked", async () => {
  const f = fixture();
  const actions = await ready(f);
  const read = deferred();
  f.adapter.run = () => read.promise;
  assert.deepEqual(await actions.review({ kind: "comment", body: "hello" }), {
    kind: "committed",
  });
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  read.resolve(run("a", "accepted"));
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  assert.equal(f.controller.getSnapshot().run.data.status, "accepted");
});
test("M02 failed readback retains the report; retry reads without writing again", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.run = async () => {
    throw Error("read failed");
  };
  await actions.review({ kind: "comment", body: "hello" });
  await tick();
  assert.equal(f.controller.getSnapshot().run.data.id, "a");
  assert.equal(f.controller.getSnapshot().run.error, "read failed");
  assert.equal(f.controller.getSnapshot().operation.result.kind, "committed");
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  f.adapter.run = async () => run("a", "accepted");
  await actions.refresh();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  assert.equal(f.calls.length, 1);
});
test("M03/M04 rejected requests retain reason; unknown result remains unknown after matching GET", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.review = async () => {
    throw Object.assign(Error("reason required"), {
      phase: "response",
      status: 400,
      code: "BODY_REQUIRED",
    });
  };
  assert.deepEqual(await actions.review({ kind: "comment", body: "" }), {
    kind: "rejected",
    message: "reason required",
  });
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  f.adapter.review = async () => {
    throw Object.assign(Error("lost response"), { phase: "network" });
  };
  assert.equal(
    (await actions.review({ kind: "comment", body: "hello" })).kind,
    "unknown",
  );
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  assert.equal(f.controller.getSnapshot().operation.result.kind, "unknown");
});
test("M05 success HTTP with malformed body is committed", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.review = async () => {
    throw Object.assign(Error("JSON"), { phase: "body", status: 201 });
  };
  assert.equal(
    (await actions.review({ kind: "comment", body: "hello" })).kind,
    "committed",
  );
  await tick();
});
test("M07/M09 every write shares the per-Run lock across navigation and retained actions keep their identity", async () => {
  const f = fixture();
  const actions = await ready(f);
  const write = deferred();
  f.adapter.review = () => write.promise;
  const pending = actions.review({ kind: "comment", body: "hello" });
  assert.equal((await actions.voidRun("wrong")).kind, "rejected");
  assert.equal((await actions.deleteRun()).kind, "rejected");
  assert.equal((await actions.acceptAll()).kind, "rejected");
  f.controller.select({});
  f.controller.select({ ...scope, runId: "b" });
  await tick();
  assert.equal(f.controller.getSnapshot().run.data.id, "b");
  assert.equal(
    (await actions.review({ kind: "comment", body: "double" })).kind,
    "rejected",
  );
  f.controller.select(scope);
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  f.controller.select({ ...scope, runId: "b" });
  await tick();
  write.resolve();
  await pending;
  await tick();
  assert.equal(f.controller.getSnapshot().run.data.id, "b");
  f.controller.select(scope);
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
});
test("M08/M10 old GET cannot replace or unlock post-write snapshot; refreshes coalesce", async () => {
  const f = fixture();
  const actions = await ready(f);
  const old = deferred();
  const next = deferred();
  let reads = 0;
  f.adapter.run = () => {
    reads++;
    return reads === 1 ? old.promise : next.promise;
  };
  const first = actions.refresh();
  const second = actions.refresh();
  assert.equal(reads, 1);
  // An action bound before the manual refresh may not bypass its lock.
  assert.equal(
    (await actions.review({ kind: "comment", body: "blocked" })).kind,
    "rejected",
  );
  old.resolve(run());
  await Promise.all([first, second]);
  const write = deferred();
  f.adapter.review = () => write.promise;
  const submitted = actions.review({ kind: "comment", body: "hello" });
  const during = actions.refresh();
  write.resolve();
  await submitted;
  next.resolve(run("a", "accepted"));
  await during;
  await tick();
  assert.equal(f.controller.getSnapshot().run.data.status, "accepted");
  assert.equal(f.controller.getSnapshot().writeLocked, false);
});
test("M06 peripheral failures retain snapshots without blocking dedicated Run readback", async () => {
  const f = fixture();
  const actions = await ready(f);
  for (const name of ["campaign", "campaigns", "runs"])
    f.adapter[name] = async () => {
      throw Error(name + " failed");
    };
  f.adapter.run = async () => run("a", "accepted");
  await actions.review({ kind: "comment", body: "hello" });
  await tick();
  const view = f.controller.getSnapshot();
  assert.equal(view.writeLocked, false);
  for (const name of ["campaign", "campaigns", "runs"]) {
    assert.ok(view[name].data);
    assert.equal(view[name].error, name + " failed");
  }
  assert.equal(view.runs.data.items[0].status, "accepted");
  assert.equal(view.campaign.data.status, "pending");
});
test("M11 first visit chooses latest then holds selection when latest changes", async () => {
  const f = fixture();
  f.controller.select({ projectId: "p", campaignId: "c" });
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, "a");
  f.adapter.campaign = async () => campaign("b");
  await f.controller.actions().refresh();
  assert.equal(f.controller.getSnapshot().selectedRunId, "a");
  assert.equal(f.controller.getSnapshot().isLatest, false);
  f.controller.select({ ...scope, runId: "b" });
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, "b");
});
const failure = (status, code) =>
  Object.assign(Error(code), { phase: "response", status, code });
test("M12/M13 confirmed deletion emits scoped intent and cleanup warning survives recovery", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.deleteRun = async () => {
    throw failure(500, "EVIDENCE_CLEANUP_FAILED");
  };
  f.adapter.campaign = async () => campaign("b");
  f.adapter.runs = async () => ({ items: [run("b")] });
  assert.deepEqual(await actions.deleteRun(), {
    kind: "committed",
    warning: "evidence-cleanup-failed",
  });
  await tick();
  const view = f.controller.getSnapshot();
  assert.equal(view.run.status, "missing");
  assert.equal(view.writeLocked, true);
  assert.equal(view.navigationIntent.target.runId, "a");
  f.controller.acknowledgeNavigation(view.navigationIntent.token);
  f.controller.select({ projectId: "p", campaignId: "c" });
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, "b");
  assert.deepEqual(
    f.controller.getSnapshot().notices.map((notice) => notice.target.runId),
    ["a"],
  );
});
test("M12 late delete success does not navigate back after leaving the original selection", async () => {
  const f = fixture();
  const actions = await ready(f);
  const pending = deferred();
  f.adapter.deleteRun = () => pending.promise;
  const result = actions.deleteRun();
  await tick();
  f.controller.select({ ...scope, runId: "b" });
  await tick();
  pending.resolve();
  await result;
  assert.equal(f.controller.getSnapshot().selectedRunId, "b");
  assert.equal(f.controller.getSnapshot().navigationIntent, undefined);
});
for (const outcome of ["exists", "missing", "failed"])
  test("M14 unknown DELETE readback " + outcome, async () => {
    const f = fixture();
    const actions = await ready(f);
    f.adapter.deleteRun = async () => {
      throw Error("lost");
    };
    f.adapter.run = async () => {
      if (outcome === "missing") throw failure(404, "RUN_NOT_FOUND");
      if (outcome === "failed") throw Error("read failed");
      return run();
    };
    assert.equal((await actions.deleteRun()).kind, "unknown");
    await tick();
    const view = f.controller.getSnapshot();
    assert.equal(
      view.run.status,
      { exists: "ready", missing: "missing", failed: "error" }[outcome],
    );
    assert.equal(view.writeLocked, outcome !== "exists");
    assert.equal(view.operation.result.kind, "unknown");
    assert.equal(view.navigationIntent, undefined);
  });
test("M15 missing parent prohibits writes even if the Run GET succeeds", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.campaign = async () => {
    throw failure(404, "CAMPAIGN_NOT_FOUND");
  };
  await actions.refresh();
  assert.equal(f.controller.getSnapshot().campaign.status, "missing");
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  assert.equal(
    (await actions.review({ kind: "comment", body: "no" })).kind,
    "rejected",
  );
});
test("M16 after deleting latest, historical accepted Run is displayed without becoming latest", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.campaign = async () => campaign("");
  f.adapter.runs = async () => ({ items: [run("old", "accepted")] });
  f.adapter.run = async () => run("old", "accepted");
  await actions.deleteRun();
  f.controller.select({ projectId: "p", campaignId: "c" });
  await tick();
  const view = f.controller.getSnapshot();
  assert.equal(view.selectedRunId, "old");
  assert.equal(view.isLatest, false);
  assert.equal(view.campaign.data.status, "pending");
});
test("M08 delayed old Run and peripheral errors cannot cover the accepted post-write state", async () => {
  const f = fixture();
  const oldRun = deferred();
  const oldCampaign = deferred();
  const oldRuns = deferred();
  f.adapter.run = () => oldRun.promise;
  f.adapter.campaign = () => oldCampaign.promise;
  f.adapter.runs = () => oldRuns.promise;
  f.controller.select(scope);
  f.adapter.run = async (id) => run(id);
  f.adapter.campaign = async () => campaign();
  f.adapter.runs = async () => ({ items: [run()] });
  f.controller.select({ ...scope, runId: "b" });
  await tick();
  f.controller.select(scope);
  await tick();
  const next = deferred();
  f.adapter.run = () => next.promise;
  await f.controller.actions().review({ kind: "comment", body: "hello" });
  oldRun.resolve(run("a", "rejected"));
  oldCampaign.reject(Error("old failure"));
  oldRuns.resolve({ items: [run("a", "rejected")] });
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  assert.equal(f.controller.getSnapshot().run.data.status, "pending");
  assert.equal(f.controller.getSnapshot().campaign.error, undefined);
  next.resolve(run("a", "accepted"));
  await tick();
  assert.equal(
    f.controller.getSnapshot().runs.data.items[0].status,
    "accepted",
  );
});
test("M03 stale domain rejection performs readback before allowing another write", async () => {
  const f = fixture();
  const actions = await ready(f);
  const read = deferred();
  f.adapter.run = () => read.promise;
  f.adapter.voidRun = async () => {
    throw failure(409, "RUN_ALREADY_VOID");
  };
  assert.equal((await actions.voidRun("reason")).kind, "rejected");
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  read.resolve(run("a", "void"));
  await tick();
  assert.equal(f.controller.getSnapshot().run.data.status, "void");
  assert.equal(f.controller.getSnapshot().writeLocked, false);
});
test("M16 recovery waits for fresh Campaign latest before choosing a historical fallback", async () => {
  const f = fixture();
  const actions = await ready(f);
  const fresh = deferred();
  f.adapter.campaign = () => fresh.promise;
  f.adapter.runs = async () => ({ items: [run("old", "accepted")] });
  await actions.deleteRun();
  f.controller.select({ projectId: "p", campaignId: "c" });
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, undefined);
  fresh.resolve(campaign(""));
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, "old");
});
test("route-bound actions cannot write the previous view during selection effect delay", async () => {
  const f = fixture();
  await ready(f);
  const actions = f.controller.actions({ ...scope, runId: "b" });
  assert.equal(
    (await actions.review({ kind: "comment", body: "wrong target" })).kind,
    "rejected",
  );
  assert.equal(f.calls.length, 0);
});
test("M15 parent remains missing until its own successful read proves existence", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.campaign = async () => {
    throw failure(404, "CAMPAIGN_NOT_FOUND");
  };
  await actions.refresh();
  const check = deferred();
  f.adapter.campaign = () => check.promise;
  const retry = actions.refresh();
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  check.resolve(campaign());
  await retry;
  assert.equal(f.controller.getSnapshot().writeLocked, false);
});
test("D7 deletion on the default Campaign URL recovers even when routing does not change", async () => {
  const f = fixture();
  const defaultScope = { projectId: "p", campaignId: "c" };
  f.controller.select(defaultScope);
  await tick();
  f.adapter.campaign = async () => campaign("b");
  f.adapter.runs = async () => ({ items: [run("b")] });
  await removal(f)();
  const { token } = f.controller.getSnapshot().navigationIntent;
  f.controller.acknowledgeNavigation(token);
  f.controller.select(defaultScope);
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, "b");
  assert.equal(f.controller.getSnapshot().run.data.id, "b");
});
test("M12 confirmed deletion cannot be resurrected by a manual refresh before recovery", async () => {
  const f = fixture();
  const actions = await ready(f);
  await actions.deleteRun();
  await actions.refresh();
  assert.equal(f.controller.getSnapshot().run.status, "missing");
  assert.equal(f.controller.getSnapshot().writeLocked, true);
});
test("prewrite origin guard rejection is known, but SAVE_FAILED stays unknown", async () => {
  const f = fixture();
  const actions = await ready(f);
  for (const code of ["LOCAL_HOST_REQUIRED", "ORIGIN_NOT_ALLOWED"]) {
    f.adapter.review = async () => {
      throw failure(403, code);
    };
    assert.equal(
      (await actions.review({ kind: "comment", body: "test" })).kind,
      "rejected",
    );
  }
  f.adapter.review = async () => {
    throw failure(500, "SAVE_FAILED");
  };
  assert.equal(
    (await actions.review({ kind: "comment", body: "test" })).kind,
    "unknown",
  );
  await tick();
});
test("missing Project locks even when the stale Campaign and Run still return data", async () => {
  const f = fixture();
  const actions = await ready(f);
  f.adapter.campaigns = async () => {
    throw failure(404, "PROJECT_NOT_FOUND");
  };
  await actions.refresh();
  assert.equal(f.controller.getSnapshot().writeLocked, true);
});
test("M12 confirmed deleted Run is excluded from stale list snapshots during recovery", async () => {
  const f = fixture();
  const actions = await ready(f);
  await actions.deleteRun();
  await actions.refresh();
  assert.deepEqual(f.controller.getSnapshot().runs.data.items, []);
});

for (const parent of ["campaign", "campaigns"]) {
  test(`confirmed missing ${parent} survives failed retries until its own GET succeeds`, async () => {
    const f = fixture();
    const actions = await ready(f);
    const successfulRead = f.adapter[parent];
    for (const status of [404, 500, undefined]) {
      f.adapter[parent] = async () => {
        throw Object.assign(Error("parent unavailable"), { status });
      };
      await actions.refresh();
      assert.equal(f.controller.getSnapshot()[parent].status, "missing");
      assert.equal(f.controller.getSnapshot().run.status, "ready");
      assert.equal(f.controller.getSnapshot().writeLocked, true);
      for (const result of [
        await actions.review({ kind: "comment", body: "must not submit" }),
        await actions.acceptAll(),
        await actions.voidRun("must not submit"),
        await actions.deleteRun(),
      ])
        assert.equal(result.kind, "rejected");
    }
    f.adapter[parent] = successfulRead;
    await actions.refresh();
    assert.equal(f.controller.getSnapshot()[parent].status, "ready");
    assert.equal(f.controller.getSnapshot().writeLocked, false);
    assert.equal(
      (await actions.review({ kind: "comment", body: "recovered" })).kind,
      "committed",
    );
    await tick();
  });
}

test("confirmed missing Run stays deleted during retries and read failures until GET succeeds", async () => {
  const f = fixture();
  const actions = await ready(f);
  for (const status of [404, 500, undefined]) {
    const read = deferred();
    f.adapter.run = () => read.promise;
    const retry = actions.refresh();
    if (status !== 404)
      assert.equal(f.controller.getSnapshot().run.status, "missing");
    read.reject(Object.assign(Error("run unavailable"), { status }));
    await retry;
    assert.equal(f.controller.getSnapshot().run.status, "missing");
    assert.equal(f.controller.getSnapshot().writeLocked, true);
  }
  f.adapter.run = async () => run();
  await actions.refresh();
  assert.equal(f.controller.getSnapshot().run.status, "ready");
  assert.equal(f.controller.getSnapshot().writeLocked, false);
});

test("delivery read failure does not lock Run review or claim no delivery", async () => {
  const f = fixture();
  f.adapter.delivery = async () => {
    throw new Error("delivery read failed");
  };
  await ready(f);
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  assert.equal(f.controller.getSnapshot().delivery.status, "error");
  assert.equal(f.controller.getSnapshot().delivery.data, undefined);
});

test("delivery refresh follows review without waiting for peripheral read", async () => {
  const f = fixture();
  const actions = await ready(f);
  const delivery = deferred();
  f.adapter.delivery = () => delivery.promise;
  await actions.acceptAll();
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  assert.equal(f.controller.getSnapshot().delivery.status, "refreshing");
  delivery.resolve({
    campaignId: "c",
    preparation: { runId: "a", status: "accepted" },
  });
  await tick();
  assert.equal(
    f.controller.getSnapshot().delivery.data.preparation.status,
    "accepted",
  );
});

test("late delivery response cannot overwrite another campaign", async () => {
  const f = fixture();
  const delayed = deferred();
  f.adapter.delivery = (id) =>
    id === "c" ? delayed.promise : Promise.resolve({ campaignId: id });
  f.controller.select(scope);
  await tick();
  f.controller.select({ projectId: "p", campaignId: "other", runId: "b" });
  await tick();
  delayed.resolve({ campaignId: "c" });
  await tick();
  assert.equal(f.controller.getSnapshot().delivery.data.campaignId, "other");
});
