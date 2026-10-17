import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignRunController } from "../src/campaign-run-controller.ts";
import { deletionKey, deletionReturnPath } from "../src/deletion.ts";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const failure = (code, status = 500) =>
  Object.assign(Error(code), { code, status });
const scope = { projectId: "p", campaignId: "c", runId: "r" };
const project = { id: "p", name: "Project" };
const campaign = {
  id: "c",
  projectId: "p",
  title: "Campaign",
  latestRunId: "r",
  status: "pending",
};
const run = {
  id: "r",
  campaignId: "c",
  report: { title: "Run" },
  status: "pending",
};
async function fixture(kind) {
  const calls = { preview: 0, delete: 0, read: 0, writes: 0 };
  const adapter = {
    campaigns: async () => ({ items: [campaign] }),
    campaign: async () => campaign,
    project: async () => project,
    run: async () => run,
    runs: async () => ({ items: [run] }),
    delivery: async () => ({}),
    review: async () => calls.writes++,
    acceptAll: async () => calls.writes++,
    voidRun: async () => calls.writes++,
    previewDeletion: async () => {
      calls.preview++;
      return { projects: 1, campaigns: 1, runs: 1 };
    },
    deleteTarget: async () => {
      calls.delete++;
    },
  };
  const controller = createCampaignRunController(adapter);
  controller.select(scope);
  await tick();
  const target = { ...scope, kind, name: kind };
  const flow = controller.deletion(target);
  const state = () => controller.getSnapshot().deletions[deletionKey(target)];
  const setRead = (read) => {
    adapter[
      kind === "project" ? "project" : kind === "campaign" ? "campaign" : "run"
    ] = async () => {
      calls.read++;
      return read();
    };
  };
  return { adapter, controller, target, flow, state, calls, setRead };
}
for (const kind of ["project", "campaign", "run"]) {
  test(`${kind}: confirmation requires current preview, cancel and stale previews cannot delete`, async () => {
    const f = await fixture(kind);
    assert.equal((await f.flow.confirm()).kind, "rejected");
    await f.flow.preview();
    f.flow.cancel();
    assert.equal((await f.flow.confirm()).kind, "rejected");
    const old = deferred();
    f.adapter.previewDeletion = () => old.promise;
    const pending = f.flow.preview();
    f.controller.select({});
    old.resolve({ runs: 1 });
    await pending;
    assert.equal(f.state().preview.status, "idle");
    f.controller.select(scope);
    await tick();
    assert.equal((await f.flow.confirm()).kind, "rejected");
    assert.equal(f.calls.delete, 0);
  });
  test(`${kind}: duplicate submits coalesce to one DELETE and late success does not navigate`, async () => {
    const f = await fixture(kind),
      gate = deferred();
    f.adapter.deleteTarget = () => {
      f.calls.delete++;
      return gate.promise;
    };
    await f.flow.preview();
    const pending = f.flow.confirm();
    assert.equal((await f.flow.confirm()).kind, "rejected");
    await f.flow.preview();
    assert.equal(f.calls.preview, 1);
    f.controller.select({ projectId: "elsewhere" });
    gate.resolve();
    await pending;
    assert.equal(f.calls.delete, 1);
    assert.equal(f.state().deleted, true);
    assert.equal(f.controller.getSnapshot().navigationIntent, undefined);
    assert.equal(f.controller.getSnapshot().scope.projectId, "elsewhere");
  });
  test(`${kind}: cleanup failure commits, notice retains identity and survives navigation until dismissed`, async () => {
    const f = await fixture(kind);
    f.adapter.deleteTarget = async () => {
      throw failure("EVIDENCE_CLEANUP_FAILED");
    };
    await f.flow.preview();
    assert.equal((await f.flow.confirm()).kind, "committed");
    const view = f.controller.getSnapshot();
    assert.deepEqual(view.navigationIntent.target, f.target);
    assert.equal(view.notices[0].target.name, kind);
    assert.equal(
      deletionReturnPath(f.target),
      kind === "project"
        ? "/"
        : kind === "campaign"
          ? "/projects/p"
          : "/projects/p/campaigns/c",
    );
    f.controller.select({ projectId: "elsewhere" });
    assert.equal(f.controller.getSnapshot().notices.length, 1);
    f.controller.dismissNotice(view.notices[0].id);
    assert.equal(f.controller.getSnapshot().notices.length, 0);
    assert.equal(f.state().deleted, true);
  });
  test(`${kind}: unknown response stays unknown after GET 200; retry needs a new preview`, async () => {
    const f = await fixture(kind),
      read = deferred();
    f.setRead(() => read.promise);
    f.adapter.deleteTarget = async () => {
      f.calls.delete++;
      throw Error("connection lost");
    };
    await f.flow.preview();
    assert.equal((await f.flow.confirm()).kind, "unknown");
    assert.equal(f.state().phase, "checking");
    const a = f.flow.recheck(),
      b = f.flow.recheck();
    assert.equal(a, b);
    assert.equal(f.calls.read, 1);
    assert.equal((await f.flow.confirm()).kind, "rejected");
    read.resolve(
      kind === "project" ? project : kind === "campaign" ? campaign : run,
    );
    await a;
    assert.equal(f.state().phase, "settled");
    assert.equal(f.state().result.kind, "unknown");
    assert.equal((await f.flow.confirm()).kind, "rejected");
    assert.equal(f.calls.delete, 1);
    await f.flow.preview();
    await f.flow.confirm();
    await tick();
    assert.equal(f.calls.preview, 2);
    assert.equal(f.calls.delete, 2);
    assert.equal(f.controller.getSnapshot().navigationIntent, undefined);
  });
  test(`${kind}: unknown DELETE plus authoritative 404 stays missing and locked without success or retry`, async () => {
    const f = await fixture(kind);
    f.adapter.deleteTarget = async () => {
      f.calls.delete++;
      throw failure("DELETE_FAILED");
    };
    f.setRead(() => {
      throw failure("NOT_FOUND", 404);
    });
    await f.flow.preview();
    await f.flow.confirm();
    await tick();
    assert.equal(f.state().presence, "missing");
    assert.equal(f.state().deleted, undefined);
    assert.equal(f.state().result.kind, "unknown");
    assert.equal(f.controller.getSnapshot().navigationIntent, undefined);
    assert.equal(f.controller.getSnapshot().writeLocked, true);
    await f.flow.preview();
    await f.flow.confirm();
    assert.equal(f.calls.delete, 1);
    assert.equal(f.controller.getSnapshot().dashboardRevision, 1);
    assert.equal(
      f.controller.getSnapshot().projectsRevision,
      kind === "project" ? 1 : 0,
    );
  });
  test(`${kind}: readback failure preserves result and repeated recheck sends no DELETE`, async () => {
    const f = await fixture(kind);
    f.adapter.deleteTarget = async () => {
      f.calls.delete++;
      throw Error("lost");
    };
    f.setRead(() => {
      throw Error("GET failed");
    });
    await f.flow.preview();
    await f.flow.confirm();
    await tick();
    assert.equal(f.state().error, "GET failed");
    assert.equal(f.state().phase, "checking");
    await f.flow.recheck();
    assert.equal(f.calls.delete, 1);
    f.setRead(() =>
      kind === "project" ? project : kind === "campaign" ? campaign : run,
    );
    await f.flow.recheck();
    assert.equal(f.state().phase, "settled");
    assert.equal(f.state().result.kind, "unknown");
  });
  test(`${kind}: explicit rejection is retryable but requires another preview`, async () => {
    const f = await fixture(kind);
    f.adapter.deleteTarget = async () => {
      f.calls.delete++;
      throw failure("ORIGIN_NOT_ALLOWED", 403);
    };
    await f.flow.preview();
    assert.equal((await f.flow.confirm()).kind, "rejected");
    assert.equal(f.state().phase, "settled");
    await f.flow.confirm();
    assert.equal(f.calls.delete, 1);
    await f.flow.preview();
    await f.flow.confirm();
    assert.equal(f.calls.delete, 2);
  });
  test(`${kind}: known deletion cannot be resurrected by stale list/detail refresh`, async () => {
    const f = await fixture(kind),
      old = deferred();
    f.adapter.campaigns = () => old.promise;
    void f.controller.actions().refreshCampaigns();
    await f.flow.preview();
    await f.flow.confirm();
    old.resolve({ items: [campaign] });
    await tick();
    f.controller.select({});
    f.controller.select(scope);
    await tick();
    const view = f.controller.getSnapshot();
    assert.equal(f.state().deleted, true);
    assert.equal(view.writeLocked, true);
    if (kind === "project") assert.equal(view.campaigns.status, "missing");
    if (kind === "campaign") {
      assert.equal(view.campaign.status, "missing");
      assert.equal(view.campaigns.data.items.length, 0);
    }
    if (kind === "run") {
      assert.equal(view.run.status, "missing");
      assert.equal(view.runs.data.items.length, 0);
    }
  });
}
test("Run deletion shares the review/void/accept lock until authoritative readback settles", async () => {
  const f = await fixture("run"),
    gate = deferred();
  f.adapter.deleteTarget = async () => {
    throw Error("lost");
  };
  f.setRead(() => gate.promise);
  await f.flow.preview();
  await f.flow.confirm();
  const actions = f.controller.actions();
  for (const result of [
    await actions.review({}),
    await actions.voidRun("reason"),
    await actions.acceptAll(),
  ])
    assert.equal(result.kind, "rejected");
  assert.equal(f.calls.writes, 0);
  assert.equal(f.controller.getSnapshot().writeLocked, true);
  gate.resolve(run);
  await tick();
  assert.equal(f.controller.getSnapshot().writeLocked, false);
  await actions.review({});
  assert.equal(f.calls.writes, 1);
});
test("separate cleanup notices retain each object's name and do not overwrite one another", async () => {
  const f = await fixture("campaign");
  f.adapter.deleteTarget = async () => {
    throw failure("EVIDENCE_CLEANUP_FAILED");
  };
  await f.flow.preview();
  await f.flow.confirm();
  f.controller.select({ projectId: "p", campaignId: "c2" });
  await tick();
  const next = f.controller.deletion({
    kind: "campaign",
    projectId: "p",
    campaignId: "c2",
    name: "second",
  });
  await next.preview();
  await next.confirm();
  assert.deepEqual(
    f.controller.getSnapshot().notices.map((notice) => notice.target.name),
    ["campaign", "second"],
  );
  f.controller.dismissNotice(f.controller.getSnapshot().notices[0].id);
  assert.deepEqual(
    f.controller.getSnapshot().notices.map((notice) => notice.target.name),
    ["second"],
  );
});

