export const RULESET_VERSION = "lobehub-acceptance-public@0.1.0";

export const VERIFIERS = new Set(["program", "agent", "llm"]);
export const EVIDENCE_TYPES = new Set([
  "screenshot",
  "gif",
  "video",
  "audio",
  "text",
  "markdown",
  "dom_snapshot",
  "transcript",
]);
export const SURFACES = new Set(["web", "desktop", "cli", "mobile", "bot"]);
export const CASE_STATUSES = new Set(["pass", "fail", "blocked"]);
export const VERDICTS = new Set(["pass", "fail", "partial"]);
export const FIELD_TYPES = new Set([
  "boolean",
  "category",
  "number",
  "string",
  "temporal",
]);
export const VISUALIZATION_TYPES = new Set([
  "metric-comparison",
  "line-chart",
  "bar-chart",
  "scatter-plot",
  "heatmap",
  "table",
]);

const EXACT_GATE = [
  /^(unit|integration|regression|snapshot) tests?$/i,
  /^(test coverage|type[- ]?check|tsc|lint|eslint|format(?:ting)?|build|compile|ci)$/i,
  /^(单元|集成|回归|快照)测试$/,
  /^(测试覆盖率|覆盖率|类型检查|静态检查|代码格式化?|构建|编译|ci)$/i,
];

const GATE_INTENT = [
  /\b(unit|integration|regression|snapshot) tests?\b.*\b(pass|passed|passing|green|success|successful|run|runs|running)\b/i,
  /\b(run|runs|running)\b.*\b(unit|integration|regression|snapshot) tests?\b/i,
  /\b(coverage|type[- ]?check|tsc|lint|eslint|format(?:ting)?|build|compile|ci)\b.*\b(pass|passed|clean|green|success|successful)\b/i,
  /\b(pass|passed|clean|green|success|successful)\b.*\b(coverage|type[- ]?check|tsc|lint|eslint|format(?:ting)?|build|compile|ci)\b/i,
  /(单元测试|集成测试|回归测试|快照测试|测试覆盖率|覆盖率|类型检查|静态检查|代码格式|构建|编译|CI).*(通过|成功|绿色|运行|执行)/i,
  /(运行|执行).*(单元测试|集成测试|回归测试|快照测试|类型检查|静态检查|代码格式|构建|编译|CI)/i,
];

export function normalizedSurface(value) {
  return value === "electron" ? "desktop" : value;
}

export function gateMatch(plan) {
  for (const field of ["title", "category", "method"]) {
    const value = typeof plan?.[field] === "string" ? plan[field].trim() : "";
    if (!value) continue;
    if (EXACT_GATE.some((pattern) => pattern.test(value))) {
      return { field, value, rule: "exact-gate-subject" };
    }
    if (GATE_INTENT.some((pattern) => pattern.test(value))) {
      return { field, value, rule: "gate-intent" };
    }
  }
  return null;
}

export function outcomeFromDiagnostics(diagnostics) {
  if (diagnostics.some((entry) => entry.effect === "reject")) return "rejected";
  if (diagnostics.some((entry) => entry.effect === "hold")) return "held";
  return "ready";
}

export function diagnostic(code, source, effect, path, message, details) {
  return {
    code,
    source,
    effect,
    path,
    message,
    ruleVersion: RULESET_VERSION,
    ...(details === undefined ? {} : { details }),
  };
}
