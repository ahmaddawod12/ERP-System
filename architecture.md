# Architecture

This document describes the current June 22, 2026 Smart-Job ERP architecture. It reflects the active code paths in `website/`, `phone_app/`, `supabase/functions/`, `cloudrun-pdf/`, `cloudrun-archiver/`, `packages/contracts/`, and `packages/db`.

## Executive Summary

The system is hybrid today:

- Supabase Auth is the active identity provider for user sign-in.
- In-repo backend gateway handlers are implemented under `supabase/functions/`.
- PostgreSQL is the primary source of truth for company-scoped ERP entities.
- Firestore remains for selected compatibility reads, operational records, rules-enforced read surfaces, and a few legacy mirrors.
- Cloud Storage is the file layer for documents, attachments, and archives.
- Supabase Edge Functions are the active in-repo backend runtime under hardening, even if rollout may still be staged by environment.

## Runtime Topology

```text
website/mobile
  -> website API proxies or mobile gateway helpers
  -> Supabase Edge HTTP/callable endpoints
  -> SQL access layer / Cloud Run services / Storage / operational Firestore paths
```

## Ownership Map

### Identity and authorization

- Supabase Auth owns sign-in and bearer tokens.
- Backend authorization happens inside gateway handlers and shared edge helpers.
- Shared edge JWT verification must enforce the expected Supabase issuer/audience and reject empty `uid` claims.
- `uid` is the canonical user identity key.
- `companyId` is the canonical tenant scope key.
- Company-scoped access is validated server-side, not inferred from client payloads.
- Backend handlers must normalize incoming/public `companyId` values to internal company UUIDs before SQL reads/writes. Public numeric IDs and internal UUIDs are resolved with separate SQL filters.
- Public job API boundaries use sequential `job_no` values; internal SQL UUIDs are resolved only inside backend handlers.
- Read-model job cursors remain based on the internal stable tuple `(created_at, jobs.id)` even when item payloads expose public sequential job IDs.
- Module entitlement (`jobs`, `clients`, `inventory`, `documents`, `workers`) is enforced for both mutations and read-model kinds based on `company_subscriptions.enabled_modules`.

### SQL-owned runtime data

These are the primary company-scoped ERP entities and should be treated as SQL-owned:

- Users and profiles: `app_users`
- Companies and subscriptions: `companies`, `company_profiles`, `company_subscriptions`
- Memberships and counters: `company_memberships`, `company_counters`
- Sync state: `company_sync_state`
- Clients: `clients`
- Jobs and job attachments/usages: `jobs`, `job_attachments`, `job_part_usages`
- Inventory: `inventory_locations`, `inventory_parts`, `inventory_balances`, `inventory_movements`
- Documents and links: `documents`, `document_items`, `document_job_links`, `proposal_usage`
- Document tasks: `document_tasks` (preview tasks write `preview_url`; generate tasks write `generate_url`)
- Tax flows: `tax_invoice_reservations`, `tax_invoice_idempotency`, `tax_authority_tokens`, `tax_oauth_sessions`, `tax_oauth_callbacks`
- Invites: `company_invites`
- Support: `support_conversations`, `support_messages`
- Operational SQL tables: `notification_deliveries`, `rate_limit_buckets`, `archive_runs`, `auditLogs`, `orphanedUserCleanupMarkers`, `system_counters`
- SQL helper functions: counters/rate limits, invite and tax idempotency, inventory movement, batch picks, finished-job inventory consumption, client/inventory paged reads, lightweight inventory counts, cleanup, sync-version bumps, atomic job creation, and atomic business registration are backend-only RPCs.
- Privileged RPC implementations live in the `private` schema with `SECURITY DEFINER`; public RPC names are thin `SECURITY INVOKER` wrappers granted to the `service_role` only.

### Firestore-owned operational and compatibility data

Firestore is not the primary business database anymore, but it still matters for these areas:

- `system/data/comid`: company ID allocation
- `system/orphaned_users/pending/{uid}`: failed orphaned-auth cleanup markers
- `companies/{companyId}/documentLocks/{lockType}`: document generation coordination
- `users/{uid}/data/profile`: compatibility profile mirror
- `users/{uid}/data/cache`: compatibility cache/version state
- `users/{uid}/data/inventory`: remaining personal inventory surface
- `companies/{companyId}/data/*`: compatibility mirrors for business info, subscription, cache, and single-doc inventory
- `companies/{companyId}/workers/{wid}` and `companies/{companyId}/managers/{mid}`: read-focused membership mirrors
- `documentTasks/{taskId}`: legacy task mirror path
- Historical admin collections such as `notificationLog/{logId}`, `taxAuthPending/{authId}`, and `taxAuthCallbacks/{authId}`

### Cloud Storage ownership

Cloud Storage is the canonical file layer for:

- Generated PDFs
- Job photos and signatures
- Archived month payloads

Persist only canonical `storagePath` references in records. Do not persist durable public or bearer download URLs on job or document records.

## Active Request Flows

### Website

- Public pages and auth pages run in Next.js.
- Server routes verify Supabase tokens and issue signed HttpOnly `__session` cookies.
- Website server proxy auth uses a split-cookie transport: `__session` stores signed session metadata and a separate HttpOnly `__session_access` cookie stores the current bearer token for server-side Edge proxy calls.
- Protected web actions go through API proxy routes, then into backend functions.
- Website read-model calls are kind-based and must remain contract-compatible with backend `read-model` kinds. Service-role read-model code must enforce the runtime role matrix before returning rows.
- Client and inventory read-model pages are served by SQL RPCs so search and cursor filters execute in the database while preserving website response shapes.

### Mobile

- The Expo app stores Supabase transport tokens in Expo SecureStore-backed auth helpers.
- Protected operations go through backend HTTP/gateway helpers.
- Mobile read-model calls are kind-based and share the same backend contract as website.
- Read-model clients and inventory endpoints preserve their existing default payloads, with optional cursor pagination/search for large tenants.
- Client and inventory page helpers use the same SQL RPC-backed read-model contract as website callers.
- Mobile MMKV cache/draft/outbox keys must stay scoped by active `uid` / `companyId`.
- Mobile Supabase access and refresh tokens are stored in Expo SecureStore, not MMKV.
- Mobile cache refresh must drain paginated jobs/documents reads for the active 90-day cache window instead of assuming page one is complete.
- Mobile cache refresh must preserve the existing role-scoped jobs cache when only document versions change.
- Mobile debug logging uses the dev-only logger wrapper for noisy cache/read-model output.
- Archived month reads go through backend `fetchArchiveMonthV1`; clients do not read protected archive objects directly.
- Finished solo jobs upload attachments to company-scoped storage first and pass `attachmentUploadId` into `createJobV1` until the final public job number exists.
- Push notification listeners and token registration attach only after authenticated cache bootstrap succeeds for the active mobile session.
- Mobile does not own business registration.

### Backend mutations and reads

- Supabase edge gateways remain the trust boundary for company-scoped writes.
- Edge handlers perform authorization, validation, rate limiting, and side-effect control.
- Edge handlers read/write SQL for primary ERP entities and use Firestore only where compatibility or operations still require it.

### Document generation

- Gateway handlers publish preview/generate work.
- Edge handlers enrich preview/generate payloads with company data, create SQL draft document rows for generate flows, and dispatch trusted work to `cloudrun-pdf`.
- `cloudrun-pdf` validates requester identity, accepts trusted dispatch bearer auth from either Google OIDC or the configured edge service account, renders PDF output, stores files, and finalizes task/document state.
- New generated artifacts must keep create-only semantics and orphan cleanup on finalize failure.
- Generate flows must not overwrite an existing finalized PDF or existing SQL `storage_path`, regardless of document type.

### Archiving

