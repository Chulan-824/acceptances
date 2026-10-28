import test from "node:test";
import assert from "node:assert/strict";
import { createCheckReviewFlow } from "../src/check-review-flow.ts";
import { createCampaignRunController } from "../src/campaign-run-controller.ts";

const filters = { query: "", status: "all", humanStatus: "all" };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function run(states = {}) {
  return {
    id: "r",
    campaignId: "c",
    status: "pending",
    reviews: [],
    checkReviews: Object.entries(states).map(([checkId, status]) => ({
      checkId,
      status,
    })),
    report: {
      checks: ["earlier", "current", "accepted", "rejected", "tail"].map(
        (id) => ({
          id,
          title: id === "tail" ? "other group" : `review ${id}`,
          expected: "expected",
          actual: "actual",
          status: id === "tail" ? "failed" : "passed",
        }),
      ),
    },
  };
}
function fixture(
  review = async () => ({ kind: "committed" }),
  initial = run(),
) {
  const flow = createCheckReviewFlow({ runId: "r", review });
  let context = {
    run: initial,
    filters,
    writeLocked: false,
    checklistVisible: true,
  };
  const observe = (changes = {}) => {
    context = { ...context, ...changes };
    flow.observe(context);
  };
  observe();
  let collapsed = 0;
  return {
    flow,
    observe,
    get collapsed() {
      return collapsed;
    },
    submit: (kind = "accepted", checkId = "current") =>
      flow.review({ kind, checkId, body: "reason" }, () => collapsed++),
  };
}

for (const kind of ["accepted", "rejected"]) {
  test(`${kind}: committed collapses immediately, waits for readback, and reveals once`, async () => {
    const write = deferred();
    const f = fixture(() => write.promise);
    const pending = f.submit(kind);
    assert.equal(f.collapsed, 0);
    f.observe({ writeLocked: true });
    const result = { kind: "committed", warning: "evidence-cleanup-failed" };
    write.resolve(result);
    assert.equal(await pending, result);
    assert.equal(f.collapsed, 1);
    assert.equal(f.flow.getSnapshot().kind, "idle");
    f.observe({
      run: run({ current: kind, accepted: "accepted", rejected: "rejected" }),
      writeLocked: false,
    });
    const request = f.flow.getSnapshot();
    assert.equal(request.kind, "reveal");
    assert.equal(request.checkId, "rejected");
    f.observe();
    assert.equal(f.flow.getSnapshot(), request);
    let actions = 0;
    assert.equal(
      request.apply(() => false),
      false,
    );
    assert.equal(f.flow.getSnapshot(), request);
    assert.equal(
      request.apply(() => {
        actions++;
        return true;
      }),
      true,
    );
    assert.equal(
      request.apply(() => {
        actions++;
        return true;
      }),
      false,
    );
    f.observe({ run: run({ current: kind }) });
    assert.equal(f.flow.getSnapshot().kind, "idle");
    assert.equal(actions, 1);
    assert.equal(f.collapsed, 1);
  });

  for (const resultKind of ["rejected", "unknown"]) {
    test(`${kind}: ${resultKind} is returned unchanged and matching GET cannot start continuation`, async () => {
      const result = { kind: resultKind, message: "failed" };
      const f = fixture(async () => result);
      assert.equal(await f.submit(kind), result);
      f.observe({ run: run({ current: kind }) });
      assert.equal(f.collapsed, 0);
      assert.equal(f.flow.getSnapshot().kind, "idle");
    });
  }

  for (const phase of ["submitting", "readback", "queued reveal"]) {
    for (const interruption of ["query", "status", "humanStatus", "tab"]) {
      test(`${kind}: ${interruption} cancels during ${phase}, returning never revives old work`, async () => {
        const write = deferred();
        const f = fixture(() => write.promise);
        const pending = f.submit(kind);
        if (phase !== "submitting") {
          write.resolve({ kind: "committed" });
          await pending;
        }
        if (phase === "queued reveal")
          f.observe({ run: run({ current: kind }) });
        const old = f.flow.getSnapshot();
        f.flow.cancel();
        const changed =
          interruption === "tab"
            ? { checklistVisible: false }
            : { filters: { ...filters, [interruption]: "changed" } };
        f.observe(changed);
        f.observe({ filters, checklistVisible: true });
        if (phase === "submitting") {
          write.resolve({ kind: "committed" });
          assert.equal((await pending).kind, "committed");
        }
        f.observe({ run: run({ current: kind }) });
        assert.equal(f.collapsed, phase === "submitting" ? 0 : 1);
        assert.equal(f.flow.getSnapshot().kind, "idle");
        if (old.kind === "reveal")
          assert.equal(
            old.apply(() => assert.fail("canceled frame ran")),
            false,
          );
      });
    }
  }

  test(`${kind}: already matching state waits for a new readback, even when reads finish before the write callback`, async () => {
    const write = deferred();
    const f = fixture(() => write.promise, run({ current: kind }));
    const pending = f.submit(kind);
    write.resolve({ kind: "committed" });
    await pending;
    assert.equal(f.flow.getSnapshot().kind, "idle");
    f.observe({ run: run({ current: kind }) });
    assert.equal(f.flow.getSnapshot().kind, "reveal");

    const early = deferred();
    const g = fixture(() => early.promise);
    const second = g.submit(kind);
    g.observe({ run: run({ current: kind }) });
    assert.equal(g.flow.getSnapshot().kind, "idle");
    early.resolve({ kind: "committed" });
    await second;
    assert.equal(g.flow.getSnapshot().kind, "reveal");
  });
}

