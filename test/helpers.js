import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sealRounds } from "../server/receipts.js";
import { validateRoundDirectory } from "../server/validation.js";

export function makeRoot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acceptances-"));
  const root = path.join(base, ".acceptances");
  fs.mkdirSync(root);
  return root;
}

export function plan(id, overrides = {}) {
  return {
    id,
    title: id,
    category: "flow",
    verifier: "agent",
    method: "drive the product",
    expected: "visible product outcome",
    requiredEvidence: ["text"],
    ...overrides,
  };
}

export function caseItem(id, overrides = {}) {
  return {
    id,
    name: id,
    category: "flow",
    surface: "web",
    status: "pass",
    observation: "observed",
    evidence: ["assets/note.txt"],
    ...overrides,
  };
}

export function result(title, plans, cases, overrides = {}) {
  const failed = cases.filter((entry) => entry.status === "fail").length;
  const blocked = cases.filter((entry) => entry.status === "blocked").length;
  const caseIds = new Set(cases.map((entry) => entry.id));
  const notRun = plans.filter((entry) => !caseIds.has(entry.id)).length;
  return {
    title,
    createdAt: "2026-09-03T12:00:00+08:00",
    plan: plans,
    cases,
    surfaces: [...new Set(cases.map((entry) => entry.surface === "electron" ? "desktop" : entry.surface))],
    summary: {
      total: cases.length,
      passed: cases.filter((entry) => entry.status === "pass").length,
      failed,
      blocked,
      verdict: failed ? "fail" : blocked || notRun ? "partial" : "pass",
      conclusion: "fixture",
    },
    ...overrides,
  };
}

export function writeRound(root, round, value, { subject = "demo", assets = { "note.txt": "proof" }, reviews } = {}) {
  const dir = path.join(root, subject, round);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(value));
  fs.writeFileSync(path.join(dir, "report.md"), "fixture report\n");
  for (const [name, content] of Object.entries(assets)) {
    const file = path.join(dir, "assets", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  if (reviews) fs.writeFileSync(path.join(dir, "reviews.json"), JSON.stringify(reviews));
  return dir;
}

export function validateTarget(root, round, subject = "demo") {
  const dir = path.join(root, subject, round);
  return { root, subject, round, dir, validation: validateRoundDirectory(dir, { subject }) };
}

export function seal(root, round, subject = "demo") {
  const target = validateTarget(root, round, subject);
  sealRounds([target]);
  return target;
}