test("late parent/Run deletion restarts interrupted reads of the new selection", async () => {
  for (const kind of ["campaign", "run"]) {
    const f = await fixture(kind),
      deletion = deferred(),
      reading = deferred();
    f.adapter.deleteTarget = () => deletion.promise;
    await f.flow.preview();
    const pending = f.flow.confirm();
    let calls = 0;
    const next = {
      ...run,
      id: "next",
      campaignId: kind === "campaign" ? "next-c" : "c",
    };
    f.adapter.run = async () => {
      calls++;
      return calls === 1 ? reading.promise : next;
    };
    f.controller.select({
      projectId: "p",
      campaignId: next.campaignId,
      runId: "next",
    });
    await tick();
    deletion.resolve();
    await pending;
    await tick();
    assert.equal(f.controller.getSnapshot().run.status, "ready");
    assert.equal(f.controller.getSnapshot().run.data.id, "next");
    assert.equal(f.controller.getSnapshot().navigationIntent, undefined);
    reading.resolve(run);
    await tick();
    assert.equal(f.controller.getSnapshot().run.data.id, "next");
  }
});

for (const kind of ["project", "campaign", "run"]) {
  test(`${kind}: NOT_FOUND rejection with failed readback stays checking until manual recheck`, async () => {
    const f = await fixture(kind);
    f.adapter.deleteTarget = async () => {
      f.calls.delete++;
      throw failure("NOT_FOUND", 404);
    };
    f.setRead(() => {
      throw Error("offline");
    });
    await f.flow.preview();
    await f.flow.confirm();
    await tick();
    assert.equal(f.state().result.kind, "rejected");
    assert.equal(f.state().phase, "checking");
    assert.equal(f.state().error, "offline");
    f.setRead(() =>
      kind === "project" ? project : kind === "campaign" ? campaign : run,
    );
    await f.flow.recheck();
    assert.equal(f.state().phase, "settled");
    assert.equal(f.calls.delete, 1);
  });
}

