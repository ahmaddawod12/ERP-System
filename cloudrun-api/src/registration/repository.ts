import {
  TierSchema,
  type BusinessRegistrationRequest,
} from "@smart-job/api-contracts";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const registrationRowSchema = z.object({
  internal_company_id: z.uuid(),
  public_company_id: z.union([z.string(), z.number().int().positive()]),
  tier: TierSchema,
}).strict();

export interface RegisteredBusinessAccount {
  readonly internalCompanyId: string;
  readonly publicCompanyId: number;
  readonly tier: z.infer<typeof TierSchema>;
}

function publicCompanyId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Registration returned an invalid public company id");
  }
  return parsed;
}

export async function registerBusinessAccount(
  transaction: DatabaseQueryable,
  input: {
    readonly verifiedEmail: string;
    readonly request: BusinessRegistrationRequest;
  },
): Promise<RegisteredBusinessAccount> {
  const profile = input.request.businessProfile;
  const result = await transaction.query(
    `SELECT *
     FROM private.register_api_business_account(
       $1::text,
       $2::text,
       $3::text,
       $4::text,
       $5::text,
       $6::text,
       $7::text,
       $8::text,
       $9::text,
       $10::text,
       $11::text,
       $12::text,
       $13::text,
       $14::text,
       $15::text
     )`,
    [
      input.verifiedEmail,
      input.request.workspaceMode,
      input.request.displayName,
      input.request.phoneNumber,
      profile?.name ?? null,
      profile?.englishName ?? null,
      profile?.vatNumber ?? null,
      profile?.businessType ?? null,
      profile?.city ?? null,
      profile?.address ?? null,
      profile?.phone ?? null,
      profile?.fax ?? null,
      profile?.accountantName ?? null,
      profile?.accountantEmail ?? null,
      profile?.accountantPhone ?? null,
    ],
  );

  const row = registrationRowSchema.parse(result.rows[0]);
  return {
    internalCompanyId: row.internal_company_id,
    publicCompanyId: publicCompanyId(row.public_company_id),
    tier: row.tier,
  };
}
