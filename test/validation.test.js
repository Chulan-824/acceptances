import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadRound } from "../server/acceptances.js";
import { loadReceipt, sealRounds } from "../server/receipts.js";
import { writeReview } from "../server/reviews.js";
import { validateHistory } from "../server/validation-history.js";
import { validateRoundDirectory } from "../server/validation.js";
import { caseItem, makeRoot, plan, result, seal, writeRound } from "./helpers.js";

function codes(validation) {
  return new Set(validation.diagnostics.map((entry) => entry.code));
}

test("a valid Round is ready and public defaults stay derived", () => {
  const root = makeRoot();
  const item = plan("check");
  delete item.verifier;
  delete item.requiredEvidence;
  const dir = writeRound(root, "20260903-120000-valid", result("valid", [item], [caseItem("check")]));
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "ready");
  assert.equal(validation.result.plan[0].verifier, "agent");
  assert.deepEqual(validation.result.plan[0].requiredEvidence, []);
  assert.equal(codes(validation).has("VERIFIER_DEFAULTED"), true);
});

test("programmatic gates are dropped without false-positive UI checks", () => {
  const root = makeRoot();
  const gate = plan("lint", { title: "ESLint passes", method: "run eslint and confirm clean" });
  const ui = plan("ui", { title: "页面展示 ESLint 错误说明" });
  const value = result("gate", [gate, ui], [caseItem("lint"), caseItem("ui")]);
  const dir = writeRound(root, "20260903-120000-gate", value);
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "ready");
  assert.deepEqual(validation.droppedIds, ["lint"]);
  assert.deepEqual(validation.result.plan.map((entry) => entry.id), ["ui"]);
  assert.equal(validation.result.summary.total, 1);
});

test("a gates-only Round is rejected", () => {
  const root = makeRoot();
  const gate = plan("tests", { title: "Unit tests pass" });
  const dir = writeRound(root, "20260903-120000-gates-only", result("gates", [gate], [caseItem("tests")]));
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "rejected");
  assert.equal(codes(validation).has("NO_ACCEPTANCE_CHECKS"), true);
});

test("missing required evidence and not-run plans hold without rewriting status", () => {
  const root = makeRoot();
  const plans = [plan("video", { requiredEvidence: ["video"] }), plan("later")];
  const cases = [caseItem("video")];
  const dir = writeRound(root, "20260903-120000-held", result("held", plans, cases));
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "held");
  assert.equal(validation.result.cases[0].status, "pass");
  assert.deepEqual(new Set(validation.heldIds), new Set(["video", "later"]));
});

test("summary conflicts and closed values reject while unknown fields warn", () => {
  const root = makeRoot();
  const value = result("bad", [plan("check")], [caseItem("check")], { futureField: true });
  value.summary.total = 99;
  value.cases[0].status = "maybe";
  const dir = writeRound(root, "20260903-120000-summary", value);
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "rejected");
  assert.equal(codes(validation).has("SUMMARY_COUNT_MISMATCH"), true);
  assert.equal(codes(validation).has("CASE_STATUS_INVALID"), true);
  assert.equal(codes(validation).has("COMPAT_UNKNOWN_FIELD"), true);
});

test("missing title and verdict hold, while timestamps and surfaces stay strict", () => {
  const root = makeRoot();
  const held = result("held", [plan("check")], [caseItem("check", { surface: "electron" })]);
  delete held.title;
  delete held.summary.verdict;
  const heldValidation = validateRoundDirectory(writeRound(root, "20260903-120000-held-meta", held), { subject: "demo" });
  assert.equal(heldValidation.outcome, "held");
  assert.equal(heldValidation.result.cases[0].surface, "desktop");
  assert.equal(codes(heldValidation).has("ROUND_TITLE_MISSING"), true);
  assert.equal(codes(heldValidation).has("SUMMARY_VERDICT_MISSING"), true);

  const invalid = result("invalid", [plan("check")], [caseItem("check")]);
  invalid.createdAt = "2026-09-03T12:00:00";
  invalid.surfaces = ["cli"];
  const invalidValidation = validateRoundDirectory(writeRound(root, "20260903-120001-invalid-meta", invalid), { subject: "demo" });
  assert.equal(invalidValidation.outcome, "rejected");
  assert.equal(codes(invalidValidation).has("CREATED_AT_INVALID"), true);
  assert.equal(codes(invalidValidation).has("SURFACES_MISMATCH"), true);
});

