/*
 * Source/modification notice (recorded 2026-10-08).
 * Changed for local use: rewrote public rules as local diagnostics, filesystem validation and sealing.
 * Upstream portions: Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * Reference: lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Retain LobeHub Community License + Apache-2.0 for upstream expression/adaptations;
 * see ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * Local additions and the exact mixed-content boundary remain pending; no file-wide MIT grant.
 */
import fs from "node:fs";
import path from "node:path";

import {
  classifyEvidence,
  evidencePath,
  forbiddenName,
  hasUnredactedSecret,
  listAssets,
  resolveAsset,
} from "./validation-assets.js";
import {
  CASE_STATUSES,
  diagnostic,
  EVIDENCE_TYPES,
  gateMatch,
  normalizedSurface,
  outcomeFromDiagnostics,
  RULESET_VERSION,
  SURFACES,
  VERDICTS,
  VERIFIERS,
} from "./validation-rules-v0.1.0.js";
import { validateVisualizations } from "./validation-visualizations.js";

const RESULT_FIELDS = new Set(["title", "createdAt", "entry", "plan", "cases", "summary", "surfaces", "branch", "commit", "pullRequest", "subject", "interactionCost"]);
const PLAN_FIELDS = new Set(["id", "title", "category", "verifier", "method", "expected", "requiredEvidence", "supersedes"]);
const CASE_FIELDS = new Set(["id", "name", "category", "surface", "status", "observation", "evidence", "datasets", "visualizations"]);
const SUMMARY_FIELDS = new Set(["total", "passed", "failed", "blocked", "verdict", "conclusion", "score"]);
const COMPARISON_FIELDS = new Set(["id", "role", "layout", "label"]);
const EVIDENCE_FIELDS = new Set(["path", "comparison"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value) {
  return typeof value === "string" && value.trim() !== "";
}

function integer(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function safeReadJson(file, add, pointer) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    add("JSON_INVALID", "reject", pointer, "文件不是合法 JSON");
    return null;
  }
}

function warnUnknown(value, allowed, pointer, add) {
  if (!object(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add("COMPAT_UNKNOWN_FIELD", "advisory", `${pointer}/${key}`, "公开契约未定义该字段", undefined, "compat-assumption");
  }
}

function stringList(value, pointer, allowed, add) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    add("STRING_LIST_INVALID", "reject", pointer, "字段必须是字符串数组");
    return [];
  }
  const result = [];
  const seen = new Set();
  value.forEach((item, index) => {
    if (!string(item) || (allowed && !allowed.has(item))) {
      add("CLOSED_VALUE_INVALID", "reject", `${pointer}/${index}`, "值不在公开词表中");
      return;
    }
    if (seen.has(item)) {
      add("DUPLICATE_LIST_VALUE", "normalize", `${pointer}/${index}`, "重复值已在派生模型中去重");
      return;
    }
    seen.add(item);
    result.push(item);
  });
  return result;
}

function requiredString(value, pointer, add) {
  if (!string(value)) add("REQUIRED_STRING_MISSING", "reject", pointer, "需要非空字符串");
  return string(value) ? value : "";
}

function normalizePlan(value, index, add) {
  const base = `/plan/${index}`;
  if (!object(value)) {
    add("PLAN_ITEM_INVALID", "reject", base, "plan item 必须是对象");
    return { id: "", title: "", category: "", verifier: "agent", method: "", expected: "", requiredEvidence: [], supersedes: [] };
  }
  warnUnknown(value, PLAN_FIELDS, base, add);
  const verifier = value.verifier === undefined ? "agent" : value.verifier;
  if (value.verifier === undefined) add("VERIFIER_DEFAULTED", "normalize", `${base}/verifier`, "verifier 缺省为 agent");
  if (!VERIFIERS.has(verifier)) add("VERIFIER_INVALID", "reject", `${base}/verifier`, "verifier 不在公开词表中");
  return {
    id: requiredString(value.id, `${base}/id`, add),
    title: requiredString(value.title, `${base}/title`, add),
    category: requiredString(value.category, `${base}/category`, add),
    verifier,
    method: requiredString(value.method, `${base}/method`, add),
    expected: requiredString(value.expected, `${base}/expected`, add),
    requiredEvidence: stringList(value.requiredEvidence, `${base}/requiredEvidence`, EVIDENCE_TYPES, add),
    supersedes: stringList(value.supersedes, `${base}/supersedes`, null, add),
  };
}

