export type DeletionTarget =
  | { kind: "project"; projectId: string; name: string }
  | { kind: "campaign"; projectId: string; campaignId: string; name: string }
  | {
      kind: "run";
      projectId: string;
      campaignId: string;
      runId: string;
      name: string;
    };

export const deletionLabels = {
  project: "项目",
  campaign: "需求",
  run: "验证记录",
};

export function deletionKey(target: DeletionTarget) {
  return `${target.kind}:${target.kind === "project" ? target.projectId : target.kind === "campaign" ? target.campaignId : target.runId}`;
}

export function deletionPath(target: DeletionTarget) {
  const id =
    target.kind === "project"
      ? target.projectId
      : target.kind === "campaign"
        ? target.campaignId
        : target.runId;
  return `/${target.kind}s/${encodeURIComponent(id)}`;
}

export function deletionReturnPath(target: DeletionTarget) {
  const project = `/projects/${encodeURIComponent(target.projectId)}`;
  return target.kind === "project"
    ? "/"
    : target.kind === "campaign"
      ? project
      : `${project}/campaigns/${encodeURIComponent(target.campaignId)}`;
}

export function deletionCovers(
  target: DeletionTarget,
  scope: { projectId?: string; campaignId?: string; runId?: string },
) {
  return (
    target.projectId === scope.projectId &&
    (target.kind === "project" ||
      (target.campaignId === scope.campaignId &&
        (target.kind === "campaign" || target.runId === scope.runId)))
  );
}
