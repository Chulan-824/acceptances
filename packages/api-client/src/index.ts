export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}
export interface Repository {
  id: string;
  projectId: string;
  name: string;
  source: string;
}
export type ReviewStatus = "pending" | "accepted" | "rejected";
export interface Campaign {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: ReviewStatus;
  latestRunId: string;
  createdAt: string;
}
export interface Review {
  id: string;
  runId: string;
  checkId?: string;
  kind: "comment" | ReviewStatus;
  body: string;
  createdAt: string;
  legacy: boolean;
}
export interface ReviewInput {
  checkId?: string;
  kind: Review["kind"];
  body: string;
}
export interface ReviewCounts {
  pending: number;
  accepted: number;
  rejected: number;
}
export interface FeedbackResponse {
  runId: string;
  reviewId: string;
  explanation: string;
  checkIds: string[];
}
export interface Evidence {
  path: string;
  description: string;
}
export interface Report {
  title: string;
  description: string;
  verifiedAt: string;
  scope: string;
  scopeType?: "full" | "partial" | "unknown";
  followUp?: {
    sourceRunId: string;
    responses: Omit<FeedbackResponse, "runId">[];
  };
  environment: string;
  versions: { repository: string; commit: string; dirty: boolean | null }[];
  checks: {
    id: string;
    title: string;
    expected: string;
    actual: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    evidence: string[];
  }[];
  evidence: Evidence[];
}
export interface Run {
  id: string;
  campaignId: string;
  submissionId: string;
  report: Report;
  status: ReviewStatus | "void";
  voidReason: string;
  createdAt: string;
  reviews: Review[];
  checkReviews: {
    checkId: string;
    status: ReviewStatus;
    lastReviewId: string;
  }[];
  reviewCounts: ReviewCounts;
  sourceRunAvailable?: boolean;
  feedbackResponses: FeedbackResponse[];
}
export interface DeletePreview {
  projects: number;
  campaigns: number;
  runs: number;
  evidence: number;
  reviews: number;
}
/** The last HTTP phase reached, independent of whether a write committed. */
export class RequestError extends Error {
  readonly phase: "network" | "response" | "body";
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    details: {
      phase: "network" | "response" | "body";
      status?: number;
      code?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "RequestError";
    this.phase = details.phase;
    this.status = details.status;
    this.code = details.code;
  }
}

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, init);
  } catch (cause) {
    throw new RequestError(
      cause instanceof Error ? cause.message : "网络请求失败",
      { phase: "network", cause },
    );
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new RequestError(
      typeof error?.message === "string" && error.message
        ? error.message
        : `请求失败（${response.status}）`,
      {
        phase: "response",
        status: response.status,
        code: typeof error?.code === "string" ? error.code : undefined,
      },
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new RequestError("响应正文无法读取", {
      phase: "body",
      status: response.status,
      cause,
    });
  }
}
export function evidenceURL(run: string, path: string) {
  return `/api/v1/runs/${encodeURIComponent(run)}/evidence/${encodeURIComponent(path)}`;
}

export interface DashboardItem extends Campaign {
  projectName: string;
  latestRun: {
    id: string;
    status: Run["status"];
    createdAt: string;
    verifiedAt: string;
    scopeType: "full" | "partial" | "unknown";
    versions: Report["versions"];
    counts: Record<Report["checks"][number]["status"], number>;
    evidenceCount: number;
    checks: Pick<Report["checks"][number], "id" | "title" | "status">[];
  } | null;
}
