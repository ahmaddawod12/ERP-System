# Supabase Migration Guide

This guide tracks the active migration shape for the Smart-Job ERP Supabase runtime.

## Current Target

- Supabase Auth is the active identity provider.
- Supabase Edge Functions under `supabase/functions/` are the maintained backend trust boundary.
- PostgreSQL under `packages/db` is the source of truth for company-scoped ERP data.
- The private `smart-job-company-files` bucket owns active job attachments and
  generated documents; GCS remains only for internal monthly archives.
- Firestore remains only for compatibility mirrors, selected operational surfaces, and file-adjacent workflows that have not been retired.

## Migration Rules

- Keep website and mobile request/response contracts stable while moving logic behind Supabase Edge.
- Resolve public `companyId` values to internal company UUIDs before SQL reads or writes.
- Keep sequential IDs allocated through SQL counters.
- Keep protected mutations behind backend handlers; clients must not write ERP tables directly.
- Keep service-role read-model code role-scoped before returning rows.
- Enforce module entitlement (`jobs`, `clients`, `inventory`, `documents`, `workers`) for both mutations and read-model kinds based on `company_subscriptions.enabled_modules`.
- Keep RLS as a second line of defense. Role-sensitive tables such as jobs, memberships, and documents must not rely only on Edge code for scoping.
- Keep privileged RPCs backend-only. Do not grant `anon` or `authenticated` execute access to counter, idempotency, inventory, invite, or read-model RPCs.
- Keep privileged RPC implementations in the private schema. Public RPC names may exist only as service-role compatibility wrappers for Edge code, and must be created with explicit `search_path = ''` and `SECURITY INVOKER` where appropriate.
- Keep count-only read-model paths lightweight. They must not load full inventory, job, document, or client payloads just to render dashboard counts.
- Use SQL batch helpers for inventory movement and job consumption so stock mutations commit or fail atomically.
- Fail closed on missing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `JWT_SECRET` in edge runtime configuration.
- Server maintenance workers use `sb_secret_...` keys only through the
  `apikey` header. Upload cleanup may delete only exact canonical paths returned
  by a leased service-role claim.

## Rollout Checklist

1. Apply the optimized SQL baseline to an empty or intentionally reset database.
2. Apply every journaled forward hardening migration in numeric order from
   `0001` through the current journal tail; never skip an intermediate migration.
3. Configure Supabase Edge secrets from `SETUP.md`; ensure `JWT_SECRET` is set and `SUPABASE_SERVICE_ROLE_KEY` is present.
4. The Edge deploy workflow has been removed. Remaining Edge functions are
   retained for mobile screens not yet cut over to the Cloud API.
5. Verify website and mobile auth flows.
6. Verify read-model role scoping for manager, worker, user, basic, and dev accounts.
7. Verify module entitlement blocks disabled modules for both mutations and read-model kinds.
8. Verify document reads exclude unapproved tax invoices and approved tax invoices cannot be deleted.
9. Verify finished solo jobs consume member inventory through `apply_job_inventory_consumption_batch(...)`.
   Also verify migration `0019` inventory mutations reject cross-tenant and
   non-manager company writes, permit only self-scoped member adjustment,
   reject stale/insufficient concurrent writes, replay exactly once, and
   commit bounded batch picks plus the inventory sync bump together.
   Also verify migration `0021` job update/accept/delete routes reject stale
   versions and cross-tenant/role forgery, replay exactly once, keep direct
   completion out of PATCH, and refuse deletion of jobs with protected
   document, inventory, upload-session, attachment, or certificate state.
10. Verify PDF preview/generate tasks and signed URL flows; verify PDF templates sanitize line-item quantities, prices, and dates.
11. Verify archive retrieval through the backend boundary; verify archive manifests can resume when records are already deleted.
12. Run Supabase Security and Performance Advisors, then run `packages/db/perf/profiling.sql` against staging-size data before adding or dropping indexes.
13. Configure a trusted call to
    `queue_expired_file_upload_cleanup(...)`; verify its bounded skip-locked
    claims delete expired objects while preserving consumed and cross-prefix
    objects. The archiver runs one such batch at startup when configured.
14. Configure a trusted daily operational cleanup call if non-upload operational
    tables grow faster than the archiver schedule.
15. Verify nested function paths deploy with dashed names (e.g., `contact/request` → `contact-request`) and that website/mobile caller URLs match.

## Rollback Notes

Keep compatibility paths available until production traffic proves the Supabase Edge path. Do not delete Firestore mirrors or legacy operational surfaces just because the SQL path exists; retire them only after the corresponding client release and backend workflow no longer read them.
