export type Status = "pass" | "fail" | "blocked" | "not-run";
export type Verdict = "pass" | "fail" | "partial" | string;

export interface Review {
  action: "accept" | "reject";
  reason?: string;
  reviewedAt: string;
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
  title?: string;
  category?: string;
  method?: string;
  expected?: string;
  requiredEvidence?: string[];
}

export interface DatasetField {
  key: string;
  type?: "string" | "number" | "boolean" | string;
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
  index: number;
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
  sourceIndex: number;
  evidenceTexts: Record<string, string>;
  history: ItemHistory[];
}

export interface RoundSummary {
  id: string;
  index: number;
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
