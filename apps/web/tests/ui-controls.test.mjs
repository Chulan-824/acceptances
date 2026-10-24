import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("business UI uses shared controls instead of browser widgets", async () => {
  const root = new URL("../src/", import.meta.url);
  const controls = new Set([
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "label",
    "details",
    "summary",
    "dialog",
    "progress",
    "meter",
    "fieldset",
    "legend",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
  ]);
  const violations = [];
  for (const path of await readdir(root, { recursive: true })) {
    if (!path.endsWith(".tsx") || path.startsWith("components/ui/")) continue;
    const url = new URL(path, root);
    const source = ts.createSourceFile(
      fileURLToPath(url),
      await readFile(url, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        controls.has(node.tagName.getText(source))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        violations.push(`${path}:${line + 1} ${node.tagName.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(
    violations,
    [],
    "Keep native control implementations in components/ui and compose them in business pages.",
  );
});
