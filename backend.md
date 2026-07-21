# Backend

This document summarizes the active backend boundaries as of July 21, 2026.

## Current Backend Reality

- The Cloud Run API (`cloudrun-api`) is the sole backend trust boundary for
  website and mobile clients. All Supabase Edge functions and handlers have
  been deleted.
- Supabase Auth is the active bearer-token provider.
- SQL is the primary persistence layer for company-scoped ERP data.
- Supabase Storage (private `smart-job-company-files` bucket) owns active job
  attachments and generated documents; GCS remains only for internal monthly
  archives.
- Firebase Messaging and Crashlytics remain for mobile push notifications and
  native crash reporting; Firebase Storage, Firestore, and App Check have been
  removed.
- `cloudrun-api` includes tested Postgres, Supabase JWT, opaque-session,
  bounded domain routes, durable document/email dispatch, authoritative tax
  submission, and archive content retrieval. `cloudrun-tax`, `cloudrun-pdf`,
  and `cloudrun-email` implement the worker boundaries. Tax stays disabled
  pending certification.

The approved migration chain now runs through `0032`. Migrations `0006`–`0032`
add least-privileged API and worker roles, request context, private
session/idempotency/upload/workflow state, atomic domain mutations,
transactional accepted-job inventory consumption, canonical PDF/email claims,
and the authoritative tax transaction/outbox, leased immutable archives,
exact API readiness, and normalized trigram search.

## Service Boundaries

### cloudrun-api/

This is the staged Node 22 modular API boundary. Its current implementation owns:

- strict environment validation and a 12-second request timeout ceiling
- shared `@smart-job/api-contracts` envelopes and runtime schemas
- request IDs, structured logs, OpenAPI/Zod wiring, and safe error responses
- liveness/readiness probes and `private, no-store` headers for `/api/v1`
- a `smart_job_api`-only Postgres pool whose authenticated transactions call
  `private.set_api_request_context(...)`
- exact Supabase issuer/audience/JWKS verification for mobile Bearer tokens
- verified-email-only opaque website sessions with encrypted rotating Auth
  credentials, row-locked refresh, revocation, and a 12-hour absolute expiry
- one strict domain authenticator that accepts either Bearer or
  `SmartJobSession`, never combined/ambiguous credentials
- `GET /api/v1/me`, `GET /api/v1/workspaces`, lightweight company bootstrap,
  and the web-session lifecycle
- SQL-filtered, bounded `GET` routes for jobs, clients, company inventory, and
  the authenticated member's inventory, all with opaque `(createdAt, id)`
  cursors and role/module/tenant enforcement
- verified, idempotent client create/update/delete routes through migration
  `0018`; default reads exclude archived rows, updates are version checked,
  sequential client numbers use the company counter, and DELETE archives
  referenced clients instead of orphaning job or document history
- verified, idempotent inventory part create/update/archive, company/self
  adjustment, single transfer, and bounded batch-pick routes through migration
  `0019`. SQL derives entitlement/membership authority, versions part metadata
  and each location balance, locks balances deterministically, rejects
  underflow/stale writes, and bumps inventory sync state atomically; the
  runtime role has no direct inventory-table write grant
- verified, idempotent, version-checked team-member updates and guarded disable
  through migration `0020`; direct Auth-user creation/password handling is not
  part of worker management, and members with active jobs or positive stock
  cannot be disabled
- idempotent `POST` routes for atomic job creation and version-checked job
  completion, including same-transaction attachment upload-session consumption
- idempotent, signed create-only job-attachment upload sessions in the private
  `smart-job-company-files` bucket. Migration `0016` deterministically reuses
  the claim-backed session, enforces a committed 12-per-10-minute user limit
  and four-active-session user/workspace quota, and queues cleanup after three
  initial signing failures; replays generate fresh signed URLs rather than
  persisting bearer URLs
- verified-email, idempotent first-workspace business registration through the
  migration `0010` transaction
- verified, self-scoped push-token upsert/clear through migration `0011`; token
  values are never returned or logged
- verified, idempotent invitation create/redeem through migration `0012`, with
  SQL-derived authority, exact row locks, atomic membership creation, and
  separate hashed 10-per-minute limits
- opaque document dispatch, lease-token PDF completion, durable email delivery,
  authoritative document detail, and manager/dev manual retry for failed or
  delivery-unknown email
- strict idempotent tax invoice creation where type `305`, numbering, identity,
  reservation, and submission outbox are SQL-owned; internal Google-identity
  drains distinguish definite pre-send failure from ambiguous submission

