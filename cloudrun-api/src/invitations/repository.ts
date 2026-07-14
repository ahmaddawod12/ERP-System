import {
  InvitationCreateResultSchema,
  InvitationTargetRoleSchema,
  type InvitationCreateRequest,
  type InvitationCreateResult,
  type InvitationRedeemRequest,
  type InvitationTargetRole,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const databaseTimestampSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }),
]);

const invitationCreateRowSchema = z.object({
  invite_id: z.uuid(),
  invite_code: z.string().trim().min(4).max(80),
  target_role: InvitationTargetRoleSchema,
  status: z.literal("active"),
  expires_at: databaseTimestampSchema,
  created_at: databaseTimestampSchema,
}).strict();

const invitationRedemptionRowSchema = z.object({
  internal_company_id: z.uuid(),
  public_company_id: z.union([z.string(), z.number().int().positive()]),
  membership_id: z.uuid(),
  member_no: z.number().int().positive(),
  role: InvitationTargetRoleSchema,
  display_name: z.string().trim().min(1).max(200).nullable(),
  joined_at: databaseTimestampSchema,
}).strict();

interface InvitationCreateRow extends QueryResultRow {
  readonly invite_id: string;
  readonly invite_code: string;
  readonly target_role: InvitationTargetRole;
  readonly status: "active";
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
}

interface InvitationRedemptionRow extends QueryResultRow {
  readonly internal_company_id: string;
  readonly public_company_id: string | number;
  readonly membership_id: string;
  readonly member_no: number;
  readonly role: InvitationTargetRole;
  readonly display_name: string | null;
  readonly joined_at: Date | string;
}

export interface RedeemedInvitationMembership {
  readonly internalCompanyId: string;
  readonly publicCompanyId: number;
  readonly membershipId: string;
  readonly memberNo: number;
  readonly role: InvitationTargetRole;
  readonly displayName: string | null;
  readonly joinedAt: string;
}

export const CREATE_COMPANY_INVITATION_SQL = `
  SELECT invite_id, invite_code, target_role, status, expires_at, created_at
  FROM private.create_api_company_invitation(
    $1::uuid,
    $2::text,
    $3::text,
    $4::integer
  )
`;

export const REDEEM_COMPANY_INVITATION_SQL = `
  SELECT
    internal_company_id,
    public_company_id,
    membership_id,
    member_no,
    role,
    display_name,
    joined_at
  FROM private.redeem_api_company_invitation(
    $1::bigint,
    $2::text,
    $3::text,
    $4::text
  )
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function publicCompanyId(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("Invitation redemption returned an invalid public company id");
  }
  return numeric;
}

export async function createCompanyInvitation(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: InvitationCreateRequest;
  },
): Promise<InvitationCreateResult> {
  const result = await transaction.query<InvitationCreateRow>(
    CREATE_COMPANY_INVITATION_SQL,
    [
      input.internalCompanyId,
      input.request.targetRole,
      input.request.targetEmail ?? null,
      input.request.expiresInDays,
    ],
  );
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) {
    throw new Error("Invitation creation returned no row");
  }
  const row = invitationCreateRowSchema.parse(unknownRow);
  return InvitationCreateResultSchema.parse({
    inviteId: row.invite_id,
    inviteCode: row.invite_code,
    targetRole: row.target_role,
    status: row.status,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
  });
}

export async function redeemCompanyInvitation(
  transaction: DatabaseQueryable,
  request: InvitationRedeemRequest,
): Promise<RedeemedInvitationMembership> {
  const result = await transaction.query<InvitationRedemptionRow>(
    REDEEM_COMPANY_INVITATION_SQL,
    [
      request.companyId,
      request.inviteCode,
      request.displayName ?? null,
      request.phoneNumber ?? null,
    ],
  );
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) {
    throw new Error("Invitation redemption returned no row");
  }
  const row = invitationRedemptionRowSchema.parse(unknownRow);
  const normalizedPublicCompanyId = publicCompanyId(row.public_company_id);
  if (normalizedPublicCompanyId !== request.companyId) {
    throw new Error("Invitation redemption returned a different workspace");
  }
  return {
    internalCompanyId: row.internal_company_id,
    publicCompanyId: normalizedPublicCompanyId,
    membershipId: row.membership_id,
    memberNo: row.member_no,
    role: row.role,
    displayName: row.display_name,
    joinedAt: toIso(row.joined_at),
  };
}
