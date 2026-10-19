import test from "node:test";
import assert from "node:assert/strict";
import { loadDiffEvidence } from "../src/diff-evidence-data.ts";

const patch = `diff --git a/hello.ts b/hello.ts
index 1234567..89abcde 100644
--- a/hello.ts
+++ b/hello.ts
@@ -1 +1 @@
-export const greeting = "old";
+export const greeting = "你好";
`;

async function load(t, text, headers) {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(text, { headers }),
  );
  return loadDiffEvidence(
    "/evidence/implementation.diff",
    new AbortController().signal,
  );
}

test("an archived Git patch returns the complete original and the changed lines", async (t) => {
  const result = await load(t, patch);
  assert.equal(result.text, patch);
  assert.equal(result.warning, undefined);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "hello.ts");
  assert.deepEqual(result.files[0].additionLines, [
    'export const greeting = "你好";\n',
  ]);
  assert.deepEqual(result.files[0].deletionLines, [
    'export const greeting = "old";\n',
  ]);
});

test(
  "an oversized archived attachment stops the stream without returning truncated text",
  { timeout: 1000 },
  async (t) => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    await assert.rejects(
      loadDiffEvidence("/large.diff", new AbortController().signal),
      { kind: "limit" },
    );
    assert.equal(cancelled, true);
  },
);

test("unrecognized file sections are never silently omitted from a valid patch", async (t) => {
  const text =
    patch +
    `diff --git a/other.ts b/other.ts
--- a/other.ts
+++ b/other.ts
@@ not a valid hunk
-hidden
+lost
`;
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /完整|格式|识别/);
});

test("valid changes followed by unknown metadata fall back to the complete original", async (t) => {
  const text =
    patch +
    `diff --git a/other.ts b/other.ts
index 1234567..89abcde 100644
this section could not be parsed
`;
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /完整|格式|识别/);
});

test("metadata-only and binary changes explain why there are no code lines", async (t) => {
  const text = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/image.png b/image.png
index 1234567..89abcde 100644
Binary files a/image.png and b/image.png differ
`;
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.equal(result.files.length, 2);
  assert.match(result.warning, /元数据|二进制/);
});

test("extreme line lengths stop preview before parsing or rendering", async (t) => {
  await assert.rejects(
    load(
      t,
      patch.replace(
        '+export const greeting = "你好";',
        "+" + "x".repeat(20_001),
      ),
    ),
    { kind: "limit" },
  );
});

test("too many lines stop preview even when bytes are below the download limit", async (t) => {
  await assert.rejects(load(t, "\n".repeat(30_001)), { kind: "limit" });
});

test("an empty archived file has an explicit empty warning", async (t) => {
  const result = await load(t, "");
  assert.equal(result.text, "");
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /为空/);
});

test("incomplete file sections cannot masquerade as metadata-only changes", async (t) => {
  for (const suffix of [
    "diff --git a/lost.ts b/lost.ts\n",
    "diff --git a/lost.ts b/lost.ts\nindex 1234567..89abcde 100644\n",
    "diff --git a/lost.ts b/lost.ts\nrename from lost.ts\n",
    "diff --git a/lost.ts b/lost.ts\n--- a/lost.ts\n+++ b/lost.ts\n",
  ]) {
    const result = await load(t, patch + suffix);
    assert.deepEqual(result.files, [], suffix);
    assert.match(result.warning, /完整|格式/);
  }
});

test("multiple ordinary unified files are parsed without requiring a Git wrapper", async (t) => {
  const result = await load(
    t,
    `--- before.ts\t2026-10-19
+++ after.ts\t2026-10-19
@@ -1 +1 @@
-old
+new
--- /dev/null
+++ added.ts
@@ -0,0 +1 @@
+created
`,
  );
  assert.equal(result.warning, undefined);
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["after.ts", "added.ts"],
  );
  assert.deepEqual(result.files[1].additionLines, ["created\n"]);
});

test("a filename containing hunk markers is not mistaken for a hunk", async (t) => {
  const result = await load(t, patch.replaceAll("hello.ts", "hello@@name.ts"));
  assert.equal(result.warning, undefined);
  assert.equal(result.files[0].name, "hello@@name.ts");
});

test("mail patch wrappers fall back explicitly instead of omitting the wrapper", async (t) => {
  const text =
    "From 1234567890 Mon Sep 17 00:00:00 2001\nSubject: changes\n\n" + patch;
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /格式|完整/);
});

test("mixed Git and ordinary sections cannot be silently merged", async (t) => {
  const text = patch + "--- old.ts\n+++ new.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const result = await load(t, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /格式|完整/);
});

test("truncated, excessive and malformed hunk bodies retain only the raw original", async (t) => {
  for (const text of [
    patch.replace('+export const greeting = "你好";\n', ""),
    patch + "+extra\n",
    patch.replace("@@ -1 +1 @@", "@@ -2,2 +2,2 @@"),
    patch.replace("@@ -1 +1 @@", "@@@ -1 +1 @@@"),
    patch.replace("-export const", "?export const"),
  ]) {
    const result = await load(t, text);
    assert.equal(result.text, text);
    assert.deepEqual(result.files, []);
    assert.match(result.warning, /格式|完整/);
  }
});

test("oversized Content-Length cancels before reading attachment bytes", async (t) => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(body, { headers: { "Content-Length": "2097153" } }),
  );
  await assert.rejects(
    loadDiffEvidence("/huge.diff", new AbortController().signal),
    { kind: "limit" },
  );
  assert.equal(cancelled, true);
});

test("an understated Content-Length cannot bypass the actual byte limit", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(new Uint8Array(2097153), {
        headers: { "Content-Length": "1" },
      }),
  );
  await assert.rejects(
    loadDiffEvidence("/huge.diff", new AbortController().signal),
    { kind: "limit" },
  );
});

test("closing a pending attachment read cancels it and returns no stale result", async (t) => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    return new Response(body);
  });
  const pending = loadDiffEvidence("/pending.diff", controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("HTTP failures are distinguishable from preview limits and permit a fresh retry", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("unavailable", { status: 503 }),
  );
  await assert.rejects(
    loadDiffEvidence("/retry.diff", new AbortController().signal),
    { kind: "load", message: "附件请求失败（503）。" },
  );
  const retried = await load(t, patch);
  assert.equal(retried.files.length, 1);
});

test("split UTF-8 stream chunks preserve the archived original", async (t) => {
  const encoded = new TextEncoder().encode(patch);
  const body = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset++)
        controller.enqueue(encoded.subarray(offset, offset + 1));
      controller.close();
    },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(body));
  const result = await loadDiffEvidence(
    "/unicode.diff",
    new AbortController().signal,
  );
  assert.equal(result.text, patch);
  assert.equal(result.warning, undefined);
});

test("Git binary payloads clearly explain the unsupported binary preview", async (t) => {
  const text =
    "diff --git a/image.png b/image.png\nGIT binary patch\nliteral 0\nHcmV?d00001\n\n";
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /二进制/);
});

test("a format-patch separator cannot hide extra changes after a complete hunk", async (t) => {
  const text = patch + "-- \n-old2\n+new2\n";
  const result = await load(t, text);
  assert.equal(result.text, text);
  assert.deepEqual(result.files, []);
  assert.match(result.warning, /完整|识别/);
});
