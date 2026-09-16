import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { assetFile } from "../server/acceptances.js";
import { CATALOG_PATH } from "../server/catalog.js";
import { buildDelivery } from "../server/delivery.js";
import { isLocalHost, isLocalOrigin } from "../server/http.js";
import { writeReview } from "../server/reviews.js";
import { caseItem, makeRoot, plan, result, seal, writeRound } from "./helpers.js";

test("union keeps old checks and marks a newer plan without a case as not-run", () => {
  const root = makeRoot();
  writeRound(root, "20260901-120000-first", result("round-1", [plan("repeat"), plan("old")], [caseItem("repeat"), caseItem("old")]));
  seal(root, "20260901-120000-first");
  writeReview(root, "demo", "20260901-120000-first", { id: "old", action: "accept" });
  writeRound(root, "20260902-120000-second", result("round-2", [plan("repeat"), plan("new")], [caseItem("new", { status: "fail" })]));
  seal(root, "20260902-120000-second");

  const delivery = buildDelivery(root, "demo");
  const byId = new Map(delivery.items.map((item) => [item.id, item]));
  assert.equal(delivery.mode, "union");
  assert.equal(byId.get("repeat").status, "not-run");
  assert.equal(byId.get("repeat").case, null);
  assert.equal(byId.get("old").status, "pass");
  assert.equal(byId.get("new").status, "fail");
  assert.equal(delivery.summary.notRun, 1);
  assert.equal(delivery.summary.verdict, "fail");
});

test("round selection stays an immutable snapshot", () => {
  const root = makeRoot();
  writeRound(root, "20260901-120000-first", result("round-1", [plan("planned")], []));
  seal(root, "20260901-120000-first");
  const delivery = buildDelivery(root, "demo", { r: "1" });
  assert.equal(delivery.mode, "round");
  assert.equal(delivery.items[0].status, "not-run");
  assert.equal(delivery.pendingReview, 0);
  assert.equal(delivery.validationOutcome, "held");
});

test("review rejects empty reasons, held accepts, and unsealed rounds", () => {
  const root = makeRoot();
  writeRound(root, "20260901-120000-first", result("round-1", [plan("check")], [caseItem("check")]));
  assert.throws(() => writeReview(root, "demo", "20260901-120000-first", { id: "check", action: "accept" }), /not sealed/);
  seal(root, "20260901-120000-first");
  assert.throws(() => writeReview(root, "demo", "20260901-120000-first", { id: "check", action: "reject", reason: " " }), /non-empty reason/);

  writeRound(root, "20260902-120000-held", result("held", [plan("missing", { requiredEvidence: ["video"] })], [caseItem("missing")]));
  seal(root, "20260902-120000-held");
  assert.throws(() => writeReview(root, "demo", "20260902-120000-held", { id: "missing", action: "accept" }), /held checks/);
});

test("nested assets are served and HAR files are blocked", () => {
  const root = makeRoot();
  const value = result("round", [plan("nested")], [caseItem("nested", { evidence: ["assets/nested/note.txt"] })]);
  writeRound(root, "20260901-120000-first", value, { assets: { "nested/note.txt": "proof" } });
  assert.equal(assetFile(root, "demo", "20260901-120000-first", "nested/note.txt"), path.join(root, "demo", "20260901-120000-first", "assets", "nested", "note.txt"));
  assert.throws(() => assetFile(root, "demo", "20260901-120000-first", "secret.har"), /har/);
});

test("HTTP writes accept only loopback hosts and origins", () => {
  assert.equal(isLocalHost("127.0.0.1:8765"), true);
  assert.equal(isLocalHost("localhost:8765"), true);
  assert.equal(isLocalHost("attacker.example:8765"), false);
  assert.equal(isLocalOrigin("http://127.0.0.1:8765"), true);
  assert.equal(isLocalOrigin("https://attacker.example"), false);
});

test("catalog lives outside both the skill and source project", () => {
  assert.equal(CATALOG_PATH, path.join(process.env.HOME, ".local", "share", "acceptances", "catalog.json"));
});