function normalizeComparison(value, pointer, add) {
  if (!object(value)) {
    add("COMPARISON_INVALID", "reject", pointer, "comparison 必须是对象");
    return null;
  }
  warnUnknown(value, COMPARISON_FIELDS, pointer, add);
  const id = requiredString(value.id, `${pointer}/id`, add);
  if (!new Set(["before", "after"]).has(value.role)) add("COMPARISON_ROLE_INVALID", "reject", `${pointer}/role`, "role 必须是 before 或 after");
  const layout = value.layout ?? "horizontal";
  if (value.layout === undefined) add("COMPARISON_LAYOUT_DEFAULTED", "normalize", `${pointer}/layout`, "layout 缺省为 horizontal");
  if (!new Set(["horizontal", "vertical"]).has(layout)) add("COMPARISON_LAYOUT_INVALID", "reject", `${pointer}/layout`, "layout 不在公开词表中");
  if (value.label !== undefined && !string(value.label)) add("COMPARISON_LABEL_INVALID", "reject", `${pointer}/label`, "label 必须是非空字符串");
  return { id, role: value.role, layout, ...(value.label === undefined ? {} : { label: value.label }) };
}

function normalizeEvidence(value, pointer, add) {
  if (string(value)) return value;
  if (!object(value)) {
    add("EVIDENCE_ITEM_INVALID", "reject", pointer, "evidence 必须是路径或对象");
    return "";
  }
  warnUnknown(value, EVIDENCE_FIELDS, pointer, add);
  const item = { path: requiredString(value.path, `${pointer}/path`, add) };
  if (value.comparison !== undefined) item.comparison = normalizeComparison(value.comparison, `${pointer}/comparison`, add);
  return item;
}

function normalizeCase(value, index, add) {
  const base = `/cases/${index}`;
  if (!object(value)) {
    add("CASE_ITEM_INVALID", "reject", base, "case 必须是对象");
    return { id: "", name: "", category: "", surface: "", status: "", observation: "", evidence: [] };
  }
  warnUnknown(value, CASE_FIELDS, base, add);
  const surface = normalizedSurface(value.surface);
  if (value.surface === "electron") add("SURFACE_NORMALIZED", "normalize", `${base}/surface`, "electron 已归一为 desktop");
  if (!SURFACES.has(surface)) add("SURFACE_INVALID", "reject", `${base}/surface`, "surface 不在公开词表中");
  if (!CASE_STATUSES.has(value.status)) add("CASE_STATUS_INVALID", "reject", `${base}/status`, "status 不在公开词表中");
  const evidence = value.evidence === undefined
    ? []
    : Array.isArray(value.evidence)
      ? value.evidence.map((item, evidenceIndex) => normalizeEvidence(item, `${base}/evidence/${evidenceIndex}`, add))
      : (add("EVIDENCE_LIST_INVALID", "reject", `${base}/evidence`, "evidence 必须是数组"), []);
  return {
    id: requiredString(value.id, `${base}/id`, add),
    name: requiredString(value.name, `${base}/name`, add),
    category: requiredString(value.category, `${base}/category`, add),
    surface,
    status: value.status,
    observation: requiredString(value.observation, `${base}/observation`, add),
    evidence,
    ...(value.datasets === undefined ? {} : { datasets: value.datasets }),
    ...(value.visualizations === undefined ? {} : { visualizations: value.visualizations }),
  };
}

