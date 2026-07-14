import {
  WorkspaceSummarySchema,
  type WorkspaceSummary,
} from "@smart-job/api-contracts";
import {
  getEnabledModulesForTier,
  type AccountTypeValue,
  type RoleTitle,
} from "@smart-job/contracts";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const workspaceRowSchema = z.object({
  public_company_id: z.union([z.string(), z.number().int().positive()]),
  name: z.string().nullable(),
  account_type: z.string(),
  role: z.string(),
  member_no: z.number().int().positive().nullable(),
  tier: z.string().nullable(),
  enabled_modules: z.unknown(),
}).strict();

type BooleanMap = Record<string, boolean>;

function parsePublicCompanyId(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("Database returned an invalid public company id");
  }
  return numeric;
}

function booleanOverrides(value: unknown): BooleanMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, enabled]) =>
      typeof enabled === "boolean" && key.trim().length > 0
        ? [[key, enabled] as const]
        : []),
  );
}

function enabledModuleNames(tier: string | null, overrides: unknown): string[] {
  const enabled = {
    ...getEnabledModulesForTier(tier),
    ...booleanOverrides(overrides),
  };
  return Object.entries(enabled)
    .filter(([, isEnabled]) => isEnabled)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

export const LIST_WORKSPACES_SQL = `
  WITH viewer AS (
    SELECT app_user.system_role
    FROM public.app_users app_user
    WHERE app_user.id = $1
  ),
  member_workspaces AS (
    SELECT
      company.public_company_id::text AS public_company_id,
      COALESCE(
        NULLIF(BTRIM(profile.he_name), ''),
        NULLIF(BTRIM(profile.en_name), ''),
        'Company ' || company.public_company_id::text
      ) AS name,
      company.account_type::text AS account_type,
      membership.role::text AS role,
      membership.member_no,
      subscription.tier::text AS tier,
      COALESCE(subscription.enabled_modules, '{}'::jsonb) ||
        pg_catalog.jsonb_build_object(
          'solojob', entitlement.jobs_enabled,
          'clients', entitlement.clients_enabled,
          'inventory', entitlement.inventory_enabled,
          'documents', entitlement.documents_enabled
        ) AS enabled_modules
    FROM public.company_memberships membership
    INNER JOIN public.companies company
      ON company.id = membership.company_id
     AND company.status = 'active'
    LEFT JOIN public.company_profiles profile
      ON profile.company_id = company.id
    LEFT JOIN public.company_subscriptions subscription
      ON subscription.company_id = company.id
    CROSS JOIN LATERAL private.get_company_module_entitlements(company.id) AS entitlement
    WHERE membership.user_id = $1
      AND membership.status = 'active'
  ),
  dev_workspaces AS (
    SELECT
      company.public_company_id::text AS public_company_id,
      COALESCE(
        NULLIF(BTRIM(profile.he_name), ''),
        NULLIF(BTRIM(profile.en_name), ''),
        'Company ' || company.public_company_id::text
      ) AS name,
      company.account_type::text AS account_type,
      'dev'::text AS role,
      NULL::integer AS member_no,
      subscription.tier::text AS tier,
      COALESCE(subscription.enabled_modules, '{}'::jsonb) ||
        pg_catalog.jsonb_build_object(
          'solojob', entitlement.jobs_enabled,
          'clients', entitlement.clients_enabled,
          'inventory', entitlement.inventory_enabled,
          'documents', entitlement.documents_enabled
        ) AS enabled_modules
    FROM public.companies company
    CROSS JOIN viewer
    LEFT JOIN public.company_profiles profile
      ON profile.company_id = company.id
    LEFT JOIN public.company_subscriptions subscription
      ON subscription.company_id = company.id
    CROSS JOIN LATERAL private.get_company_module_entitlements(company.id) AS entitlement
    WHERE viewer.system_role = 'dev'
      AND company.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM member_workspaces member_workspace
        WHERE member_workspace.public_company_id = company.public_company_id::text
      )
  )
  SELECT combined.*
  FROM (
    SELECT * FROM member_workspaces
    UNION ALL
    SELECT * FROM dev_workspaces
  ) AS combined
  ORDER BY combined.public_company_id::bigint ASC
  LIMIT 200
`;

export function mapWorkspaceSummaryRow(unknownRow: unknown): WorkspaceSummary {
  const row = workspaceRowSchema.parse(unknownRow);
  return WorkspaceSummarySchema.parse({
    companyId: parsePublicCompanyId(row.public_company_id),
    name: row.name,
    accountType: row.account_type as AccountTypeValue,
    role: row.role as RoleTitle,
    memberNo: row.member_no,
    enabledModules: enabledModuleNames(row.tier, row.enabled_modules),
  });
}

export async function listWorkspaceSummaries(
  transaction: DatabaseQueryable,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const result = await transaction.query(LIST_WORKSPACES_SQL, [userId]);

  return result.rows.map(mapWorkspaceSummaryRow);
}
