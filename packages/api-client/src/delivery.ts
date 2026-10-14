import type { Campaign, Project, Report, Run } from "./index";

export interface ArtifactRef {
  path: string;
  sha256: string;
}
export interface DeliveryManifest {
  schemaVersion: 1;
  projectId: string;
  campaignId: string;
  requirement: ArtifactRef;
  map: ArtifactRef;
  materials: ArtifactRef;
  build: {
    kind: "artifact" | "not-applicable";
    id: string;
    artifact: ArtifactRef;
    sources: Report["versions"];
    reason: string;
  };
}
export interface VerificationMap {
  schemaVersion: 1;
  projectId: string;
  requirementSha256: string;
  excluded: string[];
  features: {
    id: string;
    title: string;
    checks: {
      id: string;
      title: string;
      expected: string;
      required: boolean;
    }[];
  }[];
}
export interface DocumentationMaterials {
  schemaVersion: 1;
  projectId: string;
  requirementSha256: string;
  mapSha256: string;
  features: {
    featureId: string;
    summary: string;
    roles: string[];
    prerequisites: string[];
    steps: {
      instruction: string;
      expected: string;
      checkIds: string[];
    }[];
    limitations: string[];
    screenshots: {
      path: string;
      caption: string;
      checkIds: string[];
    }[];
    screenshotOmissionReason: string;
  }[];
}
export interface ArchivedFile {
  path: string;
  sha256: string;
  size: number;
}
export interface DeliveryPreparation {
  eligible: boolean;
  token: string;
  issues: { code: string; message: string }[];
  project: Project;
  campaign: Campaign;
  run: Run;
  manifest: DeliveryManifest | null;
  map: VerificationMap | null;
  materials: DocumentationMaterials | null;
  files: ArchivedFile[];
  exceptionReasons: Record<string, string>;
}
export interface CampaignDeliveryOverview {
  campaignId: string;
  preparation: {
    runId: string;
    status: Run["status"];
    scopeType: Report["scopeType"];
    reviewCounts: Run["reviewCounts"];
    eligible: boolean;
    issues: DeliveryPreparation["issues"];
  } | null;
  currentDelivery: DeliverySummary | null;
  latestDelivery: DeliverySummary | null;
  latestDocument: BusinessDocument | null;
}
export interface FreezeDeliveryInput {
  requestId: string;
  token: string;
  mapConfirmed: boolean;
  materialsConfirmed: boolean;
  sensitiveInfoReviewed: boolean;
  exceptionReasons: Record<string, string>;
}
export type DeliveryStatus = "valid" | "invalidated" | "revoked" | "superseded";
export interface DeliveryPayload {
  schemaVersion: 1;
  project: Project;
  campaign: Campaign;
  run: Run;
  manifest: DeliveryManifest;
  map: VerificationMap;
  materials: DocumentationMaterials;
  files: ArchivedFile[];
  exceptionReasons: Record<string, string>;
  mapConfirmed: true;
  materialsConfirmed: true;
  sensitiveInfoReviewed: true;
}
export interface DeliverySnapshot {
  id: string;
  version: number;
  requestId: string;
  status: DeliveryStatus;
  createdAt: string;
  sha256: string;
  payload: DeliveryPayload;
  events: {
    id: string;
    kind: string;
    reason: string;
    reference: string;
    createdAt: string;
  }[];
  successorId: string;
  sourceRunAvailable: boolean;
}
export interface DeliverySummary {
  id: string;
  version: number;
  status: DeliveryStatus;
  createdAt: string;
  projectId: string;
  projectName: string;
  campaignId: string;
  campaignTitle: string;
  runId: string;
  successorId: string;
}
export interface BusinessDocument {
  id: string;
  deliveryId: string;
  version: number;
  requestId: string;
  templateVersion: string;
  status: "generating" | "succeeded" | "failed";
  attempts: number;
  error: string;
  sha256: string;
  createdAt: string;
  completedAt: string;
}
