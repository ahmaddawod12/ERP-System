import "server-only";

import {
  InvitationCreateResultSchema,
  type InvitationCreateRequest,
  type InvitationCreateResult,
  InvitationRedemptionResultSchema,
  type InvitationRedeemRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { backendRequest } from "./transport";

const INVITATION_REDEMPTION_PATH = "/api/v1/auth/invitations/redeem";

export interface CreatedWorkspaceInvitation extends InvitationCreateResult {
  readonly requestId: string;
}

export async function createWorkspaceInvitation(
  companyId: number,
  input: InvitationCreateRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
): Promise<CreatedWorkspaceInvitation> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
  const result = await backendRequest(
    `/api/v1/companies/${companyId}/invitations`,
    InvitationCreateResultSchema,
    {
      method: "POST",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { ...result.data, requestId: result.meta.requestId };
}

export async function redeemWorkspaceInvitation(
  input: InvitationRedeemRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
) {
  const result = await backendRequest(
    INVITATION_REDEMPTION_PATH,
    InvitationRedemptionResultSchema,
    {
      method: "POST",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { ...result.data, requestId: result.meta.requestId };
}
