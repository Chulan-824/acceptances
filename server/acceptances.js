import fs from "node:fs";
import path from "node:path";

import { forbiddenName, resolveAsset } from "./validation-assets.js";
import {
  diagnostic,
  outcomeFromDiagnostics,
  RULESET_VERSION,
} from "./validation-rules-v0.1.0.js";
import { validateRoundDirectory } from "./validation.js";
import { computeRoundDigest, loadReceipt } from "./receipts.js";

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

function readEvidenceTexts(dir, result) {
  const texts = {};
  const references = new Set();
  for (const entry of result.cases || []) {
    for (const item of entry.evidence || []) {
      const reference = typeof item === "string" ? item : item?.path;
      if (reference) references.add(reference);
    }
  }
  for (const reference of references) {
    if (!/\.(json|txt|md|csv|log|html?|srt|vtt)$/i.test(reference)) continue;
    const resolved = resolveAsset(dir, reference);
    if (resolved.error || resolved.size <= 0 || resolved.size > 80_000) continue;
    texts[reference.replace(/^assets\//, "")] = fs.readFileSync(resolved.file, "utf8");
  }
  return texts;
}

function readReviews(file, result, receipt, diagnostics) {
  if (!fs.existsSync(file)) return { reviews: { reviews: {} }, staleReviews: {}, trusted: true };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    diagnostics.push(diagnostic("REVIEW_OVERLAY_INVALID", "local-safety", "hold", "reviews.json", "reviews.json 必须是普通文件"));
    return { reviews: { reviews: {} }, staleReviews: {}, trusted: false };
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    diagnostics.push(diagnostic("REVIEW_OVERLAY_INVALID", "local-safety", "hold", "reviews.json", "reviews.json 不是合法 JSON"));
    return { reviews: { reviews: {} }, staleReviews: {}, trusted: false };
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.reviews || typeof value.reviews !== "object" || Array.isArray(value.reviews)) {
    diagnostics.push(diagnostic("REVIEW_OVERLAY_INVALID", "local-safety", "hold", "reviews.json", "reviews.json 结构错误"));
    return { reviews: { reviews: {} }, staleReviews: {}, trusted: false };
  }
  const caseIds = new Set((result?.cases || []).map((entry) => entry.id));
  let valid = true;
  for (const [id, review] of Object.entries(value.reviews)) {
    const rejected = review?.action === "reject";
    if (
      !caseIds.has(id) ||
      !review ||
      typeof review !== "object" ||
      !new Set(["accept", "reject"]).has(review.action) ||
      typeof review.reviewedAt !== "string" ||
      Number.isNaN(Date.parse(review.reviewedAt)) ||
      (rejected && (typeof review.reason !== "string" || !review.reason.trim()))
    ) valid = false;
  }
  if (!valid) {
    diagnostics.push(diagnostic("REVIEW_OVERLAY_INVALID", "local-safety", "hold", "reviews.json", "reviews.json 含有非法人审记录"));
    return { reviews: { reviews: {} }, staleReviews: {}, trusted: false };
  }
  const active = {};
  const stale = {};
  for (const [id, review] of Object.entries(value.reviews)) {
    if (!receipt || review.roundDigest !== receipt.digest) stale[id] = review;
    else active[id] = review;
  }
  if (Object.keys(stale).length) diagnostics.push(diagnostic("PRESEAL_REVIEW_STALE", "local-safety", "advisory", "reviews.json", "封存前的人审仅保留为历史，不计入当前验收", { ids: Object.keys(stale) }));
  return { reviews: { ...value, reviews: active }, staleReviews: stale, trusted: true };
}

export function loadRound(root, subject, round) {
  assertSegment(subject, "subject");
  assertSegment(round, "round");
  const dir = underRoot(root, subject, round);
  const resultPath = path.join(dir, "result.json");
  if (!fs.existsSync(resultPath)) {
    throw Object.assign(new Error("round not found"), { status: 404 });
  }
  const validation = validateRoundDirectory(dir, { subject });
  const loadedReceipt = loadReceipt(root, subject, round);
  let receipt = loadedReceipt.receipt;
  let published = loadedReceipt.state === "sealed";
  if (loadedReceipt.state === "legacy") {
    validation.diagnostics.push(diagnostic("LEGACY_UNSEALED", "local-safety", "advisory", ".", "Round 尚未封存，不进入正式历史或人审"));
  } else if (loadedReceipt.state === "invalid") {
    validation.diagnostics.push(diagnostic("RECEIPT_INVALID", "local-safety", "reject", path.relative(root, loadedReceipt.file), "receipt 无法读取或结构错误"));
    published = false;
  } else if (receipt && receipt.ruleset !== RULESET_VERSION) {
    validation.diagnostics.push(diagnostic("RULESET_UNAVAILABLE", "local-safety", "reject", path.relative(root, loadedReceipt.file), "receipt 引用的 ruleset 当前不可用", { ruleset: receipt.ruleset }));
    published = false;
  } else if (receipt) {
    try {
      const digest = computeRoundDigest(dir);
      if (digest !== receipt.digest) {
        validation.diagnostics.push(diagnostic("ROUND_TAMPERED", "local-safety", "reject", ".", "Published Round 内容已改变"));
        published = false;
      }
    } catch {
      validation.diagnostics.push(diagnostic("ROUND_DIGEST_UNAVAILABLE", "local-safety", "reject", ".", "无法安全计算 Raw Round 摘要"));
      published = false;
    }
  }
  const reviewState = readReviews(path.join(dir, "reviews.json"), validation.result, receipt, validation.diagnostics);
  validation.outcome = outcomeFromDiagnostics(validation.diagnostics);
  const state = validation.outcome === "rejected"
    ? "rejected"
    : !published
      ? "legacy"
      : validation.outcome;
  const result = validation.result || { title: "", createdAt: "", plan: [], cases: [], surfaces: [], summary: { total: 0, passed: 0, failed: 0, blocked: 0, verdict: "", conclusion: "" } };
  return {
    dir,
    result,
    reviews: reviewState.reviews,
    staleReviews: reviewState.staleReviews,
    reviewTrusted: reviewState.trusted,
    report: validation.report,
    validation,
    receipt,
    published,
    state,
    sequence: published ? receipt.sequence : null,
    // ponytail: validate on every read; add a digest-keyed cache only if large histories become measurably slow.
    evidenceTexts: state === "rejected" ? {} : readEvidenceTexts(dir, result),
  };
}

function summarizeRound(root, subject, id) {
  const record = loadRound(root, subject, id);
  const { result, reviews } = record;
  const cases = result.cases || [];
  const plans = result.plan || [];
  const reviewMap = reviews.reviews || {};
  const pendingReview = record.published && record.state !== "rejected"
    ? cases.filter((entry) => !reviewMap[entry.id]).length
    : 0;
  return {
    id,
    state: record.state,
    outcome: record.validation.outcome,
    sequence: record.sequence,
    ruleset: record.validation.ruleset,
    diagnostics: record.validation.diagnostics,
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
    .map((id) => summarizeRound(root, subject, id));
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
    const hit = rounds.find((entry) => entry.sequence === index);
    if (Number.isInteger(index) && index >= 1 && hit) return hit;
    throw Object.assign(new Error("round index not found"), { status: 404 });
  }
  return null;
}

export function assetFile(root, subject, round, name) {
  assertSegment(subject, "subject");
  assertSegment(round, "round");
  const reference = String(name || "").startsWith("assets/") ? String(name) : `assets/${String(name || "")}`;
  if (forbiddenName(reference)) {
    throw Object.assign(new Error("har is not served"), { status: 404 });
  }
  if (loadRound(root, subject, round).state === "rejected") {
    throw Object.assign(new Error("asset belongs to a rejected round"), { status: 404 });
  }
  const resolved = resolveAsset(underRoot(root, subject, round), reference);
  if (resolved.error) throw Object.assign(new Error(resolved.error), { status: 404 });
  return resolved.file;
}
