import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "../src/index.ts";

test("request preserves an explicit refusal's status and business code", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: "RUN_VOID", message: "记录已作废" }, { status: 409 }),
  );
  await assert.rejects(
    request("/runs/run/reviews", "POST", { kind: "accepted" }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "记录已作废");
      assert.equal(error.status, 409);
      assert.equal(error.code, "RUN_VOID");
      assert.equal(error.phase, "response");
      return true;
    },
  );
});

test("a successful write with unreadable JSON retains its successful status", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("{", { status: 201 }),
  );
  await assert.rejects(request("/runs/run/reviews", "POST", {}), (error) => {
    assert.equal(error.status, 201);
    assert.equal(error.phase, "body");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test("a lost response remains a network failure with no invented status", async (t) => {
  const cause = new TypeError("Failed to fetch");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });
  await assert.rejects(request("/runs/run/reviews", "POST", {}), (error) => {
    assert.equal(error.phase, "network");
    assert.equal(error.status, undefined);
    assert.equal(error.message, "Failed to fetch");
    assert.equal(error.cause, cause);
    return true;
  });
});

test("cleanup failure keeps the code needed to recognize committed deletion", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { code: "EVIDENCE_CLEANUP_FAILED", message: "附件清理失败" },
      { status: 500 },
    ),
  );
  await assert.rejects(request("/runs/run", "DELETE"), {
    name: "RequestError",
    phase: "response",
    status: 500,
    code: "EVIDENCE_CLEANUP_FAILED",
    message: "附件清理失败",
  });
});

test("unreadable error bodies retain HTTP status without inventing a business code", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("gateway error", { status: 502 }),
  );
  await assert.rejects(request("/runs/run"), {
    name: "RequestError",
    phase: "response",
    status: 502,
    code: undefined,
    message: "请求失败（502）",
  });
});

test("successful JSON and empty DELETE responses retain the existing API", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/v1/runs/run");
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { reason: "报告错误" });
    return Response.json({ id: "run", status: "void" });
  });
  assert.deepEqual(await request("/runs/run", "POST", { reason: "报告错误" }), {
    id: "run",
    status: "void",
  });
  assert.equal(await request("/runs/run", "DELETE"), undefined);
});