- `cloudrun-archiver` batches old finished jobs/documents into month archives.
- Archive export must drain paginated SQL reads; it cannot assume one page contains a full month.
- Archive payload generation should stream JSON to disk/storage rather than holding the full month in memory.
- Archive deletion must use the exact verified document ID list, not a rerun query.
- Archive manifests remain resumable: `uploaded_not_deleted` retries verify the archive and can be marked `deleted` when the records are already gone, instead of failing on exact-count mismatches.
- Archive retrieval stays backend-controlled; callers provide `(companyId, year, month, dataType)` and receive JSON payloads from the edge runtime.

## Canonical Rules

### Identity

- Always use `uid` for user scope.
- Always use `companyId` for tenant scope.
- Never derive identifiers from email.
- Canonical stored account types are only `solo` and `business`.

### Counter allocation

- Allocate sequential business IDs through SQL counters (`system_counters`, `company_counters`).
- Do not use `MAX + 1` query patterns for `public_company_id`, `member_no`, `client_no`, or `job_no`.
- Apply the same SQL counter rule to tax invoice numbering (`doc_305`) and company inventory part numbering (`part_no`).
- SQL helper RPCs that mutate counters, rate limits, inventory, invites, tax idempotency, or sync versions are backend-only and should not be exposed to anonymous or authenticated client roles.
- Service-role read RPCs for clients and inventory are also backend-only; website/mobile callers reach them through the read-model gateway.
- Privileged RPC implementations live in the private schema; public RPC names are service-role-only compatibility wrappers for Edge Functions.
- Count-only dashboard/bootstrap reads use SQL count helpers instead of loading full inventories or collections.
- Module entitlement is checked before returning read-model rows for `jobs`, `clients`, `inventory`, `documents`, and `workers`.

### Jobs

- Valid statuses are `pending`, `waiting`, `finished`, `denied`.
- Use short canonical job fields: `wid`, `wname`, `mid`, `mname`, `cid`, `cname`, `cphone`.
- Job APIs should expose public sequential IDs (`id`, `jobId`, `wid`, `mid`) at the client boundary, not internal membership/job UUIDs.
- Job part usage payloads should expose public inventory part numbers, not internal inventory UUIDs.
- Job attachments persist canonical refs such as `{ storagePath, kind }`.
- Handlers may accept temporary attachment upload IDs before the final job number exists, but persisted attachment refs must normalize back to canonical company/job storage paths.

### Documents

- Document types and suffixes come from `@smart-job/contracts` (`DOC_SUFFIX`, `DocTypeCode`).
- `deno.json` maps `@smart-job/contracts` to `./packages/contracts/index.ts` for Deno consumers.
- Non-tax document IDs use the canonical suffix plus number pattern.
- Tax flows require server-side validation and idempotency.

### Writes and side effects

- Protected writes to locked business collections stay backend-only.
- Rate limiting, deduplication, and idempotency must happen before push/email/Pub/Sub side effects.
- Firestore transactions must read before they write.
- Inventory mutations must fail on negative resulting balances; they must not silently clamp stock underflow to zero.
- Inventory movement mutations should be applied atomically through SQL helpers such as `apply_inventory_movement(...)` rather than client-visible read-modify-write sequences.
- Multi-part inventory picks should use `apply_inventory_pick_batch(...)` so all movements commit or roll back together.
- Finished-job inventory consumption should use `apply_job_inventory_consumption_batch(...)` so all part deductions commit or roll back together.

### Performance and profiling

- Use `packages/db/perf/profiling.sql` against local/staging data before broad index changes.
- Treat Supabase advisors and `EXPLAIN (analyze, buffers)` output as the source of truth for adding or removing indexes beyond the optimized baseline.

## Migration Direction

The current migration target is:

1. Keep client contracts stable.
2. Extract reusable backend handlers under `supabase/handlers/`.
3. Re-host HTTP endpoints on Supabase Edge Functions.
4. Preserve SQL ownership, Cloud Storage semantics, tax flows, and operational guarantees during the runtime cutover.

Legacy Firebase backend paths may still exist outside this repository, but code changes in this workspace should target `supabase/functions/` and `supabase/handlers/`.
