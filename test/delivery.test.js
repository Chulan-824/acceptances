import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assetFile } from "../server/acceptances.js";
import { CATALOG_PATH } from "../server/catalog.js";
import { buildDelivery } from "../server/delivery.js";
import { isLocalHost, isLocalOrigin } from "../server/http.js";
import { writeReview } from "../server/reviews.js";

function makeRoot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acceptances-"));
  const root = path.join(base, ".acceptances");
  fs.mkdirSync(root);
  return root;
}

function writeRound(root, id, result, reviews) {
  const dir = path.join(root, "demo", id);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result));
  fs.writeFileSync(path.join(dir, "report.md"), `# ${id}\n`);
  fs.writeFileSync(path.join(dir, "assets", "note.txt"), id);
  if (reviews) fs.writeFileSync(path.join(dir, "reviews.json"), JSON.stringify(reviews));
}

function result(title, plan, cases) {
  return {
    title,
    createdAt: `2026-09-0${title === "round-1" ? "1" : "2"}T12:00:00+08:00`,
    plan,
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((entry) => entry.status === "pass").length,
      failed: cases.filter((entry) => entry.status === "fail").length,
      blocked: 0,
      verdict: cases.some((entry) => entry.status === "fail") ? "fail" : "pass",
    },
  };
}

test("union keeps old checks and marks a newer plan without a case as not-run", () => {
  const root = makeRoot();
  writeRound(
    root,
    "20260901-120000-first",
    result(
      "round-1",
      [
        { id: "repeat", title: "repeat", category: "flow" },
        { id: "old", title: "old", category: "flow" },
      ],
      [
        { id: "repeat", status: "pass", evidence: ["assets/note.txt"] },
        { id: "old", status: "pass", evidence: ["assets/note.txt"] },
      ],
    ),
    { reviews: { old: { action: "accept", reviewedAt: "now" } } },
  );
  writeRound(
    root,
    "20260902-120000-second",
    result(
      "round-2",
      [
        { id: "repeat", title: "repeat", category: "flow" },
        { id: "new", title: "new", category: "flow" },
      ],
      [{ id: "new", status: "fail", evidence: ["assets/note.txt"] }],
    ),
  );

  const delivery = buildDelivery(root, "demo");
  const byId = new Map(delivery.items.map((item) => [item.id, item]));
  assert.equal(delivery.mode, "union");
  assert.equal(byId.get("repeat").status, "not-run");
  assert.equal(byId.get("repeat").case, null);
  assert.equal(byId.get("old").status, "pass");
  assert.equal(byId.get("old").sourceIndex, 1);
  assert.equal(byId.get("new").status, "fail");
  assert.equal(delivery.summary.notRun, 1);
  assert.equal(delivery.summary.verdict, "fail");
});

test("round selection stays an immutable snapshot", () => {
  const root = makeRoot();
  writeRound(
    root,
    "20260901-120000-first",
    result(
      "round-1",
      [{ id: "planned", title: "planned" }],
      [],
    ),
  );
  const delivery = buildDelivery(root, "demo", { r: "1" });
  assert.equal(delivery.mode, "round");
  assert.equal(delivery.items[0].status, "not-run");
  assert.equal(delivery.pendingReview, 0);
});

test("review rejects empty reasons and never serves HAR files", () => {
  const root = makeRoot();
  writeRound(
    root,
    "20260901-120000-first",
    result(
      "round-1",
      [{ id: "check", title: "check" }],
      [{ id: "check", status: "pass", evidence: ["assets/note.txt"] }],
    ),
  );
  assert.throws(
    () => writeReview(root, "demo", "20260901-120000-first", { id: "check", action: "reject", reason: " " }),
    /non-empty reason/,
  );
  const written = writeReview(root, "demo", "20260901-120000-first", {
    id: "check",
    action: "accept",
  });
  assert.equal(written.reviews.check.action, "accept");
  assert.throws(
    () => assetFile(root, "demo", "20260901-120000-first", "secret.har"),
    /har is not served/,
  );
});

test("HTTP writes accept only loopback hosts and origins", () => {
  assert.equal(isLocalHost("127.0.0.1:8765"), true);
  assert.equal(isLocalHost("localhost:8765"), true);
  assert.equal(isLocalHost("attacker.example:8765"), false);
  assert.equal(isLocalOrigin("http://127.0.0.1:8765"), true);
  assert.equal(isLocalOrigin("https://attacker.example"), false);
});

test("catalog lives outside both the skill and source project", () => {
  assert.equal(
    CATALOG_PATH,
    path.join(os.homedir(), ".local", "share", "acceptances", "catalog.json"),
  );
});
