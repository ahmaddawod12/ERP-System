# Supabase Backend Workspace

Status: Active backend gateway surface (May 15, 2026)

This directory is where backend runtime work happens in this repository.

## What Lives Here

- `functions/`: HTTP entrypoints (gateway and domain endpoints)
- `handlers/`: extracted domain logic
- `shared-edge-helpers.ts`: auth, request parsing, validation, response helpers

## Active Entrypoints

- `functions/mutation-gateway/`
- `functions/mutation-gateway-me-west1/`
- `functions/read-model/`

## Read-Model Contract

`functions/read-model/` is kind-based and must stay aligned with website/mobile requests.

Job-specific contract notes:

- `jobs` and `recordById` return public sequential job IDs and public member numbers (`wid`, `mid`) at the client boundary.
- `jobs` must enforce service-role read scoping in code: `basic` sees no jobs, `worker` and business `user` see only jobs assigned to their active membership, and `manager` / solo `user` / `dev` may read company jobs.
- `documents` must return no rows for `worker`; `manager`, `user`, `basic`, and `dev` may read company documents.
- `workers` lists are manager/dev only; other roles receive an empty list.
- `jobs` and `documents` support `pageSize`, `limit`, `afterCursor`, `status`, date filters, and stable timestamp-plus-id cursor tokens. `documents` also supports `documentType` and `createdByUid`.
- `bootstrap` returns first-page `jobsNextCursor` and `documentsNextCursor`; clients must not assume a `null` cursor means the collection was fully fetched unless the first page exhausted.
- `clients` and `inventory` preserve legacy response shapes while using SQL RPC-backed pagination/search (`get_clients_page`, `get_company_inventory_page`, `get_member_inventory_page`).
- Job part usage payloads must also expose public inventory part numbers, not internal inventory UUIDs.
- `createJobV1` / `updateJobV1` must preserve job meta and attachment fields used by website/mobile, including `timeFrom`, `timeTo`, `travelDistance`, `signingPerson`, `photos`, `signature`, and `partsUsed`.
- `createJobV1` may receive a temporary `attachmentUploadId` before the final public job number exists; handlers must validate that temp upload reference and normalize persisted attachment refs back to canonical company/job storage paths.
- Handlers may still accept legacy UUID job identifiers internally during transition, but should normalize back to the public sequential job ID in responses.

Supported `kind` values:

- `bootstrap`
- `workers`
- `clients`
- `jobs`
- `documents`
- `inventory`
- `companySyncState`
- `recordById`
- `documentTask`
- `userSyncState`

## Local Development

Run these from the repository root:

```bash
supabase start
deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
supabase functions serve mutation-gateway --env-file supabase/.env
supabase functions serve mutation-gateway-me-west1 --env-file supabase/.env
supabase functions serve read-model --env-file supabase/.env
```

Notes:

- Do not use `--no-verify-jwt` in shared or production environments.
- Shared edge JWT verification should enforce the configured Supabase issuer/audience and reject empty `uid` claims.
- Keep `CORS_ALLOWED_ORIGINS` explicitly configured; empty origin lists fail closed.

Smoke test:

```bash
curl -X POST http://localhost:54321/functions/v1/mutation-gateway \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"operation":"updateProfileV1","payload":{"displayName":"Test"}}'
```

## Working Rules

- Keep operation contracts stable.
- Keep role and company checks explicit.
- Remember that edge read-model handlers use the service role for database access; every list query must apply its own tenant and role filters before data is returned.
- Normalize incoming/public `companyId` values to internal company UUIDs before SQL filters; resolve public numeric IDs and internal UUIDs with separate query paths.
- Normalize public job identifiers to internal rows inside handlers, but do not expose internal job or membership UUIDs back to clients.
- Return the public membership number as `wid` from invite join flows; do not leak internal membership UUIDs.
- Use canonical field names and enums from `@smart-job/contracts`.
- Import shared constants (e.g., `DOC_SUFFIX`, `DocTypeCode`, `Role`, `JobStatus`) from `@smart-job/contracts` via the `deno.json` import map instead of re-declaring them locally.
- When resolving multiple membership rows for the same company, batch the lookup with a single `.in("id", [...])` query rather than one query per row.
- Parallelize independent DB lookups with `Promise.all` instead of sequential `await` calls where the results are not interdependent.
- Resolve and validate dependent data before destructive writes so failures leave previous state intact rather than leaving rows in a partial state.
- Treat `packages/db` as the SQL source of truth.
- Preserve backend-only write boundaries.
- Preserve idempotency and deduplication before side effects.
- Use SQL-backed counter allocation helpers for sequential IDs (`public_company_id`, `member_no`, `client_no`, `job_no`).
- Do not use `MAX + 1` allocation patterns in concurrent mutation paths.
- Use SQL-side atomic inventory helpers such as `apply_inventory_movement(...)` for movement writes and preserve the split uniqueness rules for company-only vs membership-scoped inventory locations.
- Use `apply_inventory_pick_batch(...)` for multi-part picks so movement rows and balance updates commit or fail together.
- Use `apply_job_inventory_consumption_batch(...)` for finished-job part consumption so member stock deductions are atomic.
- Privileged SQL implementations must live in the private schema. Public RPC names are compatibility wrappers for service-role Edge callers, not direct client APIs.
- `bootstrap` count-only reads must use lightweight count helpers and must not fetch full inventory or collection payloads.
- Keep `packages/db/perf/profiling.sql` as the first stop for database performance work; do not add broad indexes without advisor/`EXPLAIN` evidence.
- Use `cleanup_expired_operational_rows()` from a trusted schedule to trim expired rate-limit, task, notification, contact, and failed idempotency rows.

## Environment Essentials

Required in local or deployed environments:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `CLOUD_RUN_PDF_SERVICE_URL`
- `ARCHIVE_BUCKET`

Required for trusted edge-to-Cloud-Run document dispatch:

- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`
- `PUBSUB_VERIFICATION_TOKEN` when `cloudrun-pdf` shared-token verification is enabled

Dispatch notes:

- Edge dispatch signs a short-lived service-account JWT for `CLOUD_RUN_PDF_SERVICE_URL` when direct Google ID-token minting is unavailable in the edge runtime.
- `cloudrun-pdf` must trust that signer through `PUBSUB_ALLOWED_SERVICE_ACCOUNTS` and should keep the shared `x-pubsub-token` layer enabled in production.

Required for backend archive retrieval:

- `ARCHIVE_BUCKET`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`

Domain-specific vars such as tax credentials and callback URLs should match `SETUP.md`.

## Suggested Workflow

1. Implement operation logic under `handlers/`.
2. Wire operation in gateway dispatcher.
3. Validate payload rules and auth behavior.
4. Run tests and targeted smoke checks.
5. Verify no schema drift or contract drift.

## Related Docs

- `../SUPABASE-MIGRATION-GUIDE.md`
- `../backend.md`
- `../architecture.md`
- `../SETUP.md`
