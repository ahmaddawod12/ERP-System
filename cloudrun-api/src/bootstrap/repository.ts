import {
  CompanyBootstrapSchema,
  SubscriptionStatusSchema,
  TierSchema,
  type CompanyBootstrap,
  type TaxSubmissionMode,
  type WorkspaceSummary,
} from "@smart-job/api-contracts";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const bootstrapRowSchema = z.object({
  jobs_version: z.number().int().nonnegative(),
  documents_version: z.number().int().nonnegative(),
  clients_version: z.number().int().nonnegative(),
  workers_version: z.number().int().nonnegative(),
  company_inventory_version: z.number().int().nonnegative(),
  sync_updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
  subscription_tier: TierSchema.nullable(),
  subscription_status: SubscriptionStatusSchema.nullable(),
  subscription_expires_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  subscription_updated_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  jobs_count: z.number().int().nonnegative(),
  clients_count: z.number().int().nonnegative(),
  inventory_parts_count: z.number().int().nonnegative(),
  documents_count: z.number().int().nonnegative(),
  pending_document_tasks_count: z.number().int().nonnegative(),
}).strict();

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export const READ_BOOTSTRAP_SQL = `
  WITH entitlements AS (
    SELECT module_entitlement.*
    FROM private.get_company_module_entitlements($1::uuid) AS module_entitlement
  )
  SELECT
    COALESCE(sync_state.jobs_version, 0)::integer AS jobs_version,
    COALESCE(sync_state.documents_version, 0)::integer AS documents_version,
    COALESCE(sync_state.clients_version, 0)::integer AS clients_version,
    COALESCE(sync_state.workers_version, 0)::integer AS workers_version,
    COALESCE(sync_state.company_inventory_version, 0)::integer
      AS company_inventory_version,
    COALESCE(sync_state.updated_at, clock_timestamp()) AS sync_updated_at,
    subscription.tier::text AS subscription_tier,
    subscription.status::text AS subscription_status,
    subscription.expires_at AS subscription_expires_at,
    subscription.updated_at AS subscription_updated_at,
    CASE WHEN entitlements.jobs_enabled THEN (
      SELECT count(*)::integer
      FROM public.jobs job
      WHERE job.company_id = $1
    ) ELSE 0 END AS jobs_count,
    CASE WHEN entitlements.clients_enabled THEN (
      SELECT count(*)::integer
      FROM public.clients client
      WHERE client.company_id = $1
        AND client.archived_at IS NULL
    ) ELSE 0 END AS clients_count,
    CASE WHEN entitlements.inventory_enabled THEN (
      SELECT count(*)::integer
      FROM public.inventory_parts inventory_part
      WHERE inventory_part.company_id = $1
        AND inventory_part.active
        AND inventory_part.archived_at IS NULL
    ) ELSE 0 END AS inventory_parts_count,
    CASE
      WHEN $2::text = 'worker' OR NOT entitlements.documents_enabled THEN 0
      ELSE (
      SELECT count(*)::integer
      FROM public.documents document
      WHERE document.company_id = $1
    ) END AS documents_count,
    CASE
      WHEN $2::text = 'worker' OR NOT entitlements.documents_enabled THEN 0
      ELSE (
      SELECT count(*)::integer
      FROM public.document_tasks document_task
      WHERE document_task.company_id = $1
        AND document_task.status IN ('pending', 'queued', 'processing')
    ) END AS pending_document_tasks_count
  FROM entitlements
  LEFT JOIN public.company_sync_state sync_state
    ON sync_state.company_id = $1
  LEFT JOIN public.company_subscriptions subscription
    ON subscription.company_id = $1
`;

export async function readCompanyBootstrap(
  transaction: DatabaseQueryable,
  internalCompanyId: string,
  workspace: WorkspaceSummary,
  taxSubmissionMode: TaxSubmissionMode = "disabled",
): Promise<CompanyBootstrap> {
  const result = await transaction.query(READ_BOOTSTRAP_SQL, [
    internalCompanyId,
    workspace.role,
  ]);
  const row = bootstrapRowSchema.parse(result.rows[0]);
  const subscription = row.subscription_tier !== null
    && row.subscription_status !== null
    && row.subscription_updated_at !== null
    ? {
        tier: row.subscription_tier,
        status: row.subscription_status,
        enabledModules: workspace.enabledModules,
        expiresAt: row.subscription_expires_at === null
          ? null
          : isoTimestamp(row.subscription_expires_at),
        updatedAt: isoTimestamp(row.subscription_updated_at),
      }
    : null;
  return CompanyBootstrapSchema.parse({
    workspace,
    subscription,
    syncState: {
      jobsVersion: row.jobs_version,
      documentsVersion: row.documents_version,
      clientsVersion: row.clients_version,
      workersVersion: row.workers_version,
      companyInventoryVersion: row.company_inventory_version,
      updatedAt: isoTimestamp(row.sync_updated_at),
    },
    counts: {
      jobs: row.jobs_count,
      clients: row.clients_count,
      inventoryParts: row.inventory_parts_count,
      documents: row.documents_count,
      pendingDocumentTasks: row.pending_document_tasks_count,
    },
    capabilities: { taxSubmissionMode },
  });
}
