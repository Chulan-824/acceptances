import { listRounds, loadRound, pickRound } from "./acceptances.js";

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
        index: record.index,
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
      (!state.caseRecord || state.planRecord.index > state.caseRecord.index);
    const source = notRun ? state.planRecord : state.caseRecord;
    const entry = notRun ? null : state.case || null;
    return {
      id,
      plan: state.plan || null,
      case: entry,
      review: entry ? source.reviews.reviews?.[id] || null : null,
      status: entry?.status || "not-run",
      sourceRound: source.id,
      sourceIndex: source.index,
      evidenceTexts: entry ? source.evidenceTexts : {},
      history: itemHistory(records, id),
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
  const records = [...rounds]
    .sort((a, b) => a.index - b.index)
    .map((summary) => recordFor(root, subject, summary));
  const selected = pickRound(rounds, selection);
  const current = selected
    ? records.find((record) => record.id === selected.id)
    : records.at(-1);
  const items = selected ? snapshotItems(current, records) : unionItems(records);
  const summary = selected
    ? {
        ...current.result.summary,
        notRun: items.filter((item) => item.status === "not-run").length,
      }
    : unionSummary(items);

  return {
    mode: selected ? "round" : "union",
    root,
    subject,
    selectedRound: selected?.id || null,
    selectedIndex: selected?.index || null,
    title: current.result.title || subject,
    createdAt: current.result.createdAt || current.id,
    branch: current.result.branch || "",
    commit: current.result.commit || "",
    entry: current.result.entry || "",
    summary,
    report: current.report,
    items,
    rounds,
    pendingReview: items.filter((item) => item.case && !item.review).length,
  };
}
