import { Badge } from "./components/ui/badge";
import type { Report } from "@acceptances/api-client";

const statuses = [
  { value: "passed", label: "通过" },
  { value: "failed", label: "失败" },
  { value: "blocked", label: "阻塞" },
  { value: "skipped", label: "未执行" },
] as const;

export function CheckCounts({ checks }: { checks: Report["checks"] }) {
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const check of checks) counts[check.status]++;
  return (
    <span className="check-counts" aria-label="检查结果数量">
      {statuses.map(({ value, label }) => (
        <Badge key={value} className={`badge ${value}`}>
          {counts[value]} {label}
        </Badge>
      ))}
    </span>
  );
}
