import { request } from "@acceptances/api-client";
import type { CampaignRunAdapter } from "./campaign-run-controller";

const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`;
const campaignPath = (id: string) => `/campaigns/${encodeURIComponent(id)}`;

/** HTTP is the only production dependency of the refresh controller. */
export const campaignRunAdapter: CampaignRunAdapter = {
  campaigns: (projectId) =>
    request(`/projects/${encodeURIComponent(projectId)}/campaigns`),
  campaign: (campaignId) => request(campaignPath(campaignId)),
  delivery: (campaignId) => request(`${campaignPath(campaignId)}/delivery`),
  runs: (campaignId) => request(`${campaignPath(campaignId)}/runs`),
  run: (runId) => request(runPath(runId)),
  review: (runId, input) => request(`${runPath(runId)}/reviews`, "POST", input),
  acceptAll: (runId) => request(`${runPath(runId)}/accept-all`, "POST", {}),
  voidRun: (runId, reason) =>
    request(`${runPath(runId)}/void`, "POST", { reason }),
  deleteRun: (runId) => request(runPath(runId), "DELETE"),
  previewDeleteRun: (runId) => request(`${runPath(runId)}/delete-preview`),
};
