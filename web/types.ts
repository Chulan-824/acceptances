/*
 * Provenance notice (recorded 2026-10-08); renderer origin/derivation remains pending.
 * Visualization/encoding/comparison protocol types have upstream correspondences.
 * AI-assisted local rewrite referenced lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Applicable upstream portions retain LobeHub Community License + Apache-2.0 and
 * Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * See ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * This notice does not certify the whole component as derived or grant MIT.
 */
export type Status = "pass" | "fail" | "blocked" | "not-run";
export type Verdict = "pass" | "fail" | "partial" | string;

export interface Review {
  action: "accept" | "reject";
  reason?: string;
  reviewedAt: string;
  roundDigest?: string;
}

export interface Comparison {
  id: string;
  role: "before" | "after";
  layout?: "horizontal" | "vertical";
  label?: string;
}

export type Evidence =
  | string
  | {
      path: string;
      comparison?: Comparison;
    };

export interface PlanItem {
  id: string;
  title: string;
  category: string;
  verifier: "program" | "agent" | "llm";
  method: string;
  expected: string;
  requiredEvidence: string[];
  supersedes: string[];
}

export interface DatasetField {
  key: string;
  type: "string" | "number" | "boolean" | "category" | "temporal";
  label?: string;
}

export interface Dataset {
  id: string;
  fields: DatasetField[];
  rows: Record<string, unknown>[];
}

export interface ChartSeries {
  field: string;
  label?: string;
  style?: "muted" | "primary" | "accent";
}

export interface VisualizationEncoding {
  label?: string;
  before?: string;
  after?: string;
  beforeSamples?: string;
  afterSamples?: string;
  direction?: string;
  statistic?: string;
  target?: string;
  unit?: string;
  x?: string;
  y?: string;
  color?: string;
  category?: string;
  value?: string;
  xLabel?: string;
  yLabel?: string;
  valueLabel?: string;
  series?: ChartSeries[];
  columns?: string[];
  highlights?: Array<{ field: string; mode: "min" | "max" }>;
}

export interface Visualization {
  id: string;
  type:
    | "metric-comparison"
    | "line-chart"
    | "bar-chart"
    | "scatter-plot"
    | "heatmap"
    | "table"
    | string;
  version: number;
  dataset: string;
  title?: string;
  context?: string;
  encoding?: VisualizationEncoding;
}

export interface CaseItem {
  id: string;
  name?: string;
  category?: string;
  surface?: string;
  status: Exclude<Status, "not-run">;
  observation?: string;
  evidence?: Evidence[];
  datasets?: Dataset[];
  visualizations?: Visualization[];
}

export interface ItemHistory {
  round: string;
  index: number | null;
  createdAt: string;
  status: Status;
  review: Review | null;
}

export interface DeliveryItem {
  id: string;
  plan: PlanItem | null;
  case: CaseItem | null;
  review: Review | null;
  status: Status;
  sourceRound: string;
  sourceIndex: number | null;
  sourceSequence?: number;
  evidenceTexts: Record<string, string>;
  history: ItemHistory[];
  held: boolean;
  staleReview: Review | null;
}

export interface ValidationDiagnostic {
  code: string;
  source: "lobehub-public" | "compat-assumption" | "local-safety";
  effect: "reject" | "hold" | "drop" | "normalize" | "advisory";
  path: string;
  message: string;
  ruleVersion: string;
  details?: Record<string, unknown>;
  round?: string;
}

export interface RoundSummary {
  id: string;
  sequence: number | null;
  state: "ready" | "held" | "rejected" | "legacy";
  outcome: "ready" | "held" | "rejected";
  ruleset: string;
  diagnostics: ValidationDiagnostic[];
  title: string;
  createdAt: string;
  verdict: Verdict;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notRun: number;
  pendingReview: number;
}

export interface Delivery {
  mode: "union" | "round";
  root: string;
  subject: string;
  selectedRound: string | null;
  selectedIndex: number | null;
  title: string;
  createdAt: string;
  branch: string;
  commit: string;
  entry: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
    verdict: Verdict;
    conclusion?: string;
  };
  report: string;
  items: DeliveryItem[];
  rounds: RoundSummary[];
  validationOutcome: "ready" | "held" | "rejected" | "legacy";
  ruleset: string;
  digest: string;
  diagnostics: ValidationDiagnostic[];
  pendingReview: number;
}

export interface CatalogRoot {
  root: string;
  registeredAt?: string;
  updatedAt?: string;
  alive: boolean;
}

export interface SubjectSummary {
  name: string;
  rounds: RoundSummary[];
}