The main API requires `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) for Auth
calls and `SUPABASE_SECRET_KEY` (`sb_secret_...`) only for trusted Storage
administration. It rejects legacy key formats in these runtime slots.

### cloudrun-tax/

This is the stateless Israel-region boundary. It validates Google caller
identity for approval requests, terminates HMAC-authenticated callbacks, and
forwards callback results to the protected main API. It has no database
connection and must never become an application data writer. Production
authority calls remain gated by certification and `TAX_SUBMISSION_MODE`.

### packages/api-contracts/

This package derives canonical business values from `@smart-job/contracts` and
adds Zod schemas for API envelopes, viewers/workspaces, cursors, entity
versions, uploads, jobs, clients, inventory, business registration, push tokens,
document tasks, email delivery, tax submission, and archive content retrieval.

### cloudrun-pdf/

This service owns PDF preview and generation. It:

- verifies trusted Pub/Sub/OIDC identity and accepts only opaque `taskId`
- claims canonical tenant/user/document/request data through `smart_job_pdf`
  private lease-token RPCs
- renders previews and final PDFs
- stores active artifacts in the private `smart-job-company-files` Supabase bucket
- derives object paths from internal company/document UUIDs and stores only canonical `storagePath` values
- finalizes document state and its sync-version bump atomically
- preserves create-only semantics; retries reuse only byte-identical PDFs and never overwrite
- uses GCS for no application-facing files; GCS remains owned by the monthly archiver

### cloudrun-email/

This private Pub/Sub worker owns generated-document email delivery. It:

- accepts only opaque `deliveryId` and claims canonical state through
  `smart_job_email` private lease-token RPCs
- creates a bounded signed URL for the canonical private PDF and submits via SES
- retries only definite pre-send/provider-rejected transient failures
- records ambiguous post-submission outcomes as `delivery_unknown`; automatic
  resend is forbidden and an authorized manual retry is required
- has no direct write privilege on public ERP tables

### cloudrun-archiver/

This batch job owns monthly archive creation and verified deletion. It:

- queues expired upload sessions and claims one bounded cleanup batch through
  migration `0009` service-role-only RPCs
- deletes only exact, canonical `smart-job-company-files` manifest paths and
  acknowledges each lease as complete, retryable, or dead-lettered
- reports upload-cleanup failures without preventing monthly archive work
- snapshots eligible finished jobs and documents
- holds a leased advisory lock per company/month/type and permits later segments
- drains pages of at most 500 into immutable record and companion ID objects
- uses GCS create-only generation preconditions and verifies generation,
  metadata, bytes, and checksum before deletion
- resumes deletion from the verified ID object in chunks of at most 500
- authenticates as `smart_job_archiver`, which has only narrow archive RPC access

### packages/db/

This package is the SQL persistence layer. It contains:

- schema definitions
- migrations
- typed access helpers
- read-model helpers used by backend services
- read-only profiling helpers under `packages/db/perf/` for advisor and `EXPLAIN` checks before broad index changes
- optimized baseline RPCs for client pages, inventory pages, and atomic multi-part inventory picks
- migration `0006_api_security_foundation.sql`, which provides
  `smart_job_api`, `private.set_api_request_context(...)`, private opaque
  session/idempotency/upload state, job `entity_version`, and
  `private.complete_job_with_details(...)`
- migration `0007_api_job_creation_and_storage.sql`, which provides atomic API
  job creation and the private `smart-job-company-files` attachment bucket
- migration `0008_pdf_supabase_storage.sql`, which permits PDF content in that
  same private bucket while leaving overwrite prevention to the trusted worker
- migration `0009_bounded_upload_session_cleanup.sql`, which provides
  service-role-only expiry/claim/finish wrappers, skip-locked leases, canonical
  manifest quarantine, and bounded cleanup attempts
- migration `0010_hardened_api_business_registration.sql`, which derives the
  first workspace's identity, role, tier, modules, and public counter inside one
  serialized transaction
- migration `0011_api_push_tokens.sql`, which exposes only authenticated-self
  push-token upsert/clear RPCs to `smart_job_api`

`smart_job_api` is intentionally not a migration role and has no general direct
write access to public ERP tables. Its password is not present in source or SQL
migrations; provision it out of band and supply the connection URL from Secret
Manager or an equivalent runtime secret. The role also has no database
`TEMPORARY` privilege. Every `SECURITY DEFINER` inventory/sync helper reachable
from job completion uses an empty search path and fully qualified database
objects, preventing temporary-relation shadowing.

### supabase/

This directory contains the local Supabase CLI configuration (`config.toml`)
and auth email templates (`templates/`). Application migrations live under
`packages/db/migrations` and are intentionally disabled in the Supabase CLI
migration directory.

## Active Data Model Responsibilities

### SQL-first areas

Primary ERP entities live in SQL, including:

- companies and profiles
- memberships and counters
- clients
- jobs and job attachments
- inventory
- documents and document tasks
- invites
- support conversations
- tax workflow state
- operational delivery, rate-limit, and archive tables

### Firestore residual areas

Firebase business-data services have been removed from the mobile and website
clients. Messaging and Crashlytics remain for push notifications and native
crash reporting.

## Request Patterns

### Website

The website uses an opaque Postgres-backed session cookie
(`__Host-sj_web_session` in production), a server-only DAL/BFF, and Server
Components. All `/app/*` routes use the opaque session. The DAL resolves the
opaque session, validates URL tenancy before scoped calls, and renders a
bounded first page before hydration. Same-origin login/session/logout and
business-registration BFF handlers use
`Authorization: SmartJobSession <opaque-token>`, exact Origin checks, and
double-submit CSRF for mutations. No Supabase access/refresh token is returned
to browser JavaScript.

### Mobile

The mobile app restores Supabase sessions through a SecureStore adapter and
attaches bearer tokens to Cloud API calls. Its root provider order establishes
session, tenant, React Query, encrypted outbox, and notification state before
routing. All feature reads/mutations use the bounded Cloud API routes with
tenant-scoped infinite-query keys.

Offline v1 supports only `job.create_finished` and `job.complete_assigned`.
Each authenticated uid has a SQLCipher database whose key remains in
SecureStore; photos/signatures are copied to app-owned storage, AES-256-GCM
chunk-encrypted, and hashed before enqueueing. Synchronization runs only at app
start, foreground, and connectivity restoration. Logout closes the database but
keeps pending work recoverable only by the same uid. Staged files are removed
only after confirmed reconciliation or explicit discard.
The processor exposes reconciled, queued, retry, conflict, and terminal outcomes
per operation; the Pending Work screen provides deliberate retry and discard.

Pinned `react-native-notify-kit` `10.4.8` owns local notification APIs while
Firebase Messaging continues to own remote delivery. Push-token register/clear
now uses `/api/v1/me/push-token` with a SecureStore-only installation ID so
logout clears one device registration. Token values are no longer cached in
MMKV or logged. Notification display/open handling requires the restored uid and
current accessible company, and Android local notifications use a new private
channel ID.

### Direct SQL access

Client applications must not bypass the backend and talk directly to SQL for protected ERP operations.

## Development Guidance

The isolated local Supabase Docker Desktop project is
`smart-job-erp-local`. Core ports are API `55321`, PostgreSQL `55322`, Studio
`55323`, Inbucket `55324`, and Edge inspector `55883`. Supabase CLI owns the
containers, but Drizzle owns application migrations in `packages/db/migrations`:

```powershell
supabase start
supabase db reset --local --no-seed
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
$env:DATABASE_SSL_MODE = "disable"
npm --prefix packages/db run db:migrate
npm --prefix packages/db run test:integration
supabase db lint --local --schema public,private --level warning
```

- The Cloud Run API (`cloudrun-api`) is the active in-repo backend surface.
- Wrap each main-API authenticated database operation in one transaction
  and call `private.set_api_request_context(...)` before domain queries.
- Use opaque `entity_version` values for update/completion/deletion conflicts;
  job completion must go through `private.complete_job_with_details(...)` so
  job, part, inventory, upload, attachment, and sync-version state commits
  together. API metadata updates, manager acceptance, and guarded deletion use
  only the narrow functions from `0021_api_job_mutations.sql`; each derives
  tenant/module/role authority in SQL and bumps `jobs_version` atomically.
- Enforce subscription status, expiry, tier, and canonical module overrides in
  SQL before returning module counts or accepting completion. Completion also
  records `accepted_by_user_id` and `accepted_at` from the verified request
  context in the same transaction.
- Store only hashed opaque session/CSRF tokens and AES-GCM-encrypted Supabase
  credentials in `private.web_sessions`; never add plaintext token columns.
- Verify Supabase bearer tokens against the configured issuer/audience and fail closed on missing or empty `uid` claims.
- Preserve canonical field names and status enums from `@smart-job/contracts`.
- Preserve backend-only mutation boundaries for locked business collections.
- Keep `storagePath` as the canonical persisted file reference.
- Do not weaken idempotency, deduplication, or create-only semantics in document flows.
- Allocate sequential identifiers through SQL counters; avoid `MAX + 1` allocation in concurrent mutation paths.
- Normalize incoming/public `companyId` inputs to internal company UUIDs before SQL filters in handlers; public numeric IDs and internal UUIDs must use separate query paths.
- When a handler needs to look up multiple membership records for the same company, batch the lookup with a single `.in("id", [...])` query rather than issuing one query per membership ID.
- Parallelize independent DB lookups (e.g., client resolution and assignee resolution) with `Promise.all` instead of sequential `await` calls.
- Resolve and validate dependent data (e.g., inventory part rows) before issuing destructive writes (e.g., deleting existing part usage rows) so failures leave the original state intact.
- Normalize public job identifiers to internal rows inside handlers, but return public sequential job/member IDs back to website/mobile callers.
- Return public membership identifiers such as `wid` at the boundary and do not leak internal membership UUIDs in invite or job flows.
- Keep cursor-based pagination stable with composite cursor semantics when ordering by timestamp + id.
- When read-model payloads expose public IDs, keep cursor tokens based on the underlying ordered SQL fields, not the public display IDs.
- Keep read-model filters wired through the Cloud API: `status`, date field/range, document type, creator, `pageSize`, `limit`, and `afterCursor`.
- Enforce module entitlement in read-model kinds before returning rows; disabled modules return empty lists or appropriate `failed-precondition` errors.
- Clients and inventory read-model calls support cursor pagination and prefix search through SQL RPCs so filtering and cursors execute in SQL instead of loading full collections into application memory.
- Dashboard/count-only read-model paths use lightweight SQL count helpers and must not fetch full inventory payloads.
- Inventory pick mutations use a batch RPC so multi-part picks commit or fail as one database transaction.
- Finished solo-job inventory consumption uses a SQL batch RPC so all consumed parts commit or fail together.
- Keep signed URL issuance server-controlled: fixed buckets and canonical storage path validation.
- Keep job file signed URLs bound to persisted attachment rows, not caller-selected prefixes.
- Accept temporary `attachmentUploadId` references during job creation only long enough to validate and normalize them into canonical attachment rows/storage paths.
- Keep document task result URLs semantically split by task type (`preview_url` vs `generate_url`) to avoid response-contract drift.
- Keep invite redemption race-safe by consuming invite state atomically before membership finalization.
- Keep preview/generate/tax document flows on the same SQL-backed draft-document plus `document_tasks` pipeline.
- Require manager authorization for company inventory mutations and for cross-member inventory mutations.
- Validate inventory location ownership against the resolved internal company UUID before applying movement updates.
- Reject inventory underflow instead of clamping balances to zero during backend mutations.
- Apply inventory movement writes atomically through SQL helpers such as `apply_inventory_movement(...)`, while preserving partial uniqueness for company-only and membership-scoped inventory locations.
- Use `apply_inventory_pick_batch(...)` for multi-part picks so all balance updates and movement rows share one SQL transaction.
- Use `apply_job_inventory_consumption_batch(...)` for finished-job part consumption so job-related stock deductions are atomic.
- Keep privileged RPC implementations in the private schema and expose only narrow `smart_job_api`-executable wrappers needed by the Cloud API.
- `createJobV1` uses the `create_job_with_details(...)` SQL RPC so job row, part usages, attachments, and finished-job inventory consumption commit in one transaction.
- `registerBusinessV1` uses the `register_business_account(...)` SQL RPC so company, profile, subscription, sync state, and owner membership commit in one transaction.
- Main-API creation uses `private.create_api_job_with_details(...)`; first-workspace
  registration uses `private.register_api_business_account(...)`. Both derive
  identity/tenant authority from the transaction request context and participate
  in API idempotency instead of trusting caller-supplied user metadata.
- Main-API push-token mutations may call only
  `private.upsert_api_push_token(...)` and `private.clear_api_push_token()`;
  never accept a target uid or expose the stored token.
- Cache/sync version mutations should use the SQL-side `bump_company_sync_version(...)` helper instead of read-modify-write updates.
- Keep tax invoice reservation/document/task ordering SQL-first and idempotent, without leaving reservation/task side effects ahead of the draft document row.
- Validate date fields before converting to ISO strings in tax and document handlers.
- Block deletion of approved tax invoices.
- Job deletion must reject certificates plus dependent documents, inventory
  movements, upload sessions, and attachments. The API never cascades these
  protected records or performs compensating file writes.
- Job PATCH never transitions directly to `finished`; callers use the
  versioned acceptance or field-completion route. Finished jobs cannot be
  moved back to another status.
- `manageWorker` add must handle unique-conflict races gracefully.
- Keep PDF finalization create-only once `storage_path` is already set, for every generated document type.
- Sanitize `item.quantity`, `item.price`, and `date` values in PDF templates; HTML-escape email template variables.
- Keep leased archive segments resumable from the verified companion ID object;
  never infer deletions from a fresh source query.
- Keep archived month reads behind backend handlers with fixed bucket/path derivation.
- Run `packages/db/perf/profiling.sql` on local/staging data before broad index changes, and verify advisor output with `EXPLAIN (analyze, buffers)`.

## Runtime Note

The Edge-to-Cloud-API cutover is complete. All Supabase Edge functions and
handlers have been deleted. The Cloud Run API is the sole backend trust
boundary. Firebase Messaging and Crashlytics remain for push notifications and
native crash reporting. Production tax submission remains disabled pending certification, and
stable API DNS is a production mobile-release gate.
