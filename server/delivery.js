/*
 * Source/modification notice (recorded 2026-10-08).
 * Changed for local use: rewrote stable-ID aggregation for filesystem Rounds and local reviews; derivation boundary pending.
 * Upstream portions: Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * Reference: lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Retain LobeHub Community License + Apache-2.0 for upstream expression/adaptations;
 * see ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * Local additions and the exact mixed-content boundary remain pending; no file-wide MIT grant.
 */
import { listRounds, loadRound, pickRound } from "./acceptances.js";
import { validateHistory } from "./validation-history.js";

function uniqueIds(result) {
  const ids = [];
  const seen = new Set();
  for (const entry of [...(result.plan || []), ...(result.cases || [])]) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      ids.push(entry.id);
    }
  }
  return ids;
}

function itemHistory(records, id) {
  return records
    .filter(
      (record) =>
        record.result.plan?.some((entry) => entry.id === id) ||
        record.result.cases?.some((entry) => entry.id === id),
    )
    .map((record) => {
      const entry = record.result.cases?.find((candidate) => candidate.id === id);
      return {
        round: record.id,
        index: record.sequence,
        createdAt: record.createdAt,
        status: entry?.status || "not-run",
        review: entry ? record.reviews.reviews?.[id] || null : null,
      };
    });
}

function recordFor(root, subject, summary) {
  return { ...summary, ...loadRound(root, subject, summary.id) };
}

function itemFromSnapshot(record, records, id) {
  const plan = record.result.plan?.find((entry) => entry.id === id) || null;
  const entry = record.result.cases?.find((candidate) => candidate.id === id) || null;
  return {
    id,
    plan,
    case: entry,
    review: entry ? record.reviews.reviews?.[id] || null : null,
    status: entry?.status || "not-run",
    sourceRound: record.id,
    sourceIndex: record.index,
    evidenceTexts: entry ? record.evidenceTexts : {},
    history: itemHistory(records, id),
    held: record.validation.heldIds.includes(id) || (record.validation.outcome === "held" && record.validation.heldIds.length === 0),
    staleReview: entry ? record.staleReviews?.[id] || null : null,
  };
}

function snapshotItems(record, records) {
  return uniqueIds(record.result).map((id) =>
    itemFromSnapshot(record, records, id),
  );
}

function unionItems(records) {
  const order = [];
  const stateById = new Map();
  for (const record of records) {
    for (const plan of record.result.plan || []) {
      if (!stateById.has(plan.id)) {
        order.push(plan.id);
        stateById.set(plan.id, {});
      }
      Object.assign(stateById.get(plan.id), { plan, planRecord: record });
    }
    for (const entry of record.result.cases || []) {
      if (!stateById.has(entry.id)) {
        order.push(entry.id);
        stateById.set(entry.id, {});
      }
      Object.assign(stateById.get(entry.id), { case: entry, caseRecord: record });
    }
  }

  return order.map((id) => {
    const state = stateById.get(id);
    const notRun =
      state.planRecord &&
      (!state.caseRecord || state.planRecord.sequence > state.caseRecord.sequence);
    const source = notRun ? state.planRecord : state.caseRecord;
    const entry = notRun ? null : state.case || null;
    return {
      id,
      plan: state.plan || null,
      case: entry,
      review: entry ? source.reviews.reviews?.[id] || null : null,
      status: entry?.status || "not-run",
      sourceRound: source.id,
      sourceIndex: source.sequence,
      sourceSequence: source.sequence,
      evidenceTexts: entry ? source.evidenceTexts : {},
      history: itemHistory(records, id),
      held: source.validation.heldIds.includes(id) || (source.validation.outcome === "held" && source.validation.heldIds.length === 0),
      staleReview: entry ? source.staleReviews?.[id] || null : null,
    };
  });
}

function unionSummary(items) {
  const count = (status) => items.filter((item) => item.status === status).length;
  const failed = count("fail");
  const blocked = count("blocked");
  const notRun = count("not-run");
  return {
    total: items.length,
    passed: count("pass"),
    failed,
    blocked,
    notRun,
    verdict: failed ? "fail" : blocked || notRun ? "partial" : "pass",
    conclusion: "跨轮合并视图。每个检查项展示最近一次计划或执行结果。",
  };
}

export function buildDelivery(root, subject, selection = {}) {
  const rounds = listRounds(root, subject);
  if (!rounds.length) {
    throw Object.assign(new Error("no rounds"), { status: 404 });
  }
  const records = [...rounds].map((summary) => recordFor(root, subject, summary));
  const published = records
    .filter((record) => record.published && record.validation.outcome !== "rejected")
    .sort((a, b) => a.sequence - b.sequence);
  const historyValidation = validateHistory(published);
  const selected = pickRound(rounds, selection);
  const current = selected
    ? records.find((record) => record.id === selected.id)
    : published.at(-1) || records.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  const items = selected
    ? current.validation.result && current.state !== "rejected"
      ? snapshotItems(current, published)
      : []
    : unionItems(published);
  const summary = selected
    ? {
        ...current.result.summary,
        notRun: items.filter((item) => item.status === "not-run").length,
      }
    : unionSummary(items);
  const diagnostics = selected
    ? current.validation.diagnostics
    : [...records.flatMap((record) => record.validation.diagnostics.map((entry) => ({ ...entry, round: record.id }))), ...historyValidation.diagnostics];
  const validationOutcome = selected
    ? current.state
    : historyValidation.outcome === "rejected"
      ? "rejected"
      : historyValidation.outcome === "held" || published.some((record) => record.validation.outcome === "held")
        ? "held"
        : published.length
          ? "ready"
          : "legacy";

  return {
    mode: selected ? "round" : "union",
    root,
    subject,
    selectedRound: selected?.id || null,
    selectedIndex: selected?.sequence || null,
    title: current.result.title || subject,
    createdAt: current.result.createdAt || current.id,
    branch: current.result.branch || "",
    commit: current.result.commit || "",
    entry: current.result.entry || "",
    summary,
    report: current.report,
    items,
    rounds,
    validationOutcome,
    ruleset: current.validation.ruleset,
    digest: current.receipt?.digest || "",
    diagnostics,
    pendingReview: items.filter((item) => item.case && !item.review).length,
  };
}