test("ordinary refreshes pause queued actions; judgment, Run and visibility must still match at execution", async () => {
  const f = fixture();
  await f.submit();
  f.observe({ run: run({ current: "accepted" }) });
  const old = f.flow.getSnapshot();
  for (const change of [
    { writeLocked: true },
    { run: run({ current: "rejected" }) },
    { checklistVisible: false },
    { run: { ...run({ current: "accepted" }), id: "other" } },
  ]) {
    f.observe(change);
    assert.equal(f.flow.getSnapshot().kind, "idle");
    assert.equal(
      old.apply(() => assert.fail("stale frame ran")),
      false,
    );
    f.observe({
      run: run({ current: "accepted" }),
      writeLocked: false,
      checklistVisible: true,
    });
    assert.equal(f.flow.getSnapshot().kind, "reveal");
  }
  assert.equal(f.collapsed, 1);
});

test("the next check follows report order, wraps, retains all filters and reports both kinds of completion", async () => {
  const f = fixture();
  f.observe({
    filters: { query: "review", status: "passed", humanStatus: "pending" },
  });
  await f.submit("accepted", "rejected");
  f.observe({
    run: run({
      rejected: "accepted",
      current: "accepted",
      accepted: "accepted",
    }),
  });
  assert.equal(f.flow.getSnapshot().checkId, "earlier");
  f.flow.cancel();
  for (const kind of ["accepted", "rejected"]) {
    f.observe({ filters: { ...filters, query: "current" } });
    await f.submit(kind);
    f.observe({ run: run({ current: kind }) });
    assert.deepEqual(f.flow.getSnapshot(), {
      kind: "complete",
      judgment: kind,
    });
    const complete = f.flow.getSnapshot();
    f.observe();
    assert.equal(f.flow.getSnapshot(), complete);
    f.flow.cancel();
    assert.equal(f.flow.getSnapshot().kind, "idle");
  }
});

