# Architecture

This document describes the current July 13, 2026 Smart-Job ERP architecture
and its in-progress pre-launch migration. It distinguishes active code paths
from foundations that are not yet serving application traffic.

## Executive Summary

The system is hybrid today:

- Supabase Auth is the active identity provider for user sign-in.
- In-repo backend gateway handlers are implemented under `supabase/functions/`.
- PostgreSQL is the primary source of truth for company-scoped ERP entities.
- Firestore remains for selected compatibility reads, operational records, rules-enforced read surfaces, and a few legacy mirrors.
- The private Supabase `smart-job-company-files` bucket owns the migrated job
  attachment and PDF/preview/branding paths; GCS remains for monthly archives,
  and unported legacy file paths still coexist during cutover.
- Supabase Edge Functions are the active in-repo backend runtime under hardening, even if rollout may still be staged by environment.
- `packages/api-contracts`, `cloudrun-api`, and `cloudrun-tax` provide the
  shared HTTP contract and Fastify foundations for the planned Cloud Run
  backend. `cloudrun-api` now includes dual authentication, opaque website
  sessions, viewer/workspace/bootstrap, bounded jobs/clients/inventory reads,
  idempotent client create/update/delete-or-archive, atomic job
  create/complete, versioned job update/accept/delete, attachment upload
  sessions, first-workspace
  registration, push-token mutations, and invitation create/redeem. It is not
  receiving production traffic; `cloudrun-tax` remains a stateless shell.

## Runtime Topology

```text
website/mobile
  -> website API proxies or mobile gateway helpers
  -> Supabase Edge HTTP/callable endpoints
  -> SQL access layer / Cloud Run services / Storage / operational Firestore paths
```

The approved target topology is:

```text
Next.js on Vercel --server-only session/BFF--> cloudrun-api --> Supabase Postgres/Auth/Storage
Expo iOS/Android --------Supabase bearer------^       |----> cloudrun-pdf
                                                       `----IAM----> cloudrun-tax (me-west1)
