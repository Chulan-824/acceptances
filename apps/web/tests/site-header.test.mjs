import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const sourceURL = new URL("../src/components/site-header.tsx", import.meta.url);
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
const { SiteHeader } = exports;

test("共用导航显示统一品牌，并保留页面导航和账号操作", () => {
  const html = renderToStaticMarkup(
    createElement(
      SiteHeader,
      { context: "团队工作台" },
      createElement("nav", { "aria-label": "主导航" }, "产品介绍"),
      createElement("span", null, "当前用户：测试用户"),
    ),
  );
  assert.equal((html.match(/<header/g) || []).length, 1);
  assert.match(html, /href="\/"/);
  assert.match(html, /Acceptances/);
  assert.match(html, /团队工作台/);
  assert.match(html, /aria-label="主导航"/);
  assert.match(html, /当前用户：测试用户/);
});

test("Landing 可保留品牌入口、说明标签和锚点", () => {
  const onBrandClick = () => {};
  const props = {
    brandHref: "/landing.html",
    brandExtra: createElement("span", null, "个人本机使用"),
    onBrandClick,
    children: createElement("a", { href: "#workflow" }, "交付流程"),
  };
  const html = renderToStaticMarkup(createElement(SiteHeader, props));
  assert.match(html, /href="\/landing.html"/);
  assert.match(html, /交付验证系统/);
  assert.match(html, /个人本机使用/);
  assert.match(html, /href="#workflow"/);
  const tree = SiteHeader(props);
  const brand = tree.props.children.props.children[0].props.children[0];
  assert.equal(brand.props.onClick, onBrandClick);
});