test("comparison pairs and obvious textual credentials are rejected", () => {
  const root = makeRoot();
  const evidence = [{ path: "assets/proof.txt", comparison: { id: "pair", role: "before" } }];
  const dir = writeRound(
    root,
    "20260903-120000-security",
    result("security", [plan("check")], [caseItem("check", { evidence })]),
    { assets: { "proof.txt": "Authorization: Bearer abc123" } },
  );
  const validation = validateRoundDirectory(dir, { subject: "demo" });
  assert.equal(validation.outcome, "rejected");
  assert.equal(codes(validation).has("COMPARISON_PAIR_INCOMPLETE"), true);
  assert.equal(codes(validation).has("EVIDENCE_SECRET_DETECTED"), true);
});

test("redacted credentials pass and symlinked asset directories reject", () => {
  const root = makeRoot();
  const redacted = writeRound(
    root,
    "20260903-120000-redacted",
    result("redacted", [plan("check")], [caseItem("check", { evidence: ["assets/proof.json"] })]),
    { assets: { "proof.json": "{\"access_token\":\"<redacted>\"}" } },
  );
  assert.equal(validateRoundDirectory(redacted, { subject: "demo" }).outcome, "ready");

  const linkedRound = writeRound(
    root,
    "20260903-120001-link",
    result("link", [plan("link")], [caseItem("link", { evidence: ["assets/link/proof.txt"] })]),
    { assets: {} },
  );
  const outside = fs.mkdtempSync(path.join(path.dirname(root), "outside-"));
  fs.writeFileSync(path.join(outside, "proof.txt"), "proof");
  fs.symlinkSync(outside, path.join(linkedRound, "assets", "link"));
  const validation = validateRoundDirectory(linkedRound, { subject: "demo" });
  assert.equal(validation.outcome, "rejected");
  assert.equal(codes(validation).has("ASSET_TYPE_INVALID"), true);
  assert.equal(codes(validation).has("EVIDENCE_PATH_INVALID"), true);
});

test("all six public visualizations accept one valid dataset", () => {
  const root = makeRoot();
  const dataset = {
    id: "metrics",
    fields: [
      { key: "label", type: "string" },
      { key: "x", type: "number" },
      { key: "y", type: "number" },
      { key: "value", type: "number" },
      { key: "before", type: "number" },
      { key: "after", type: "number" },
    ],
    rows: [{ label: "A", x: 1, y: 2, value: 3, before: 4, after: 5 }],
  };
  const views = [
    { id: "metric", type: "metric-comparison", version: 1, dataset: "metrics", encoding: { label: "label", before: "before", after: "after" } },
    { id: "line", type: "line-chart", version: 1, dataset: "metrics", encoding: { x: "x", series: [{ field: "y" }] } },
    { id: "bar", type: "bar-chart", version: 1, dataset: "metrics", encoding: { category: "label", series: [{ field: "value" }] } },
    { id: "scatter", type: "scatter-plot", version: 1, dataset: "metrics", encoding: { x: "x", y: "y" } },
    { id: "heat", type: "heatmap", version: 1, dataset: "metrics", encoding: { x: "x", y: "y", value: "value" } },
    { id: "table", type: "table", version: 1, dataset: "metrics", encoding: { columns: ["label", "value"] } },
  ];
  const value = result("visual", [plan("visual")], [caseItem("visual", { datasets: [dataset], visualizations: views })]);
  const validation = validateRoundDirectory(writeRound(root, "20260903-120000-visual", value), { subject: "demo" });
  assert.equal(validation.outcome, "ready");
});

test("HAR assets and oversized inline datasets reject", () => {
  const root = makeRoot();
  const dataset = {
    id: "large",
    fields: [{ key: "value", type: "number" }],
    rows: Array.from({ length: 10_001 }, (_, value) => ({ value })),
  };
  const value = result(
    "large",
    [plan("large")],
    [caseItem("large", { evidence: ["assets/capture.har"], datasets: [dataset], visualizations: [] })],
  );
  const validation = validateRoundDirectory(writeRound(root, "20260903-120000-large", value, { assets: { "capture.har": "{}" } }), { subject: "demo" });
  assert.equal(validation.outcome, "rejected");
  assert.equal(codes(validation).has("SENSITIVE_ASSET_FORBIDDEN"), true);
  assert.equal(codes(validation).has("DATASET_ROW_LIMIT_EXCEEDED"), true);
});

