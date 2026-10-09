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
  kind: "comment" | "accepted" | "rejected";
  body: string;
  createdAt: string;
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
}
export interface DeletePreview {
  projects: number;
  campaigns: number;
  runs: number;
  evidence: number;
  reviews: number;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function evidenceURL(run: string, path: string, download = false) {
  return `/api/v1/runs/${encodeURIComponent(run)}/evidence/${encodeURIComponent(path)}${download ? "?download=1" : ""}`;
}