test("comments, withdrawals and superseding submissions cancel every old automatic action", async () => {
  for (const kind of ["comment", "pending"]) {
    const f = fixture();
    await f.submit();
    f.observe({ run: run({ current: "accepted" }) });
    const old = f.flow.getSnapshot();
    await f.submit(kind);
    f.observe({ run: run({ current: "accepted" }) });
    assert.equal(f.collapsed, 1);
    assert.equal(f.flow.getSnapshot().kind, "idle");
    assert.equal(
      old.apply(() => assert.fail("superseded request ran")),
      false,
    );
  }
  const writes = [deferred(), deferred()];
  const f = fixture(() => writes.shift().promise);
  const [firstWrite, secondWrite] = writes;
  const first = f.submit();
  const second = f.submit("rejected");
  firstWrite.resolve({ kind: "committed" });
  await first;
  assert.equal(f.collapsed, 0);
  secondWrite.resolve({ kind: "committed" });
  await second;
  f.observe({ run: run({ current: "rejected" }) });
  assert.equal(f.collapsed, 1);
  assert.equal(f.flow.getSnapshot().kind, "reveal");
});

test("dispose invalidates late completion and frames; observing a fresh lifecycle never replays them", async () => {
  for (const phase of ["submitting", "queued"]) {
    const write = deferred();
    const f = fixture(() => write.promise);
    const pending = f.submit();
    if (phase === "queued") {
      write.resolve({ kind: "committed" });
      await pending;
      f.observe({ run: run({ current: "accepted" }) });
    }
    const old = f.flow.getSnapshot();
    f.flow.dispose();
    const replacement = fixture();
    f.observe({ run: run({ current: "accepted" }) });
    if (phase === "submitting") {
      write.resolve({ kind: "committed" });
      await pending;
    }
    assert.equal(f.collapsed, phase === "queued" ? 1 : 0);
    assert.equal(replacement.collapsed, 0);
    assert.equal(f.flow.getSnapshot().kind, "idle");
    if (old.kind === "reveal")
      assert.equal(
        old.apply(() => assert.fail("disposed request ran")),
        false,
      );
  }
});

test("effect setup after cleanup accepts fresh work and publishes stable snapshots", async () => {
  const f = fixture();
  await f.submit();
  f.observe({ run: run({ current: "accepted" }) });
  const old = f.flow.getSnapshot();
  f.flow.dispose();
  let notifications = 0;
  const unsubscribe = f.flow.subscribe(() => notifications++);
  f.observe({ run: run() });
  await f.submit();
  assert.equal(notifications, 0);
  f.observe({ run: run({ current: "accepted" }) });
  const current = f.flow.getSnapshot();
  assert.equal(current.kind, "reveal");
  assert.equal(notifications, 1);
  assert.equal(
    old.apply(() => assert.fail("old lifecycle ran")),
    false,
  );
  f.observe();
  assert.equal(f.flow.getSnapshot(), current);
  assert.equal(notifications, 1);
  assert.equal(
    current.apply(() => true),
    true,
  );
  assert.equal(notifications, 2);
  unsubscribe();
});

test("real controller composition keeps committed separate from failed readback and retries only GET", async () => {
  let writes = 0;
  const campaign = {
    id: "c",
    projectId: "p",
    latestRunId: "r",
    status: "pending",
  };
  const adapter = {
    project: async () => ({ id: "p", name: "p" }),
    campaigns: async () => ({ items: [campaign] }),
    campaign: async () => campaign,
    delivery: async () => ({}),
    runs: async () => ({ items: [run()] }),
    run: async () => run(),
    review: async () => {
      writes++;
    },
  };
  const controller = createCampaignRunController(adapter);
  controller.select({ projectId: "p", campaignId: "c", runId: "r" });
  await tick();
  const actions = controller.actions();
  const f = fixture(actions.review, controller.getSnapshot().run.data);
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    f.observe({ run: snapshot.run.data, writeLocked: snapshot.writeLocked });
  });
  const read = deferred();
  adapter.run = () => read.promise;
  assert.equal((await f.submit()).kind, "committed");
  assert.equal(f.collapsed, 1);
  assert.equal(f.flow.getSnapshot().kind, "idle");
  read.reject(Error("read failed"));
  await tick();
  assert.equal(controller.getSnapshot().run.status, "error");
  assert.equal(f.flow.getSnapshot().kind, "idle");
  adapter.run = async () => run({ current: "accepted" });
  await actions.refresh();
  assert.equal(f.flow.getSnapshot().kind, "reveal");
  assert.equal(writes, 1);
  unsubscribe();
});