test("receipts are idempotent and detect changed Raw Round", () => {
  const root = makeRoot();
  const round = "20260903-120000-sealed";
  const dir = writeRound(root, round, result("sealed", [plan("check")], [caseItem("check")]));
  const first = seal(root, round);
  const receipt = loadReceipt(root, "demo", round).receipt;
  sealRounds([first]);
  assert.deepEqual(loadReceipt(root, "demo", round).receipt, receipt);
  fs.appendFileSync(path.join(dir, "report.md"), "changed\n");
  const record = loadRound(root, "demo", round);
  assert.equal(record.state, "rejected");
  assert.equal(codes(record.validation).has("ROUND_TAMPERED"), true);
  assert.throws(() => seal(root, round), /ROUND_TAMPERED/);
});

test("unavailable rulesets reject and pre-seal reviews remain stale", () => {
  const root = makeRoot();
  const round = "20260903-120000-ruleset";
  writeRound(
    root,
    round,
    result("ruleset", [plan("check")], [caseItem("check")]),
    { reviews: { reviews: { check: { action: "accept", reviewedAt: "2026-09-03T12:00:01+08:00" } } } },
  );
  seal(root, round);
  const stale = loadRound(root, "demo", round);
  assert.equal(stale.reviews.reviews.check, undefined);
  assert.equal(stale.staleReviews.check.action, "accept");

  const receiptFile = path.join(root, ".meta", "demo", `${round}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  receipt.ruleset = "missing@9";
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  const unavailable = loadRound(root, "demo", round);
  assert.equal(unavailable.state, "rejected");
  assert.equal(codes(unavailable.validation).has("RULESET_UNAVAILABLE"), true);
});

test("history validates complete supersedes lineage and rejects forks", () => {
  const root = makeRoot();
  writeRound(root, "20260901-120000-old", result("old", [plan("old")], [caseItem("old")]));
  seal(root, "20260901-120000-old");
  writeRound(root, "20260902-120000-new", result("new", [plan("new", { supersedes: ["old"] })], [caseItem("new")]));
  seal(root, "20260902-120000-new");
  writeRound(root, "20260903-120000-fork", result("fork", [plan("fork", { supersedes: ["old"] })], [caseItem("fork")]));
  seal(root, "20260903-120000-fork");
  const records = ["20260901-120000-old", "20260902-120000-new", "20260903-120000-fork"].map((round) => ({ id: round, ...loadRound(root, "demo", round) }));
  const history = validateHistory(records);
  assert.equal(history.outcome, "rejected");
  assert.equal(codes(history).has("SUPERSEDES_FORK"), true);
});

test("an unresolved reject holds history until the check is retested", () => {
  const root = makeRoot();
  const first = "20260901-120000-first";
  writeRound(root, first, result("first", [plan("check")], [caseItem("check")]));
  seal(root, first);
  writeReview(root, "demo", first, { id: "check", action: "reject", reason: "still wrong" });
  let records = [{ id: first, ...loadRound(root, "demo", first) }];
  assert.equal(validateHistory(records).outcome, "held");

  const second = "20260902-120000-second";
  writeRound(root, second, result("second", [plan("check")], [caseItem("check")]));
  seal(root, second);
  records = [first, second].map((round) => ({ id: round, ...loadRound(root, "demo", round) }));
  assert.equal(validateHistory(records).outcome, "ready");
});

test("CLI reports JSON and refuses transactional sealing when one Round rejects", () => {
  const root = makeRoot();
  writeRound(root, "20260903-120000-good", result("good", [plan("good")], [caseItem("good")]));
  const bad = result("bad", [plan("bad")], [caseItem("bad")]);
  bad.summary.total = 9;
  writeRound(root, "20260903-120001-bad", bad);
  const run = spawnSync(process.execPath, [path.resolve("bin/cli.js"), "validate", root, "--json", "--seal"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 1);
  const output = JSON.parse(run.stdout);
  assert.equal(output.outcome, "rejected");
  assert.equal(output.sealed, false);
  assert.equal(fs.existsSync(path.join(root, ".meta")), false);
});

test("explicit validation path is required", () => {
  const run = spawnSync(process.execPath, [path.resolve("bin/cli.js"), "validate"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /explicit path/);
});
