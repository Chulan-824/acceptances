import type { User } from "./index";

export interface LarkConnector {
  id: string;
  name: string;
  protocolVersion: number;
  larkCliVersion: string;
  lastSeenAt: string;
  online: boolean;
}
export interface PRDWarning {
  code: string;
  message: string;
  blockId?: string;
  resourceId?: string;
}
export interface PRDResource {
  reference: string;
  resourceId?: string;
  kind: string;
  name?: string;
  filename?: string;
  status: string;
  reason?: string;
  blockId?: string;
}
export interface PRDFile {
  name: string;
  role: string;
  contentType: string;
  size: number;
  sha256: string;
}
export interface PRDManifest {
  schemaVersion: number;
  documentId: string;
  realm: string;
  revisionId: string;
  title: string;
  fetchedAt: string;
  normalizerVersion: string;
  completeness: "complete" | "partial";
  warnings: PRDWarning[];
  files: PRDFile[];
  resources: PRDResource[];
}
export interface PRDImport {
  id: string;
  campaignId: string;
  connectorId: string;
  url: string;
  status:
    | "queued"
    | "fetching"
    | "ready"
    | "confirmed"
    | "failed"
    | "cancelled"
    | "expired";
  phase?: string;
  attempt: number;
  baseSnapshotId: string;
  confirmedSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string;
  manifest?: PRDManifest;
  createdBy?: User;
}
export interface PRDSnapshot {
  id: string;
  campaignId: string;
  importId: string;
  sourceUrl: string;
  sourceHash: string;
  resourceHash: string;
  createdAt: string;
  createdBy?: User;
  manifest: PRDManifest;
}
export interface PRDSnapshotList {
  currentSnapshotId: string;
  items: PRDSnapshot[];
}
