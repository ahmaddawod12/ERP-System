import {
  BusinessProfileSchema,
  ViewerProfileSchema,
  type BusinessProfile,
  type BusinessProfileUpdateRequest,
  type ViewerProfile,
  type ViewerProfileUpdateRequest,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import { AppError } from "../http/errors.js";

const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const publicCompanyIdSchema = z.union([z.string(), z.number().int().positive()]).nullable();

const viewerProfileRowSchema = z.object({
  uid: z.uuid(),
  email: z.email(),
  display_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  system_role: z.literal("dev").nullable(),
  public_company_id: publicCompanyIdSchema,
  updated_at: dateValueSchema,
}).strict();

interface ViewerProfileRow extends QueryResultRow {
  readonly uid: string;
  readonly email: string;
  readonly display_name: string | null;
  readonly phone_number: string | null;
  readonly system_role: "dev" | null;
  readonly public_company_id: string | number | null;
  readonly updated_at: Date | string;
}

const businessProfileRowSchema = z.object({
  public_company_id: z.union([z.string(), z.number().int().positive()]),
  he_name: z.string().nullable(),
  en_name: z.string().nullable(),
  vat_number: z.string().nullable(),
  business_type: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  business_email: z.string().nullable(),
  business_phone: z.string().nullable(),
  business_fax: z.string().nullable(),
  accountant_name: z.string().nullable(),
  accountant_email: z.string().nullable(),
  accountant_phone: z.string().nullable(),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
  updated_at: dateValueSchema,
}).strict();

interface BusinessProfileRow extends QueryResultRow {
  readonly public_company_id: string | number;
  readonly he_name: string | null;
  readonly en_name: string | null;
  readonly vat_number: string | null;
  readonly business_type: string | null;
  readonly city: string | null;
  readonly address: string | null;
  readonly business_email: string | null;
  readonly business_phone: string | null;
  readonly business_fax: string | null;
  readonly accountant_name: string | null;
  readonly accountant_email: string | null;
  readonly accountant_phone: string | null;
  readonly entity_version: string | number | bigint;
  readonly updated_at: Date | string;
}

export const UPDATE_VIEWER_PROFILE_SQL = `
  SELECT *
  FROM private.update_api_viewer_profile($1::uuid, $2::jsonb)
`;

export const READ_VIEWER_PROFILE_SQL = `
  SELECT
    app_user.id::uuid AS uid,
    app_user.email,
    app_user.display_name,
    app_user.phone_number,
    app_user.system_role::text AS system_role,
    $2::bigint AS public_company_id,
    app_user.updated_at
  FROM public.app_users AS app_user
  WHERE app_user.id = $1::text
  LIMIT 1
`;

export const READ_BUSINESS_PROFILE_SQL = `
  SELECT
    company.public_company_id::text AS public_company_id,
    profile.he_name,
    profile.en_name,
    profile.vat_number,
    profile.business_type,
    profile.city,
    profile.address,
    profile.business_email,
    profile.business_phone,
    profile.business_fax,
    profile.accountant_name,
    profile.accountant_email,
    profile.accountant_phone,
    profile.entity_version,
    profile.last_updated_at AS updated_at
  FROM public.company_profiles AS profile
  INNER JOIN public.companies AS company
    ON company.id = profile.company_id
  WHERE profile.company_id = $1::uuid
    AND company.status = 'active'
  LIMIT 1
`;

export const UPDATE_BUSINESS_PROFILE_SQL = `
  SELECT *
  FROM private.update_api_company_profile($1::uuid, $2::bigint, $3::jsonb)
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function publicCompanyId(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Database returned an invalid public company id");
  }
  return parsed;
}

function missingProfile(code: string, message: string): AppError {
  return new AppError({ statusCode: 404, code, message });
}

function mapViewerProfile(unknownRow: unknown): ViewerProfile {
  const row = viewerProfileRowSchema.parse(unknownRow);
  return ViewerProfileSchema.parse({
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    systemRole: row.system_role,
    companyId: row.public_company_id === null ? null : publicCompanyId(row.public_company_id),
    updatedAt: toIso(row.updated_at),
  });
}

function mapBusinessProfile(unknownRow: unknown): BusinessProfile {
  const row = businessProfileRowSchema.parse(unknownRow);
  return BusinessProfileSchema.parse({
    companyId: publicCompanyId(row.public_company_id),
    heName: row.he_name,
    enName: row.en_name,
    vatNumber: row.vat_number,
    businessType: row.business_type,
    city: row.city,
    address: row.address,
    businessEmail: row.business_email,
    businessPhone: row.business_phone,
    businessFax: row.business_fax,
    accountantName: row.accountant_name,
    accountantEmail: row.accountant_email,
    accountantPhone: row.accountant_phone,
    entityVersion: encodeEntityVersion(row.entity_version),
    updatedAt: toIso(row.updated_at),
  });
}

export async function updateViewerProfile(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string | null;
    readonly request: ViewerProfileUpdateRequest;
  },
): Promise<ViewerProfile> {
  const { companyId: _publicCompanyId, ...patch } = input.request;
  const result = await transaction.query<ViewerProfileRow>(
    UPDATE_VIEWER_PROFILE_SQL,
    [input.internalCompanyId, JSON.stringify(patch)],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw missingProfile("PROFILE_NOT_FOUND", "The authenticated user profile was not found.");
  }
  return mapViewerProfile(row);
}

export async function readViewerProfile(
  transaction: DatabaseQueryable,
  input: {
    readonly userId: string;
    readonly publicCompanyId: number | null;
  },
): Promise<ViewerProfile> {
  const result = await transaction.query<ViewerProfileRow>(
    READ_VIEWER_PROFILE_SQL,
    [input.userId, input.publicCompanyId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw missingProfile("PROFILE_NOT_FOUND", "The authenticated user profile was not found.");
  }
  return mapViewerProfile(row);
}

export async function readBusinessProfile(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
): Promise<BusinessProfile> {
  const result = await transaction.query<BusinessProfileRow>(
    READ_BUSINESS_PROFILE_SQL,
    [internalCompanyId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw missingProfile("COMPANY_PROFILE_NOT_FOUND", "The company profile was not found.");
  }
  return mapBusinessProfile(row);
}

export async function updateBusinessProfile(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly expectedEntityVersion: bigint;
    readonly request: BusinessProfileUpdateRequest;
  },
): Promise<BusinessProfile> {
  const { entityVersion: _entityVersion, ...patch } = input.request;
  const result = await transaction.query<BusinessProfileRow>(
    UPDATE_BUSINESS_PROFILE_SQL,
    [
      input.internalCompanyId,
      input.expectedEntityVersion.toString(),
      JSON.stringify(patch),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw missingProfile("COMPANY_PROFILE_NOT_FOUND", "The company profile was not found.");
  }
  return mapBusinessProfile(row);
}
