import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const sourceURL = new URL("../src/campaign-prd.tsx", import.meta.url);
const require = createRequire(sourceURL);
const { outputText } = ts.transpileModule(await readFile(sourceURL, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
  },
});

function render(task, busy = false) {
  const view = {
    task,
    busy,
    shared: true,
    connectors: [{ id: "computer", online: true }],
    connectorId: "computer",
    snapshots: { items: [] },
  };
  const exports = {};
  const mockRequire = (name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react")
      return {
        useEffect() {},
        useState: (initial) => [
          typeof initial === "function" ? initial() : initial,
          () => {},
        ],
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      };
    if (name === "./auth") return { useCurrentUser: () => ({ id: "alice" }) };
    if (name === "./campaign-prd-controller")
      return { createPRDController: () => ({ getSnapshot: () => view }) };
    return new Proxy({}, { get: (_target, key) => key });
  };
  new Function("require", "exports", outputText)(mockRequire, exports);
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    visit(node.props?.children);
  }
  visit(exports.CampaignPRD({ campaignId: "campaign" }));
  return {
    submit: nodes.find((node) => node.props?.type === "submit"),
    progress: nodes.find(
      (node) => node.type === "p" && node.props?.role === "status",
    ),
    nodes,
  };
}

const hasSpinner = (node) =>
  node?.props.children.some((child) => child?.type === "Spinner") ?? false;

test("发起读取请求时立即显示 loading", () => {
  const { submit } = render(undefined, true);
  assert.equal(submit.props["aria-busy"], true);
  assert.equal(submit.props.disabled, true);
  assert.equal(hasSpinner(submit), true);
});

for (const [status, phase, label] of [
  ["queued", undefined, "等待本机领取"],
  ["fetching", undefined, "正在从 Lark 读取"],
  ["fetching", "resources", "正在读取图片与嵌入资源"],
  ["fetching", "uploading", "正在回传内容"],
]) {
  test(`${status}/${phase || "默认"} 阶段持续显示 loading 并保留取消入口`, () => {
    const { submit, progress, nodes } = render({ status, phase });
    assert.equal(submit.props["aria-busy"], true);
    assert.equal(submit.props.disabled, true);
    assert.equal(hasSpinner(submit), true);
    assert.ok(submit.props.children.includes("读取中…"));
    assert.equal(hasSpinner(progress), true);
    assert.ok(progress.props.children.includes(label));
    const cancel = nodes.find(
      (node) => node.props?.children === "取消本次导入",
    );
    assert.equal(cancel.props.disabled, undefined);
  });
}

for (const status of ["ready", "confirmed", "failed", "cancelled", "expired"]) {
  test(`${status} 阶段结束读取 loading`, () => {
    const { submit, progress } = render({ status });
    assert.equal(submit.props["aria-busy"], false);
    assert.equal(hasSpinner(submit), false);
    assert.ok(submit.props.children.includes("读取文档"));
    assert.equal(progress, undefined);
    assert.equal(submit.props.disabled, status === "ready");
  });
}