```

The second topology is partially implemented but is not the global production
routing path. Migrations `0006`–`0021` support the staged API, private file/PDF
flow, cleanup, registration, push, invitation, client/inventory/worker mutation,
and versioned job-mutation slices. The remaining domain
routes,
legacy-file and frontend cutovers, tax work, new API/tax Dockerfiles,
deployment/IAM, custom API DNS mapping, and legacy deletion are now implemented.
The Cloud Run deploy workflow maps a custom API domain in production via
`API_CUSTOM_DOMAIN`. Staging uses generated `run.app` URLs.
approval gates.

## Ownership Map

### Identity and authorization

- Supabase Auth owns sign-in and bearer tokens.
- Backend authorization happens inside gateway handlers and shared edge helpers.
- Shared edge JWT verification must enforce the expected Supabase issuer/audience and reject empty `uid` claims.
- `uid` is the canonical user identity key.
- `companyId` is the canonical tenant scope key.
- Company-scoped access is validated server-side, not inferred from client payloads.
- Main-API transactions use the least-privileged `smart_job_api` role and
  begin with `private.set_api_request_context(...)`; the runtime password is
  provisioned out of band and is never stored in schema migrations.
- Initial main-API domain routes accept exactly one verified Supabase Bearer JWT
  or one opaque `SmartJobSession`. The latter resolves under a row lock and
  never exposes stored Supabase access/refresh credentials outside the session
  service.
- New Auth/mobile code uses publishable (`sb_publishable_...`) keys. Only the
  trusted API/PDF/archiver Storage paths receive secret (`sb_secret_...`) keys;
  no secret or legacy service-role key may enter browser/mobile configuration.
  Legacy anon/service-role variables remain only for the pre-cutover Edge flow.
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
- API operational state: `private.web_sessions`, `private.api_idempotency`, and
  `private.file_upload_sessions`
- Inventory: `inventory_locations`, `inventory_parts`, `inventory_balances`, `inventory_movements`
- Documents and links: `documents`, `document_items`, `document_job_links`, `proposal_usage`
- Document tasks: `document_tasks` (preview tasks write `preview_url`; generate tasks write `generate_url`)
- Tax flows: `tax_invoice_reservations`, `tax_invoice_idempotency`, `tax_authority_tokens`, `tax_oauth_sessions`, `tax_oauth_callbacks`
- Invites: `company_invites`
- Support: `support_conversations`, `support_messages`
- Operational SQL tables: `notification_deliveries`, `rate_limit_buckets`, `archive_runs`, `auditLogs`, `orphanedUserCleanupMarkers`, `system_counters`
- SQL helper functions: counters/rate limits, invite and tax idempotency,
  inventory movement, batch picks, finished-job inventory consumption,
  client/inventory paged reads, lightweight counts, bounded upload cleanup,
  sync-version bumps, legacy and API job creation/registration, and self-scoped
  push-token writes are backend-only RPCs.
- Privileged RPC implementations live in the `private` schema with `SECURITY DEFINER`; public RPC names are thin `SECURITY INVOKER` wrappers granted to the `service_role` only.
- Jobs carry an opaque `entity_version`; API completion calls use
  `private.complete_job_with_details(...)` to validate the expected version and
  atomically commit status, parts, inventory, uploads, attachments, and sync
  version changes.
- Job metadata/client/assignee updates, manager acceptance, and guarded
  deletion use the private functions in migration `0021`. Each re-derives the
  authenticated membership, jobs entitlement, role, assignment, and expected
  entity version in SQL; only the three transaction functions are executable
  by `smart_job_api`.

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

### File storage ownership

The private Supabase bucket `smart-job-company-files` is the canonical target
and is implemented for generated PDFs, previews, company-branding reads, and
the new job photo/signature upload-session flow. Object paths start with the
internal company UUID. Google Cloud Storage is retained for internal monthly
archive payloads. Some older Firebase/Edge file call sites still exist and must
be removed only as their owning feature slices are cut over.

Upload-session creation is claim-idempotent: the API claim UUID is also the
session UUID, so a retry cannot allocate a second prefix. Postgres serializes a
four-active-session quota per user/workspace and persists a 12-per-ten-minute
per-user limiter. Successful replays mint fresh short-lived Storage URLs; URLs
are not stored in `private.api_idempotency`. Three initial signing failures move
the still-unconsumed manifest to the existing bounded cleanup queue.

Persist only canonical `storagePath` references in records. Do not persist durable public or bearer download URLs on job or document records.

## Active Request Flows

### Website

- Public pages and auth pages run in Next.js.
- Server routes verify Supabase tokens and issue signed HttpOnly `__session` cookies.
- Website server proxy auth uses a split-cookie transport: `__session` stores signed session metadata and a separate HttpOnly `__session_access` cookie stores the current bearer token for server-side Edge proxy calls.
- Protected web actions go through API proxy routes, then into backend functions.
- Website read-model calls are kind-based and must remain contract-compatible with backend `read-model` kinds. Service-role read-model code must enforce the runtime role matrix before returning rows.
- Client and inventory read-model pages are served by SQL RPCs so search and cursor filters execute in the database while preserving website response shapes.
- The Cloud Run website path now serves `/app/select-company` plus the
  explicit-tenant overview, jobs, clients, and inventory pages under
  `/app/c/{companyId}`. A server-only transport validates canonical envelopes;
  the Server Component DAL resolves the viewer, rejects forged tenant URLs, and
  fetches bounded SQL-filtered pages before hydration.
- The clients page keeps its initial directory server-rendered while focused
  browser islands send create/update/delete-or-archive only to tenant-scoped
  same-origin BFF routes. Those handlers require exact Origin, double-submit
  CSRF, opaque sessions, idempotency keys, and optimistic entity versions before
  forwarding server-to-server with `SmartJobSession`.
- The inventory page follows the same split: its bounded first page stays in a
  Server Component, while manager/dev create/update/archive/company-adjust
  controls call only exact-Origin, double-submit-CSRF BFF routes. The BFF
  forwards the opaque session and retry-stable idempotency key and preserves
  independent part and stock entity versions before refreshing the tenant page.
- Same-origin login/session/logout and business-registration BFF routes use the
  opaque Postgres-backed session. Production stores only
  `__Host-sj_web_session` as HttpOnly plus readable `sj_csrf`; mutations require
  the matching `X-SJ-CSRF` header and exact `WEBSITE_ORIGIN`.
- The root `/app` and remaining feature routes have not all moved to the opaque
  path, so the legacy split-cookie/Edge flow still coexists.

### Mobile

- The Expo app stores Supabase transport tokens through a SecureStore adapter,
  uses single-flight refresh, and starts/stops refresh with AppState.
- Root provider order establishes session → tenant → React Query → encrypted
  outbox → notifications before routing. Protected mounting is gated until
  session/tenant restoration; the code has not yet moved every route into final
  Expo Router `(auth)`/`(protected)` groups.
- The assigned jobs list uses the bounded Cloud API jobs endpoint with query
  keys that include `uid` and `companyId`; remaining operations still use
  kind-based Edge/gateway helpers during migration.
- Client Book uses active-only bounded Cloud API pages and Cloud API mutations.
  Create/update/delete-or-archive carry stable idempotency keys and opaque
  entity versions, then invalidate only the current `uid`/`companyId` client
  queries. The compatibility cache client actions use the same API and perform
  no Edge callable or Firebase data writes.
- Inventory screens use the authenticated main API for company part creation/
  updates and self-scoped member adjustments. Manager/dev owns company writes,
  user company views are read-only, workers send only `/inventory/me` writes,
  and retry-stable Expo Crypto UUID keys plus opaque part/stock versions protect
  every operation. Tenant-scoped invalidation refreshes successful writes while
  stale query pages remain visible on transport failures.
- MMKV still backs preferences, legacy caches/drafts, and bounded encrypted
  query snapshots during migration. Supabase tokens and SQLCipher/file keys
  remain in SecureStore, and the durable field outbox is not stored in MMKV.
- Mobile cache refresh must drain paginated jobs/documents reads for the active 90-day cache window instead of assuming page one is complete.
- Mobile cache refresh must preserve the existing role-scoped jobs cache when only document versions change.
- Mobile debug logging uses the dev-only logger wrapper for noisy cache/read-model output.
- Archived month reads go through backend `fetchArchiveMonthV1`; clients do not read protected archive objects directly.
- Offline v1 supports only `job.create_finished` and `job.complete_assigned`.
  One SQLCipher database is opened per uid with its key in SecureStore. Staged
  app-owned photos/signatures are AES-256-GCM chunk-encrypted, SHA-256 hashed,
  and uploaded through private API sessions before atomic job reconciliation.
- Outbox synchronization occurs only on app start, foreground, and connectivity
  restoration. Logout closes the database without deleting pending work; only
  the same authenticated uid can resume it.
- Each attempted operation exposes a truthful reconciled/queued/retry/conflict/
  terminal outcome. Pending Work provides manual retry and explicit discard;
  staged files remain until confirmed reconciliation or that explicit discard.
- Push notification listeners attach after authenticated bootstrap, and token
  register/clear uses the self-scoped main-API route with a SecureStore-only
  per-installation device ID rather than an MMKV cache. Display/open handling
  rejects payloads whose uid or current accessible company does not match.
- Pinned `react-native-notify-kit` `10.4.8` owns local notification APIs.
  Firebase Messaging remains the remote push transport, and NotifyKit's iOS
  remote handling stays disabled to avoid duplicate callback ownership. Android
  uses a newly versioned private channel instead of the legacy public channel.
- Mobile does not own business registration.

### Backend mutations and reads

- Supabase edge gateways remain the active trust boundary for legacy and
  not-yet-ported company-scoped writes.
- Edge handlers perform authorization, validation, rate limiting, and side-effect control.
- Edge handlers read/write SQL for primary ERP entities and use Firestore only where compatibility or operations still require it.
- The staged Cloud Run API is already the trust boundary for its implemented
  local/test slices: viewer/workspace/bootstrap, bounded jobs/clients/inventory
  reads, job attachment sessions and atomic create/complete, first-workspace
  registration, push tokens, and opaque sessions. It authorizes from SQL
  memberships and never proxies those operations through Edge.

### Document generation

- Gateway handlers publish preview/generate work.
- Edge handlers enrich preview/generate payloads with company data, create SQL draft document rows for generate flows, and dispatch trusted work to `cloudrun-pdf`.
- `cloudrun-pdf` validates requester identity, accepts trusted dispatch bearer auth from either Google OIDC or the configured edge service account, renders PDF output, writes through a server-only Supabase secret key, and finalizes task/document state.
- New generated artifacts keep create-only semantics. A retry may reuse an existing object only after its size, MIME type, and SHA-256 bytes match. Objects are retained across ambiguous SQL/signing failures so a committed finalization can never point at a compensating-deleted file; operational cleanup handles confirmed orphans.
- Generate flows must not overwrite an existing finalized PDF or existing SQL `storage_path`, regardless of document type.
- Document finalization and its `documents_version` bump commit in one SQL transaction.

### Archiving

- At startup, `cloudrun-archiver` invokes service-role-only upload-cleanup RPCs:
  operational expiry queueing runs first, a capped batch is claimed with
  `FOR UPDATE SKIP LOCKED` leases, and each claim is completed or requeued with
  a five-attempt bound.
- The cleanup worker receives only the canonical bucket, session id, and exact
  manifest object paths. It rejects alternate origins/buckets, cross-prefix
  paths, and consumed/finalized sessions; there is no recursive deletion or
  generated-PDF reconciliation in this path.
- Cleanup uses the opaque Supabase secret only in the `apikey` header. A cleanup
  outage is reported independently and does not stop the monthly archive phase.
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
- Migration `0019` makes part metadata and each location balance independently
  versioned. Manager/dev owns company create/update/archive/adjust/transfer/
  pick while member adjustment is self-scoped; public targets use `memberNo`,
  picks contain at most 100 unique parts, and `smart_job_api` reaches these
  writes only through narrow atomic RPCs.
- Finished-job inventory consumption should use `apply_job_inventory_consumption_batch(...)` so all part deductions commit or roll back together.

### Performance and profiling

- Use `packages/db/perf/profiling.sql` against local/staging data before broad index changes.
- Treat Supabase advisors and `EXPLAIN (analyze, buffers)` output as the source of truth for adding or removing indexes beyond the optimized baseline.

### Local database topology

The repository's Docker Desktop stack is isolated by Supabase project ID
`smart-job-erp-local`. Its primary endpoints are API `55321`, PostgreSQL
`55322`, Studio `55323`, Inbucket `55324`, and Edge inspector `55883`.
`supabase/config.toml` owns service startup, while application migrations remain
owned by `packages/db/migrations` and Drizzle.

## Migration Direction

The current migration target is:

1. Keep client contracts stable while Edge remains the active gateway.
2. Build the Cloud Run main API directly against the approved Postgres security
   foundation, using Edge behavior only as characterization reference.
3. Move website traffic through the Next.js server-only BFF and mobile traffic
   through Supabase bearer-authenticated API calls after domain parity exists.
4. Migrate active application files to private Supabase Storage while retaining
   GCS only for internal monthly archives.
5. Preserve tax, PDF, idempotency, tenancy, and concurrency guarantees during
   cutover, then remove compatibility infrastructure only after explicit final
   approval.

The shared contracts and database/security migrations through `0021`,
including the versioned inventory foundation in `0019`, initial
main-API domain routes, private job/PDF Storage flow, explicit-tenant website
login/onboarding plus overview/jobs/clients/inventory SSR slices, tenant-scoped
mobile job/client/inventory reads, and the two-operation encrypted mobile field
outbox are implemented locally. Domain parity and global frontend cutover
are not complete. Tax behavior, remaining file and feature routes, new API/tax
Docker/deployment/IAM, custom API DNS, and legacy Edge/Firebase cleanup are
implemented. Firebase config files and the Edge deploy workflow have been
removed. Remaining mobile Edge caller cutover is the final step.
outstanding approval gates.
