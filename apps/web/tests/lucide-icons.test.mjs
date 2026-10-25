import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const sourceURL = new URL(
  "../src/components/reui/file-type.tsx",
  import.meta.url,
);
const require = createRequire(sourceURL);
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = await readFile(sourceURL, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
});
const utils = await import("../src/lib/utils.ts");
const exports = {};
new Function("require", "exports", outputText)(
  (name) => (name === "@/lib/utils" ? utils : require(name)),
  exports,
);
const { FileType, getFileType, getFileTypeCategory, FILE_TYPE_CATEGORIES } =
  exports;
const render = (props) => renderToStaticMarkup(createElement(FileType, props));

test("file identification and extension labels survive Lucide rendering", () => {
  for (const [name, type, category, label] of [
    ["report.PDF", "pdf", "document", "PDF"],
    ["data.csv", "csv", "spreadsheet", "CSV"],
    ["application/json", "json", "code", "JSON"],
    ["image/png", "png", "image", "PNG"],
    ["video/mp4", "mp4", "video", "MP4"],
    ["audio/mpeg", "mp3", "audio", "MP3"],
    ["backup.tar.gz", "gz", "archive", "GZ"],
  ]) {
    assert.equal(getFileType(name), type, name);
    assert.equal(getFileTypeCategory(type), category, name);
    const html = render({ type, variant: "mono" });
    assert.match(html, /class="lucide lucide-file/);
    assert.ok(html.includes(`data-category="${category}"`));
    assert.ok(html.includes(`${label} file`));
    assert.ok(html.includes(`>${label}</span>`));
  }
  assert.match(render({ type: "custom" }), />CUSTOM<\/span>/);
  assert.match(
    render({ type: "pdf", label: "V3" }),
    /aria-label="V3, PDF file"/,
  );
});

test("all file families use Lucide and glyph or custom icon suppresses the label", () => {
  for (const type of FILE_TYPE_CATEGORIES) {
    const html = render({ type, glyph: true });
    assert.match(html, /class="lucide lucide-/);
    assert.doesNotMatch(html, /data-slot="file-type-label"/);
  }
  assert.doesNotMatch(render({ type: "pdf", glyph: true }), /file-type-label/);
  assert.doesNotMatch(render({ type: "pdf", label: null }), /file-type-label/);
  const html = render({
    type: "pdf",
    icon: createElement("span", null, "custom"),
    "aria-hidden": true,
  });
  assert.match(html, /file-type-custom-icon/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /file-type-label/);
});