test("manual recovery cannot reselect an authoritatively missing Run from a stale latest pointer", async () => {
  const f = await fixture("run");
  f.adapter.deleteTarget = async () => {
    throw Error("lost");
  };
  f.setRead(() => {
    throw failure("NOT_FOUND", 404);
  });
  await f.flow.preview();
  await f.flow.confirm();
  await tick();
  await f.controller.actions().recoverCampaign();
  await tick();
  assert.equal(f.controller.getSnapshot().selectedRunId, undefined);
  assert.deepEqual(f.controller.getSnapshot().runs.data.items, []);
  assert.equal(f.state().result.kind, "unknown");
});

test("a rejected parent deletion does not cancel an independent Run refresh", async () => {
  for (const kind of ["project", "campaign"]) {
    const f = await fixture(kind),
      read = deferred();
    f.adapter.run = () => read.promise;
    const pending = f.controller.actions().refresh();
    f.adapter.deleteTarget = async () => {
      throw failure("ORIGIN_NOT_ALLOWED", 403);
    };
    await f.flow.preview();
    await f.flow.confirm();
    read.resolve(run);
    await pending;
    assert.equal(f.controller.getSnapshot().run.status, "ready");
    assert.equal(f.controller.getSnapshot().writeLocked, false);
  }
});
