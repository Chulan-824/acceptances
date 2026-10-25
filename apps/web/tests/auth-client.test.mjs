import test from "node:test";
import assert from "node:assert/strict";
import {
  request,
  RequestError,
} from "../../../packages/api-client/src/index.ts";

test("session expiry asks the app to log in; a rejected password remains a form error", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = events;
  let expired = 0;
  events.addEventListener("acceptances:unauthorized", () => expired++);
  try {
    for (const [code, expected] of [
      ["LOGIN_FAILED", 0],
      ["AUTH_REQUIRED", 1],
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ code }), { status: 401 });
      await assert.rejects(
        request("/auth/me"),
        (error) =>
          error instanceof RequestError &&
          error.status === 401 &&
          error.code === code,
      );
      assert.equal(expired, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