function validateComparisons(entry, index, add) {
  const groups = new Map();
  entry.evidence.forEach((item, evidenceIndex) => {
    const comparison = object(item) ? item.comparison : null;
    if (!comparison?.id) return;
    const roles = groups.get(comparison.id) || [];
    roles.push({ role: comparison.role, index: evidenceIndex });
    groups.set(comparison.id, roles);
  });
  for (const [id, roles] of groups) {
    const before = roles.filter((entry) => entry.role === "before").length;
    const after = roles.filter((entry) => entry.role === "after").length;
    if (before !== 1 || after !== 1) add("COMPARISON_PAIR_INCOMPLETE", "reject", `/cases/${index}/evidence`, "comparison 必须恰好包含一个 before 和一个 after", { id });
  }
}

function validateSummary(summary, plan, cases, add) {
  if (!object(summary)) {
    add("SUMMARY_INVALID", "reject", "/summary", "summary 必须是对象");
    return { total: 0, passed: 0, failed: 0, blocked: 0, verdict: "", conclusion: "" };
  }
  warnUnknown(summary, SUMMARY_FIELDS, "/summary", add);
  const counts = {
    total: cases.length,
    passed: cases.filter((entry) => entry.status === "pass").length,
    failed: cases.filter((entry) => entry.status === "fail").length,
    blocked: cases.filter((entry) => entry.status === "blocked").length,
  };
  for (const [key, expected] of Object.entries(counts)) {
    if (!integer(summary[key]) || summary[key] !== expected) add("SUMMARY_COUNT_MISMATCH", "reject", `/summary/${key}`, "summary 数量与 cases 不一致", { expected, actual: summary[key] });
  }
  const caseIds = new Set(cases.map((entry) => entry.id));
  const notRun = plan.filter((entry) => !caseIds.has(entry.id)).length;
  const expectedVerdict = counts.failed ? "fail" : counts.blocked || notRun ? "partial" : "pass";
  if (summary.verdict === undefined || summary.verdict === "") {
    add("SUMMARY_VERDICT_MISSING", "hold", "/summary/verdict", "缺少 verdict，交付保持 held");
  } else if (!VERDICTS.has(summary.verdict)) {
    add("SUMMARY_VERDICT_INVALID", "reject", "/summary/verdict", "verdict 不在公开词表中");
  } else if (summary.verdict !== expectedVerdict) {
    add("SUMMARY_VERDICT_MISMATCH", "reject", "/summary/verdict", "verdict 与 cases 或未执行计划不一致", { expected: expectedVerdict, actual: summary.verdict });
  }
  if (summary.conclusion !== undefined && !string(summary.conclusion)) add("SUMMARY_CONCLUSION_INVALID", "reject", "/summary/conclusion", "conclusion 必须是非空字符串");
  if (summary.score !== undefined && (typeof summary.score !== "number" || !Number.isFinite(summary.score) || summary.score < 0 || summary.score > 100)) add("SUMMARY_SCORE_INVALID", "reject", "/summary/score", "score 必须位于 0 到 100");
  return { ...counts, verdict: summary.verdict ?? "", conclusion: summary.conclusion ?? "", ...(summary.score === undefined ? {} : { score: summary.score }) };
}

function validateInteractionTrace(roundDir) {
  const file = path.join(roundDir, "interaction-trace.jsonl");
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const atom = JSON.parse(line);
      if (atom.schema !== "lobehub.agentBrowserKlmTrace@1") continue;
      if (atom.klm?.category === "blocked") continue;
    } catch {
      // Public behavior ignores records it cannot price.
    }
  }
}

