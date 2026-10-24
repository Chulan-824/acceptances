import test from "node:test";
import assert from "node:assert/strict";
import { filterChecklist } from "../src/checklist-filter.ts";

const checks = [
  {
    id: "C1",
    title: "字幕搜索",
    expected: "默认分页",
    actual: "正常",
    status: "passed",
  },
  {
    id: "C2",
    title: "字幕导出",
    expected: "下载",
    actual: "失败",
    status: "failed",
  },
  {
    id: "C3",
    title: "视频播放",
    expected: "加载",
    actual: "等待 VIDEO",
    status: "blocked",
  },
  {
    id: "C4",
    title: "字幕样式",
    expected: "STYLE",
    actual: "未执行",
    status: "skipped",
  },
  {
    id: "C5",
    title: "视频保存",
    expected: "正常",
    actual: "正常",
    status: "passed",
  },
];
const humanStates = new Map([
  ["C1", "accepted"],
  ["C2", "rejected"],
  ["C3", "pending"],
]);
const all = { query: "", status: "all", humanStatus: "all" };
const ids = (view) => view.checks.map((check) => check.id);
const counts = (options) =>
  Object.fromEntries(options.map(({ value, count }) => [value, count]));

test("unfiltered counts include every raw status and default missing reviews to pending", () => {
  const view = filterChecklist(checks, humanStates, all);
  assert.deepEqual(ids(view), ["C1", "C2", "C3", "C4", "C5"]);
  assert.deepEqual(counts(view.statusOptions), {
    all: 5,
    passed: 2,
    failed: 1,
    blocked: 1,
    skipped: 1,
  });
  assert.deepEqual(counts(view.humanStatusOptions), {
    all: 5,
    pending: 3,
    accepted: 1,
    rejected: 1,
  });
});

test("option counts predict switching that filter while retaining search and the other filter", () => {
  const filters = { query: "字幕", status: "passed", humanStatus: "pending" };
  const view = filterChecklist(checks, humanStates, filters);
  assert.deepEqual(ids(view), []);
  assert.deepEqual(counts(view.statusOptions), {
    all: 1,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 1,
  });
  assert.deepEqual(counts(view.humanStatusOptions), {
    all: 1,
    pending: 0,
    accepted: 1,
    rejected: 0,
  });
  for (const option of view.statusOptions) {
    assert.equal(
      filterChecklist(checks, humanStates, { ...filters, status: option.value })
        .checks.length,
      option.count,
    );
  }
  for (const option of view.humanStatusOptions) {
    assert.equal(
      filterChecklist(checks, humanStates, {
        ...filters,
        humanStatus: option.value,
      }).checks.length,
      option.count,
    );
  }
});

test("search preserves trimmed case-insensitive matches across id, title, expected and actual", () => {
  for (const [query, expected] of [
    [" c1 ", ["C1"]],
    ["字幕", ["C1", "C2", "C4"]],
    ["style", ["C4"]],
    [" video ", ["C3"]],
  ]) {
    assert.deepEqual(
      ids(filterChecklist(checks, humanStates, { ...all, query })),
      expected,
    );
  }
});

test("empty reports and unmatched searches retain selectable options with zero counts", () => {
  for (const view of [
    filterChecklist([], humanStates, all),
    filterChecklist(checks, humanStates, { ...all, query: "不存在" }),
  ]) {
    assert.deepEqual(view.checks, []);
    assert.equal(view.statusOptions.length, 5);
    assert.equal(view.humanStatusOptions.length, 4);
    assert.ok(
      [...view.statusOptions, ...view.humanStatusOptions].every(
        (option) => option.count === 0,
      ),
    );
  }
});

test("filtering preserves check identities, source order and review state", () => {
  const originalChecks = structuredClone(checks);
  const originalReviews = new Map(humanStates);
  const view = filterChecklist(checks, humanStates, {
    ...all,
    humanStatus: "pending",
  });
  assert.deepEqual(ids(view), ["C3", "C4", "C5"]);
  assert.equal(view.checks[0], checks[2]);
  assert.deepEqual(checks, originalChecks);
  assert.deepEqual(humanStates, originalReviews);
  assert.deepEqual(
    ids(filterChecklist(checks, humanStates, all)),
    checks.map((check) => check.id),
  );
});
