import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const sourceURL = new URL("../src/deletion-preview.tsx", import.meta.url);
const require = createRequire(sourceURL);
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { outputText } = ts.transpileModule(await readFile(sourceURL, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
});
const exports = {};
new Function("require", "exports", outputText)(require, exports);
const render = (preview) =>
  renderToStaticMarkup(
    createElement(exports.DeletionPreviewContent, { preview }),
  ).replace(/<[^>]*>/g, "");
const preview = {
  projects: 1,
  campaigns: 3,
  runs: 4,
  evidence: 5,
  reviews: 6,
};

test("删除确认正文显示 PRD 版本和文件影响，同时保留原有计数与交付保留说明", () => {
  const text = render({
    ...preview,
    prdSnapshots: 2,
    prdFiles: 9,
    retainedDeliveries: 7,
    retainedDocuments: 8,
  });
  assert.match(text, /1 个项目、3 个需求、4 次验证、5 个附件/);
  assert.match(text, /2 个 PRD 版本、9 个 PRD 文件/);
  assert.match(text, /6 条反馈。无法恢复/);
  assert.match(text, /保留 7 份交付快照及 8 份交付文档/);
});

test("旧版删除预览缺少 PRD 字段时明确显示 0，不出现 undefined", () => {
  const text = render(preview);
  assert.match(text, /0 个 PRD 版本、0 个 PRD 文件/);
  assert.doesNotMatch(text, /undefined|NaN/);
});
