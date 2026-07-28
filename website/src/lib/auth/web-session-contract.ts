import type { Viewer } from "@smart-job/api-contracts";

export {
  WebSessionCreateRequestSchema,
  WebSessionCreatedSchema as WebSessionCreateResultSchema,
  WebSessionCurrentSchema as WebSessionCurrentResultSchema,
  WebSessionRevokedSchema as WebSessionRevokeResultSchema,
} from "@smart-job/api-contracts";
export type {
  WebSessionCreateRequest,
  WebSessionCreated as WebSessionCreateResult,
  WebSessionCurrent as WebSessionCurrentResult,
  WebSessionRevoked as WebSessionRevokeResult,
} from "@smart-job/api-contracts";

export interface WebsiteSessionView {
  viewer: Viewer;
  absoluteExpiresAt: string;
}
