import { diagnostic, outcomeFromDiagnostics, RULESET_VERSION } from "./validation-rules-v0.1.0.js";

function reviewFor(record, id) {
  return record.reviewTrusted ? record.reviews.reviews?.[id] || null : null;
}

function comparable(plan) {
  return JSON.stringify([plan.title, plan.category, plan.method, plan.expected]);
}

export function validateHistory(records) {
  const diagnostics = [];
  const add = (code, effect, path, message, details, source = "lobehub-public") => diagnostics.push(diagnostic(code, source, effect, path, message, details));
  const ordered = [...records]
    .filter((record) => record.published && record.validation.outcome !== "rejected")
    .sort((left, right) => left.sequence - right.sequence);
  const seen = new Map();
  const supersededBy = new Map();
  const latestCase = new Map();

  for (const record of ordered) {
    for (const plan of record.result.plan || []) {
      const pointer = `${record.id}#/plan/${record.result.plan.indexOf(plan)}`;
      if (supersededBy.has(plan.id)) add("SUPERSEDED_ID_REACTIVATED", "reject", pointer, "已被替代的检查 ID 不能再次成为活跃项", { id: plan.id, round: record.id });
      const previous = seen.get(plan.id);
      if (previous && comparable(previous.plan) !== comparable(plan)) add("CHECK_DESCRIPTION_CHANGED", "advisory", pointer, "同一稳定 ID 的描述发生变化，请确认是否应使用 supersedes", { id: plan.id, round: record.id });
      const ancestors = new Set();
      for (const oldId of plan.supersedes || []) {
        if (!seen.has(oldId)) {
          add("SUPERSEDES_UNKNOWN_ID", "reject", `${pointer}/supersedes`, "supersedes 只能引用更早检查 ID", { id: plan.id, oldId });
          continue;
        }
        ancestors.add(oldId);
        for (const ancestor of seen.get(oldId).ancestors) ancestors.add(ancestor);
        const existing = supersededBy.get(oldId);
        if (existing && existing !== plan.id) add("SUPERSEDES_FORK", "reject", `${pointer}/supersedes`, "一个旧检查不能分叉到多个 successor", { oldId, successor: plan.id, existing });
      }
      const declared = new Set(plan.supersedes || []);
      for (const ancestor of ancestors) if (!declared.has(ancestor)) add("SUPERSEDES_LINEAGE_INCOMPLETE", "reject", `${pointer}/supersedes`, "successor 必须重复完整 supersedes 谱系", { id: plan.id, missing: ancestor });
      for (const oldId of declared) supersededBy.set(oldId, plan.id);
      seen.set(plan.id, { plan, ancestors });
    }
    for (const entry of record.result.cases || []) {
      const previous = latestCase.get(entry.id);
      if (previous?.review?.action === "accept") add("ACCEPTED_CHECK_REPEATED", "advisory", `${record.id}#/cases/${record.result.cases.indexOf(entry)}`, "已 accept 的检查被重新执行，新结果需要重新人审", { id: entry.id, previousRound: previous.record.id });
      latestCase.set(entry.id, { record, entry, review: reviewFor(record, entry.id) });
    }
  }

  for (const [id, latest] of latestCase) {
    if (latest.review?.action !== "reject") continue;
    const successor = supersededBy.get(id);
    const addressed = successor && latestCase.get(successor)?.record.sequence > latest.record.sequence;
    if (!addressed) add("REJECT_UNRESOLVED", "hold", `${latest.record.id}#reviews/${id}`, "最新 reject 尚未被重测或 successor 处理", { id, round: latest.record.id });
  }
  return { ruleset: RULESET_VERSION, outcome: outcomeFromDiagnostics(diagnostics), diagnostics };
}
