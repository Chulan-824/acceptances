import type { Report, ReviewStatus } from "@acceptances/api-client";

const statuses = [
  { value: "all", label: "全部" },
  { value: "passed", label: "通过" },
  { value: "failed", label: "失败" },
  { value: "blocked", label: "阻塞" },
  { value: "skipped", label: "未执行" },
];
const humanStatuses = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审" },
  { value: "accepted", label: "通过" },
  { value: "rejected", label: "不通过" },
];

export function filterChecklist(
  checks: Report["checks"],
  humanStates: ReadonlyMap<string, ReviewStatus>,
  filters: { query: string; status: string; humanStatus: string },
) {
  const search = filters.query.trim().toLocaleLowerCase();
  const searched = checks.filter((check) =>
    [check.id, check.title, check.expected, check.actual].some((text) =>
      text.toLocaleLowerCase().includes(search),
    ),
  );
  const matchesStatus = (check: Report["checks"][number]) =>
    filters.status === "all" || check.status === filters.status;
  const humanStatus = (check: Report["checks"][number]) =>
    humanStates.get(check.id) || "pending";
  const matchesHumanStatus = (check: Report["checks"][number]) =>
    filters.humanStatus === "all" || humanStatus(check) === filters.humanStatus;

  return {
    checks: searched.filter(
      (check) => matchesStatus(check) && matchesHumanStatus(check),
    ),
    statusOptions: statuses.map((option) => ({
      ...option,
      count: searched.filter(
        (check) =>
          matchesHumanStatus(check) &&
          (option.value === "all" || check.status === option.value),
      ).length,
    })),
    humanStatusOptions: humanStatuses.map((option) => ({
      ...option,
      count: searched.filter(
        (check) =>
          matchesStatus(check) &&
          (option.value === "all" || humanStatus(check) === option.value),
      ).length,
    })),
  };
}