export function validateRoundDirectory(roundDir, { subject } = {}) {
  const diagnostics = [];
  const heldIds = new Set();
  const add = (code, effect, pointer, message, details, source = "lobehub-public") => {
    diagnostics.push(diagnostic(code, source, effect, pointer, message, details));
    if (effect === "hold" && details?.id) heldIds.add(details.id);
  };
  const absolute = path.resolve(roundDir);
  if (!/^\d{8}-\d{6}-.+/.test(path.basename(absolute))) add("ROUND_NAME_INVALID", "reject", ".", "Round 目录名必须使用时间戳和 slug");
  let stat;
  try { stat = fs.lstatSync(absolute); } catch { stat = null; }
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    add("ROUND_DIRECTORY_INVALID", "reject", ".", "Round 必须是普通目录", undefined, "local-safety");
    return { ruleset: RULESET_VERSION, outcome: "rejected", diagnostics, result: null, report: "", heldIds: [], droppedIds: [] };
  }

  const resultFile = path.join(absolute, "result.json");
  const reportFile = path.join(absolute, "report.md");
  const assetsDir = path.join(absolute, "assets");
  const usable = new Map();
  for (const [file, pointer, kind] of [[resultFile, "result.json", "file"], [reportFile, "report.md", "file"], [assetsDir, "assets", "directory"]]) {
    try {
      const fileStat = fs.lstatSync(file);
      const valid = !fileStat.isSymbolicLink() && (kind === "file" ? fileStat.isFile() : fileStat.isDirectory());
      usable.set(pointer, valid);
      if (!valid) add("ROUND_FILE_INVALID", "reject", pointer, `${pointer} 类型错误`, undefined, "local-safety");
    } catch {
      usable.set(pointer, false);
      add("ROUND_FILE_MISSING", "reject", pointer, `缺少 ${pointer}`);
    }
  }
  if (!usable.get("result.json")) return { ruleset: RULESET_VERSION, outcome: "rejected", diagnostics, result: null, report: "", heldIds: [], droppedIds: [] };
  const raw = safeReadJson(resultFile, add, "/");
  if (!object(raw)) {
    if (raw !== null) add("RESULT_INVALID", "reject", "/", "result.json 顶层必须是对象");
    return { ruleset: RULESET_VERSION, outcome: "rejected", diagnostics, result: null, report: "", heldIds: [], droppedIds: [] };
  }
  warnUnknown(raw, RESULT_FIELDS, "", add);
  const title = raw.title === undefined || raw.title === "" ? "" : requiredString(raw.title, "/title", add);
  if (!title) add("ROUND_TITLE_MISSING", "hold", "/title", "缺少 title，交付保持 held");
  const createdAt = requiredString(raw.createdAt, "/createdAt", add);
  if (createdAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) || Number.isNaN(Date.parse(createdAt)))) add("CREATED_AT_INVALID", "reject", "/createdAt", "createdAt 必须是带时区的 ISO 8601");
  for (const key of ["entry", "branch", "commit", "pullRequest"]) if (raw[key] !== undefined && !string(raw[key])) add("PROVENANCE_INVALID", "reject", `/${key}`, `${key} 必须是非空字符串`);
  if (raw.subject !== undefined && (!string(raw.subject) || (subject && raw.subject !== subject))) add("SUBJECT_MISMATCH", "reject", "/subject", "subject 与目录不一致", undefined, "local-safety");
  if (raw.interactionCost !== undefined && !object(raw.interactionCost)) add("INTERACTION_COST_INVALID", "reject", "/interactionCost", "interactionCost 必须是对象");

  const planValues = Array.isArray(raw.plan) ? raw.plan : (add("PLAN_INVALID", "reject", "/plan", "plan 必须是数组"), []);
  const caseValues = Array.isArray(raw.cases) ? raw.cases : (add("CASES_INVALID", "reject", "/cases", "cases 必须是数组"), []);
  const plan = planValues.map((item, index) => normalizePlan(item, index, add));
  const cases = caseValues.map((item, index) => normalizeCase(item, index, add));
  const planById = new Map();
  plan.forEach((item, index) => {
    if (planById.has(item.id)) add("PLAN_ID_DUPLICATE", "reject", `/plan/${index}/id`, "plan id 必须唯一", { id: item.id });
    planById.set(item.id, item);
    if (item.supersedes.includes(item.id)) add("SUPERSEDES_SELF", "reject", `/plan/${index}/supersedes`, "检查项不能替代自身", { id: item.id });
  });
  const caseIds = new Set();
  cases.forEach((item, index) => {
    if (caseIds.has(item.id)) add("CASE_ID_DUPLICATE", "reject", `/cases/${index}/id`, "case id 必须唯一", { id: item.id });
    caseIds.add(item.id);
    const planned = planById.get(item.id);
    if (!planned) add("CASE_WITHOUT_PLAN", "reject", `/cases/${index}/id`, "case 必须对应同轮 plan", { id: item.id });
    else if (planned.category !== item.category) add("CASE_CATEGORY_MISMATCH", "reject", `/cases/${index}/category`, "case category 必须与 plan 一致", { id: item.id });
    validateComparisons(item, index, add);
  });

  const rawSummary = validateSummary(raw.summary, plan, cases, add);
  const rawSurfaces = stringList(raw.surfaces, "/surfaces", null, add).map((value, index) => {
    const normalized = normalizedSurface(value);
    if (value === "electron") add("SURFACE_NORMALIZED", "normalize", `/surfaces/${index}`, "electron 已归一为 desktop");
    if (!SURFACES.has(normalized)) add("SURFACE_INVALID", "reject", `/surfaces/${index}`, "surface 不在公开词表中");
    return normalized;
  });
  const actualSurfaces = new Set(cases.map((entry) => entry.surface).filter((value) => SURFACES.has(value)));
  if (!sameSet(new Set(rawSurfaces), actualSurfaces)) add("SURFACES_MISMATCH", "reject", "/surfaces", "surfaces 必须与 cases 使用的 surface 一致");

  const droppedIds = [];
  for (const item of plan) {
    const match = gateMatch(item);
    if (!match) continue;
    droppedIds.push(item.id);
    add("PROGRAMMATIC_GATE_DROPPED", "drop", `/plan/${plan.indexOf(item)}/${match.field}`, "测试或仓库门禁已从派生验收中剔除", { id: item.id, field: match.field, rule: match.rule });
  }
  const dropped = new Set(droppedIds);
  const derivedPlan = plan.filter((item) => !dropped.has(item.id));
  const derivedCases = cases.filter((item) => !dropped.has(item.id));
  if (!derivedPlan.length) add("NO_ACCEPTANCE_CHECKS", "reject", "/plan", "剔除门禁后没有可供人审的检查项");

  const references = new Set();
  const assetEntries = usable.get("assets") ? listAssets(absolute) : [];
  for (const entry of assetEntries) {
    const forbidden = forbiddenName(entry.relative);
    if (entry.kind === "symlink" || entry.kind === "other") add("ASSET_TYPE_INVALID", "reject", entry.relative, "资产必须是普通文件且不能是 symlink", undefined, "local-safety");
    if (forbidden) add("SENSITIVE_ASSET_FORBIDDEN", "reject", entry.relative, `${forbidden} 不允许保存在 Round 中`, undefined, "local-safety");
  }
  for (const name of fs.readdirSync(absolute)) {
    if (forbiddenName(name)) add("SENSITIVE_ASSET_FORBIDDEN", "reject", name, "敏感文件不允许保存在 Round 中", undefined, "local-safety");
  }

  let totalRows = 0;
  cases.forEach((entry) => {
    for (const item of entry.evidence) {
      const reference = evidencePath(item);
      const resolved = resolveAsset(absolute, reference);
      if (resolved.error) add("EVIDENCE_PATH_INVALID", "reject", `/cases/${cases.indexOf(entry)}/evidence`, resolved.error, { id: entry.id }, "local-safety");
      else references.add(resolved.relative);
    }
  });
  derivedCases.forEach((entry) => {
    const index = cases.indexOf(entry);
    const valid = [];
    for (const item of entry.evidence) {
      const reference = evidencePath(item);
      const resolved = resolveAsset(absolute, reference);
      if (resolved.error || resolved.size === 0) continue;
      const type = classifyEvidence(reference);
      valid.push({ reference: resolved.relative, type, file: resolved.file });
      if (!type) add("EVIDENCE_TYPE_UNKNOWN", "advisory", `/cases/${index}/evidence`, "无法从公开规则确认 evidence 类型", { id: entry.id, path: resolved.relative }, "compat-assumption");
      if (type && new Set(["text", "markdown", "dom_snapshot", "transcript"]).has(type) && hasUnredactedSecret(resolved.file)) add("EVIDENCE_SECRET_DETECTED", "reject", resolved.relative, "文本证据包含疑似未脱敏凭据", { id: entry.id }, "local-safety");
    }
    if ((entry.status === "pass" || entry.status === "fail") && valid.length === 0) add("CASE_EVIDENCE_MISSING", "hold", `/cases/${index}/evidence`, "pass/fail case 至少需要一份非空证据", { id: entry.id });
    const available = new Set(valid.map((item) => item.type).filter(Boolean));
    const planned = planById.get(entry.id);
    for (const required of planned?.requiredEvidence || []) if (!available.has(required)) add("REQUIRED_EVIDENCE_MISSING", "hold", `/plan/${plan.indexOf(planned)}/requiredEvidence`, `缺少 ${required} evidence`, { id: entry.id, type: required });
    totalRows += validateVisualizations(entry, `/cases/${index}`, add);
  });
  if (totalRows > 10_000) add("DATASET_ROW_LIMIT_EXCEEDED", "reject", "/cases", "整个 Round 的 inline dataset rows 不能超过 10000", { rows: totalRows });
  for (const asset of assetEntries) if (asset.kind === "file" && !references.has(asset.relative)) add("ASSET_UNREFERENCED", "advisory", asset.relative, "资产没有被任何 case 引用");

  const derivedCaseIds = new Set(derivedCases.map((entry) => entry.id));
  derivedPlan.forEach((item) => {
    if (!derivedCaseIds.has(item.id)) add("PLAN_NOT_RUN", "hold", `/plan/${plan.indexOf(item)}`, "计划项没有对应 case", { id: item.id });
  });
  const failed = derivedCases.filter((entry) => entry.status === "fail").length;
  const blocked = derivedCases.filter((entry) => entry.status === "blocked").length;
  const notRun = derivedPlan.filter((entry) => !derivedCaseIds.has(entry.id)).length;
  const derivedSummary = {
    ...rawSummary,
    total: derivedCases.length,
    passed: derivedCases.filter((entry) => entry.status === "pass").length,
    failed,
    blocked,
    verdict: raw.summary?.verdict === undefined || raw.summary?.verdict === "" ? "" : failed ? "fail" : blocked || notRun ? "partial" : "pass",
  };
  const derivedSurfaces = [...new Set(derivedCases.map((entry) => entry.surface))];
  validateInteractionTrace(absolute);
  const report = usable.get("report.md") ? fs.readFileSync(reportFile, "utf8") : "";
  const result = {
    title,
    createdAt,
    surfaces: derivedSurfaces,
    plan: derivedPlan,
    cases: derivedCases,
    summary: derivedSummary,
    ...Object.fromEntries(["entry", "branch", "commit", "pullRequest", "subject", "interactionCost"].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]])),
  };
  return {
    ruleset: RULESET_VERSION,
    outcome: outcomeFromDiagnostics(diagnostics),
    diagnostics,
    result,
    rawResult: raw,
    report,
    heldIds: [...heldIds],
    droppedIds,
  };
}
