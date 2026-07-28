import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import { mapWorkspaceSummaryRow } from "../workspaces/repository.js";

const tenantRowSchema = z.object({
  internal_company_id: z.uuid(),
  public_company_id: z.union([z.string(), z.number()]),
  name: z.string(),
  account_type: z.string(),
  role: z.string(),
  member_no: z.number().int().positive().nullable(),
  tier: z.string().nullable(),
  enabled_modules: z.unknown(),
}).strict();

export interface TenantContext {
  readonly internalCompanyId: string;
  readonly workspace: ReturnType<typeof mapWorkspaceSummaryRow>;
}

export const RESOLVE_TENANT_SQL = `
  WITH viewer AS (
    SELECT app_user.system_role
    FROM public.app_users app_user
    WHERE app_user.id = $1
  ),
  viewer_membership AS (
    SELECT membership.role, membership.member_no
    FROM public.company_memberships membership
    INNER JOIN public.companies member_company
      ON member_company.id = membership.company_id
    WHERE membership.user_id = $1
      AND membership.status = 'active'
      AND member_company.public_company_id = $2
    LIMIT 1
  )
  SELECT
    company.id AS internal_company_id,
    company.public_company_id::text AS public_company_id,
    COALESCE(
      NULLIF(BTRIM(profile.he_name), ''),
      NULLIF(BTRIM(profile.en_name), ''),
      'Company ' || company.public_company_id::text
    ) AS name,
    company.account_type::text AS account_type,
    COALESCE(viewer_membership.role::text, 'dev') AS role,
    viewer_membership.member_no,
    subscription.tier::text AS tier,
    COALESCE(subscription.enabled_modules, '{}'::jsonb) ||
      pg_catalog.jsonb_build_object(
        'solojob', entitlement.jobs_enabled,
        'clients', entitlement.clients_enabled,
        'inventory', entitlement.inventory_enabled,
        'documents', entitlement.documents_enabled
      ) AS enabled_modules
  FROM public.companies company
  LEFT JOIN public.company_profiles profile
    ON profile.company_id = company.id
  LEFT JOIN public.company_subscriptions subscription
    ON subscription.company_id = company.id
  CROSS JOIN LATERAL private.get_company_module_entitlements(company.id) AS entitlement
  LEFT JOIN viewer_membership ON TRUE
  LEFT JOIN viewer ON TRUE
  WHERE company.public_company_id = $2
    AND company.status = 'active'
    AND (
      viewer_membership.role IS NOT NULL
      OR viewer.system_role = 'dev'
    )
  LIMIT 1
`;

export async function resolveTenantContext(
  transaction: DatabaseQueryable,
  userId: string,
  publicCompanyId: number,
): Promise<TenantContext> {
  const result = await transaction.query(RESOLVE_TENANT_SQL, [userId, publicCompanyId]);
  const unknownRow = result.rows[0];
  if (unknownRow === undefined) {
    throw new AppError({
      statusCode: 404,
      code: "WORKSPACE_NOT_FOUND",
      message: "The requested workspace was not found.",
    });
  }

  const row = tenantRowSchema.parse(unknownRow);
  return {
    internalCompanyId: row.internal_company_id,
    workspace: mapWorkspaceSummaryRow({
      public_company_id: row.public_company_id,
      name: row.name,
      account_type: row.account_type,
      role: row.role,
      member_no: row.member_no,
      tier: row.tier,
      enabled_modules: row.enabled_modules,
    }),
  };
}
