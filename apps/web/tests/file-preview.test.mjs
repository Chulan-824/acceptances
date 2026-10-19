import test from "node:test";
import assert from "node:assert/strict";
import {
  readPreviewPage,
  readByteRange,
  loadFilePreview,
  PREVIEW_PAGE_BYTES,
  PREVIEW_MAX_BYTES,
} from "../src/file-preview-data.ts";
import {
  formatPreviewJSON,
  parsePreviewCSV,
  resolvePreviewImage,
} from "../src/file-preview-formats.ts";
import { createPreviewModuleLoader } from "../src/preview-module-loader.ts";

function rangedFile(t, content) {
  const bytes = new TextEncoder().encode(content);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    const start = Number(from),
      end = Math.min(Number(to), bytes.length - 1);
    calls.push([start, end]);
    if (!bytes.length)
      return new Response("", { headers: { "Content-Length": "0" } });
    if (start >= bytes.length) return new Response(null, { status: 416 });
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
    });
  });
  return { bytes, calls };
}
const signal = () => new AbortController().signal;

test("preview module failures can retry and successful concurrent imports are shared", async () => {
  let calls = 0;
  const module = { viewer: "loaded" };
  const load = createPreviewModuleLoader(async () => {
    if (++calls === 1) throw new Error("offline");
    return module;
  }, "diff-evidence-viewer");
  const first = load();
  assert.equal(load(), first);
  await assert.rejects(first, /offline/);
  const retry = load();
  assert.equal(load(), retry);
  assert.equal(await retry, module);
  assert.equal(await load(), module);
  assert.equal(calls, 2);
});

test("UTF-8 page boundaries preserve every byte of Chinese, emoji, BOM and long lines", async (t) => {
  for (const padding of [0, 1, 2, 3]) {
    const text =
      "\ufeff" +
      "a".repeat(PREVIEW_PAGE_BYTES - 7 + padding) +
      "中😀文".repeat(70_000) +
      "末尾\n";
    const { bytes } = rangedFile(t, text);
    const pages = [];
    for (
      let index = 0;
      index < Math.ceil(bytes.length / PREVIEW_PAGE_BYTES);
      index++
    )
      pages.push(await readPreviewPage("/file", index, signal()));
    assert.equal(pages.map((page) => page.text).join(""), text);
    assert.equal(pages.at(-1).end, bytes.length);
    for (let i = 1; i < pages.length; i++)
      assert.equal(pages[i].start, pages[i - 1].end);
    assert.equal(
      (await readPreviewPage("/file", 0, signal())).text,
      pages[0].text,
    );
  }
});

test("large files return only the first bounded page and keep the complete size", async (t) => {
  const { calls, bytes } = rangedFile(t, "中".repeat(PREVIEW_MAX_BYTES));
  const result = await loadFilePreview("/large.md", true, signal());
  assert.equal(result.text, undefined);
  assert.match(result.warning, /分段原文/);
  assert.equal(result.page.total, bytes.length);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1] < PREVIEW_PAGE_BYTES + 3);
});

test("UTF-8 terminal characters finish in the preceding page without losing or repeating text", async (t) => {
  for (const character of ["é", "中", "😀"]) {
    for (let offset = 1; offset < Buffer.byteLength(character); offset++) {
      for (const boundary of [1, 2]) {
        const text =
          "a".repeat(boundary * PREVIEW_PAGE_BYTES - offset) + character;
        const { bytes, calls } = rangedFile(t, text);
        const pages = [];
        do {
          pages.push(
            await readPreviewPage("/tail.log", pages.length, signal()),
          );
        } while (pages.at(-1).end < bytes.length);
        assert.equal(pages.length, boundary);
        assert.ok(pages.every((page) => page.text.length > 0));
        assert.equal(pages.map((page) => page.text).join(""), text);
        assert.equal(pages.at(-1).end, bytes.length);
        assert.equal(calls.length, boundary);
      }
    }
  }
});

test("small rich files load completely, while excessive lines use paged original", async (t) => {
  const text = "line\n".repeat(20_000);
  rangedFile(t, text);
  assert.equal((await loadFilePreview("/small.md", true, signal())).text, text);
  rangedFile(t, "\n".repeat(30_001));
  assert.equal(
    (await loadFilePreview("/many.md", true, signal())).text,
    undefined,
  );
});

test("empty file ranges accept a 200 response", async (t) => {
  rangedFile(t, "");
  assert.deepEqual(await readPreviewPage("/empty", 0, signal()), {
    text: "",
    total: 0,
    start: 0,
    end: 0,
    index: 0,
  });
});

test("ignored, shifted, incomplete and malformed ranges are never treated as a valid page", async (t) => {
  for (const response of [
    () => new Response("wrong", { status: 200 }),
    () => new Response("wrong", { status: 206 }),
    () =>
      new Response("wrong", {
        status: 206,
        headers: { "Content-Range": "bytes 0-4/100" },
      }),
    () =>
      new Response("bad", {
        status: 206,
        headers: { "Content-Range": "bytes 10-19/100" },
      }),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(readByteRange("/wrong", 10, 19, signal()));
  }
});

test("a server ignoring Range is cancelled before an oversized full response is read", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Length": String(PREVIEW_MAX_BYTES * 2) } },
      ),
  );
  await assert.rejects(readPreviewPage("/ignored", 0, signal()), /分段读取/);
  assert.equal(cancelled, true);
});

test("cancelling a pending page read cancels its body", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const controller = new AbortController();
  const pending = readPreviewPage("/pending", 0, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("JSON formatting preserves integer precision, duplicate keys and numeric lexemes", () => {
  const formatted = formatPreviewJSON(
    '{"id":900719925474099312345,"id":-0,"x":1e400,"s":"a\\"b\\n"}',
  );
  assert.match(formatted, /900719925474099312345/);
  assert.match(formatted, /"id": -0/);
  assert.match(formatted, /1e400/);
  assert.match(formatted, /a\\"b\\n/);
  assert.throws(() => formatPreviewJSON('{"bad":}'));
  assert.throws(
    () => formatPreviewJSON("[".repeat(41) + "0" + "]".repeat(41)),
    /层级/,
  );
});

test("CSV handles quoted separators, escaped quotes, multiline fields and empty last cells", () => {
  assert.deepEqual(
    parsePreviewCSV('name,note,\r\n"a,b","first\nsecond ""quoted""",\r\n'),
    [
      ["name", "note", ""],
      ["a,b", 'first\nsecond "quoted"', ""],
    ],
  );
  assert.deepEqual(parsePreviewCSV("\n"), [[""]]);
  assert.deepEqual(parsePreviewCSV("a,"), [["a", ""]]);
  assert.throws(() => parsePreviewCSV('"open'));
  assert.throws(() => parsePreviewCSV('"closed"garbage'));
  assert.throws(() => parsePreviewCSV("a,b\n".repeat(5_001)), /预览范围/);
});

test("Markdown images resolve only exact archived image names in the supplied context", () => {
  const resources = [
    { path: "截图.png", url: "/delivery/frozen/shot" },
    { path: "note.md", url: "/note" },
  ];
  assert.equal(
    resolvePreviewImage("./%E6%88%AA%E5%9B%BE.png", resources),
    "/delivery/frozen/shot",
  );
  for (const src of [
    "images/截图.png",
    "../截图.png",
    "/截图.png",
    "https://external/截图.png",
    "data:image/png,x",
    "note.md",
    "%",
    "missing.png",
  ])
    assert.equal(resolvePreviewImage(src, resources), undefined, src);
});
