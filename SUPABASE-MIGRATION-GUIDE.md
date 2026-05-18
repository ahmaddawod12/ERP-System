# Supabase Migration Guide

This guide tracks the active migration shape for the Smart-Job ERP Supabase runtime.

## Current Target

- Supabase Auth is the active identity provider.
- Supabase Edge Functions under `supabase/functions/` are the maintained backend trust boundary.
- PostgreSQL under `packages/db` is the source of truth for company-scoped ERP data.
- Firestore remains only for compatibility mirrors, selected operational surfaces, and file-adjacent workflows that have not been retired.

## Migration Rules

- Keep website and mobile request/response contracts stable while moving logic behind Supabase Edge.
- Resolve public `companyId` values to internal company UUIDs before SQL reads or writes.
- Keep sequential IDs allocated through SQL counters.
- Keep protected mutations behind backend handlers; clients must not write ERP tables directly.
- Keep service-role read-model code role-scoped before returning rows.
- Keep RLS as a second line of defense. Role-sensitive tables such as jobs, memberships, and documents must not rely only on Edge code for scoping.
- Keep privileged RPCs backend-only. Do not grant `anon` or `authenticated` execute access to counter, idempotency, inventory, invite, or read-model RPCs.
- Keep privileged RPC implementations in the private schema. Public RPC names may exist only as service-role compatibility wrappers for Edge code.
- Keep count-only read-model paths lightweight. They must not load full inventory, job, document, or client payloads just to render dashboard counts.
- Use SQL batch helpers for inventory movement and job consumption so stock mutations commit or fail atomically.

## Rollout Checklist

1. Apply the optimized SQL baseline to an empty or intentionally reset database.
2. Configure Supabase Edge secrets from `SETUP.md`.
3. Deploy Edge functions manually through `.github/workflows/supabase-edge-deploy.yml`.
4. Verify website and mobile auth flows.
5. Verify read-model role scoping for manager, worker, user, basic, and dev accounts.
6. Verify document reads exclude unapproved tax invoices.
7. Verify finished solo jobs consume member inventory through `apply_job_inventory_consumption_batch(...)`.
8. Verify PDF preview/generate tasks and signed URL flows.
9. Verify archive retrieval through the backend boundary.
10. Run Supabase Security and Performance Advisors, then run `packages/db/perf/profiling.sql` against staging-size data before adding or dropping indexes.
11. Configure a trusted daily call to `cleanup_expired_operational_rows()` if operational tables are growing.

## Rollback Notes

Keep compatibility paths available until production traffic proves the Supabase Edge path. Do not delete Firestore mirrors or legacy operational surfaces just because the SQL path exists; retire them only after the corresponding client release and backend workflow no longer read them.
