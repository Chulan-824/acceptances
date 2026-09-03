import fs from "node:fs";
import path from "node:path";

export function assertSegment(name, label) {
  if (!name || typeof name !== "string") {
    throw Object.assign(new Error(`missing ${label}`), { status: 400 });
  }
  if (
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw Object.assign(new Error(`bad ${label}`), { status: 400 });
  }
}

export function underRoot(root, ...parts) {
  const base = path.resolve(root);
  const full = path.resolve(root, ...parts);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw Object.assign(new Error("path escape"), { status: 400 });
  }
  return full;
}

export function listSubjects(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function evidenceName(item) {
  const raw = typeof item === "string" ? item : item?.path;
  return path.basename(String(raw || "").replace(/^assets\//, ""));
}

function readEvidenceTexts(dir, result) {
  const texts = {};
  const names = new Set();
  for (const entry of result.cases || []) {
    for (const item of entry.evidence || []) {
      const name = evidenceName(item);
      if (name) names.add(name);
    }
  }
  for (const name of names) {
    if (!/\.(json|txt|md|csv)$/i.test(name)) continue;
    const file = path.join(dir, "assets", name);
    if (!fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    if (size > 0 && size <= 80_000) texts[name] = fs.readFileSync(file, "utf8");
  }
  return texts;
}

export function loadRound(root, subject, round) {
  assertSegment(subject, "subject");
  assertSegment(round, "round");
  const dir = underRoot(root, subject, round);
  const resultPath = path.join(dir, "result.json");
  if (!fs.existsSync(resultPath)) {
    throw Object.assign(new Error("round not found"), { status: 404 });
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const reviews = readJsonIfExists(path.join(dir, "reviews.json"), {
    reviews: {},
  });
  const reportPath = path.join(dir, "report.md");
  const report = fs.existsSync(reportPath)
    ? fs.readFileSync(reportPath, "utf8")
    : "";
  return {
    dir,
    result,
    reviews,
    report,
    evidenceTexts: readEvidenceTexts(dir, result),
  };
}

function summarizeRound(root, subject, id) {
  const { result, reviews } = loadRound(root, subject, id);
  const cases = result.cases || [];
  const plans = result.plan || [];
  const reviewMap = reviews.reviews || {};
  const pendingReview = cases.filter((entry) => !reviewMap[entry.id]).length;
  return {
    id,
    title: result.title || id,
    createdAt: result.createdAt || "",
    verdict: result.summary?.verdict || "",
    conclusion: result.summary?.conclusion || "",
    total: result.summary?.total ?? cases.length,
    passed:
      result.summary?.passed ?? cases.filter((entry) => entry.status === "pass").length,
    failed:
      result.summary?.failed ?? cases.filter((entry) => entry.status === "fail").length,
    blocked:
      result.summary?.blocked ??
      cases.filter((entry) => entry.status === "blocked").length,
    notRun: plans.filter(
      (plan) => !cases.some((entry) => entry.id === plan.id),
    ).length,
    pendingReview,
  };
}

export function listRounds(root, subject) {
  assertSegment(subject, "subject");
  const dir = underRoot(root, subject);
  if (!fs.existsSync(dir)) return [];
  const chronological = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(dir, entry.name, "result.json")),
    )
    .map((entry) => entry.name)
    .sort()
    .map((id, index) => ({ ...summarizeRound(root, subject, id), index: index + 1 }));
  return chronological.reverse();
}

export function pickRound(rounds, { round, r } = {}) {
  if (round) {
    const hit = rounds.find((entry) => entry.id === round);
    if (hit) return hit;
    throw Object.assign(new Error("round not found"), { status: 404 });
  }
  if (r !== undefined && r !== "") {
    const index = Number(r);
    const hit = rounds.find((entry) => entry.index === index);
    if (Number.isInteger(index) && index >= 1 && hit) return hit;
    throw Object.assign(new Error("round index not found"), { status: 404 });
  }
  return null;
}

export function assetFile(root, subject, round, name) {
  assertSegment(subject, "subject");
  assertSegment(round, "round");
  const base = path.basename(name || "");
  if (!base || base !== String(name || "").replace(/^assets\//, "")) {
    throw Object.assign(new Error("bad asset name"), { status: 400 });
  }
  if (base.toLowerCase().endsWith(".har")) {
    throw Object.assign(new Error("har is not served"), { status: 404 });
  }
  const file = underRoot(root, subject, round, "assets", base);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw Object.assign(new Error("asset not found"), { status: 404 });
  }
  return file;
}
