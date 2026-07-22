# Architecture

This document describes the July 22, 2026 Smart-Job ERP architecture after
the completed Edge-to-Cloud-API cutover.

## Executive Summary

- Supabase Auth is the active identity provider for user sign-in.
- The Cloud Run API (`cloudrun-api`) is the sole backend trust boundary.
  All Supabase Edge functions and handlers have been deleted.
- PostgreSQL is the primary source of truth for company-scoped ERP entities.
- Firebase Messaging and Crashlytics remain for mobile push notifications and
  native crash reporting; Firebase Storage, Firestore, and App Check have been
  removed.
- The private Supabase `smart-job-company-files` bucket owns job attachments
  and PDF/preview/branding paths; GCS remains for monthly archives.
- `packages/api-contracts`, `cloudrun-api`, `cloudrun-tax`, `cloudrun-pdf`, and
  `cloudrun-email` implement the Cloud Run data plane. The API owns opaque
  document/email outboxes, authoritative document workflow state, atomic tax
  creation/submission, and archive content retrieval. Tax submission remains
  disabled pending certification.

## Runtime Topology

```text
Next.js website --server-only session/BFF--> cloudrun-api --> Supabase Postgres/Auth/Storage
Expo iOS/Android ------Supabase bearer--------^       |----Pub/Sub----> cloudrun-pdf
Scheduler/queues -------Google IAM------------^       |----Pub/Sub----> cloudrun-email --> AWS SES
                                                       `----Google IAM--> cloudrun-tax (me-west1)
```

Migrations through `0032` support the API, private file/PDF flow, versioned
domain mutations, transactional accepted-job inventory consumption, dedicated
worker roles, durable email/tax/archive workflow state, leased immutable
archives, schema-aware readiness, indexed bounded search, and approval-only tax
PDF generation. Production tax submission and stable API DNS are launch gates.

## Ownership Map

### Identity and authorization

- Supabase Auth owns sign-in and bearer tokens.
- Backend authorization happens inside the Cloud Run API.
- The API enforces the expected Supabase issuer/audience and rejects empty `uid` claims.
- `uid` is the canonical user identity key.
- `companyId` is the canonical tenant scope key.
- Company-scoped access is validated server-side, not inferred from client payloads.
- Main-API transactions use the least-privileged `smart_job_api` role and
  begin with `private.set_api_request_context(...)`; the runtime password is
  provisioned out of band and is never stored in schema migrations.
- Initial main-API domain routes accept exactly one verified Supabase Bearer JWT
  or one opaque `SmartJobSession`. Safely valid sessions use a lock-free read;
  only refresh-window sessions are rechecked under `FOR UPDATE`. Stored
  Supabase access/refresh credentials never leave the session service.
- New Auth/mobile code uses publishable (`sb_publishable_...`) keys. Only the
  trusted API/PDF/email/archiver Storage paths receive secret (`sb_secret_...`) keys;
  no secret or legacy service-role key may enter browser/mobile configuration.
- The Cloud Run API must normalize incoming/public `companyId` values to internal company UUIDs before SQL reads/writes. Public numeric IDs and internal UUIDs are resolved with separate SQL filters.
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
- Durable workflow state: `private.document_email_deliveries`,
  `private.tax_submissions`, and `private.archive_run_leases`
- Inventory: `inventory_locations`, `inventory_parts`, `inventory_balances`, `inventory_movements`
- Documents and links: `documents`, `document_items`, `document_job_links`, `proposal_usage`
- Document tasks: `document_tasks` (preview tasks write `preview_url`; generate tasks write `generate_url`)
- Tax flows: `tax_invoice_reservations`, `tax_invoice_idempotency`,
  `tax_authority_tokens`, `tax_oauth_sessions`, `tax_oauth_callbacks`, and
  replay-safe `private.tax_callback_events`
- Invites: `company_invites`
- Support: `support_conversations`, `support_messages`
- Operational SQL tables: `notification_deliveries`, `rate_limit_buckets`, `archive_runs`, `auditLogs`, `orphanedUserCleanupMarkers`, `system_counters`
- SQL helper functions: counters/rate limits, invite and tax idempotency,
  inventory movement, batch picks, finished-job inventory consumption,
  client/inventory paged reads, lightweight counts, bounded upload cleanup,
  sync-version bumps, API job creation/registration, and self-scoped
  push-token writes are backend-only RPCs.
- Privileged RPC implementations live in the `private` schema with `SECURITY DEFINER`; only narrow `smart_job_api`-executable wrappers are exposed to the Cloud Run API.
- Jobs carry an opaque `entity_version`; API completion calls use
  `private.complete_job_with_details(...)` to validate the expected version and
  atomically commit status, parts, inventory, uploads, attachments, and sync
  version changes.
- Job metadata/client/assignee updates, manager acceptance, and guarded
  deletion use the private functions in migration `0021`. Each re-derives the
  authenticated membership, jobs entitlement, role, assignment, and expected
  entity version in SQL; only the three transaction functions are executable
  by `smart_job_api`.

### Firebase client services

Firebase business-data services have been removed from the mobile and website
clients. Messaging and Crashlytics remain for push notifications and native
crash reporting.

### File storage ownership

The private Supabase bucket `smart-job-company-files` is the canonical target
and is implemented for generated PDFs, previews, company-branding reads, and
the job photo/signature upload-session flow. Object paths start with the
internal company UUID. Google Cloud Storage is retained for internal monthly
archive payloads. The mobile client accesses job files only through signed
Supabase upload sessions and exact signed download routes.

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
- The website uses an opaque Postgres-backed session cookie
  (`__Host-sj_web_session` in production), a server-only DAL/BFF, and Server
  Components. All `/app/*` routes use the opaque session.
- The DAL resolves the opaque session, validates URL tenancy before scoped
  calls, and fetches bounded SQL-filtered pages before hydration.
- The clients page keeps its initial directory server-rendered while focused
  browser islands send create/update/delete-or-archive only to tenant-scoped
  same-origin BFF routes. Those handlers require exact Origin, double-submit
  CSRF, opaque sessions, idempotency keys, and optimistic entity versions before
  forwarding server-to-server with `SmartJobSession`.
- The inventory page follows the same split: its bounded first page stays in a
  Server Component, while manager/dev create/update/archive/company-adjust
  controls call only exact-Origin, double-submit-CSRF BFF routes.
- Same-origin login/session/logout and business-registration BFF routes use the
  opaque Postgres-backed session. Production stores only
  `__Host-sj_web_session` as HttpOnly plus readable `sj_csrf`; mutations require
  the matching `X-SJ-CSRF` header and exact `WEBSITE_ORIGIN`.

### Mobile

- The Expo app stores Supabase transport tokens through a SecureStore adapter,
  uses single-flight refresh, and starts/stops refresh with AppState.
- Root provider order establishes session → tenant → React Query → encrypted
  outbox → notifications before routing.
- All feature reads/mutations use the bounded Cloud API routes with query keys
  that include `uid` and `companyId`.
- Client Book uses active-only bounded Cloud API pages and Cloud API mutations.
  Create/update/delete-or-archive carry stable idempotency keys and opaque
  entity versions, then invalidate only the current `uid`/`companyId` client
  queries.
- Inventory screens use the authenticated main API for company part creation/
  updates and self-scoped member adjustments. Manager/dev owns company writes,
  user company views are read-only, workers send only `/inventory/me` writes,
  and retry-stable Expo Crypto UUID keys plus opaque part/stock versions protect
  every operation.
- MMKV backs preferences, bounded compatibility caches/drafts, and encrypted query
  snapshots. Supabase tokens and SQLCipher/file keys remain in SecureStore, and
  the durable field outbox is not stored in MMKV.
- Mobile cache refresh drains paginated jobs/documents reads for the active
  90-day cache window instead of assuming page one is complete.
- Mobile debug logging uses the dev-only logger wrapper for noisy cache/read-model output.
- Archived month reads go through the Cloud API archive content route; clients
  do not read protected archive objects directly.
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

- The Cloud Run API is the active trust boundary for all company-scoped writes
  and reads.
- The API performs authorization, validation, rate limiting, and side-effect control.
- The API reads/writes SQL for primary ERP entities and uses Supabase Storage
  for job attachments and generated documents.

### Document generation

- The API publishes opaque `{ taskId }` messages only.
- `cloudrun-pdf` verifies Google/Pub/Sub identity, claims canonical tenant,
  user, document, and request data through `smart_job_pdf` private RPCs, renders
  PDF output, writes through a server-only Supabase secret key, and finalizes
  task/document state with its lease token.
- New generated artifacts keep create-only semantics. A retry may reuse an existing object only after its size, MIME type, and SHA-256 bytes match. Objects are retained across ambiguous SQL/signing failures so a committed finalization can never point at a compensating-deleted file; operational cleanup handles confirmed orphans.
- Generate flows must not overwrite an existing finalized PDF or existing SQL `storage_path`, regardless of document type.
- Document finalization and its `documents_version` bump commit in one SQL transaction.

### Document email delivery

- Final PDF completion creates one durable email row only when the canonical
  recipient is valid. A separate API outbox publishes opaque `{ deliveryId }`.
- `cloudrun-email` uses only `smart_job_email` private RPCs, creates a bounded
  signed download URL, submits to SES, and records `sent`, definite failure, or
  `delivery_unknown`.
- A timeout/network ambiguity after SES submission is never automatically
  retried. Authorized manager/dev manual retry is required.

### Tax workflow

- Tax invoice type `305` is implicit. One SQL transaction allocates `doc_305`
  and writes the document, items, reservation, and durable submission outbox.
- Google-identity-protected drains call the regional gateway with a stable
  correlation ID. Pre-send failures may defer; ambiguous submissions become
  `submission_unknown` pending reconciliation.
- `reserved` and `submitted` never display approval or generate a final PDF.
  Only replay-safe confirmed `approved` with a confirmation number enqueues the
  final PDF. Production starts with `TAX_SUBMISSION_MODE=disabled`.

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
- `cloudrun-archiver` claims one leased/advisory-locked company/month/type
  segment at a fixed snapshot time. Later-arriving historical rows use later
  immutable segments; an empty claim releases the lease without closing a month.
- Archive export drains SQL pages of at most 500 and streams separate record
  and ID JSON objects to temporary disk. Both GCS uploads are create-only with
  `ifGenerationMatch=0` and are accepted only after generation, metadata, byte
  count, and SHA-256 verification.
- Source deletion consumes only the verified companion ID object in chunks of
  at most 500. A lost worker resumes from that object and the stored delete
  cursor; it never reruns the eligibility query to choose deletions.
- Archive retrieval stays backend-controlled; callers provide `(companyId, year, month, dataType)` and the Cloud Run API reads the archive from GCS using the service identity.

### Runtime health and public abuse boundary

- `/healthz` is dependency-free process liveness. `/readyz` verifies the exact
  schema marker and RPC privilege matrix, both storage buckets, and all three
  mandatory Pub/Sub topics.
- Production website/API backends sit behind separate Cloud Armor policies and
  per-IP throttles. Account-recovery responses are generic, and Auth/
  reCAPTCHA upstream bodies and deadlines are bounded.
- Terraform owns authoritative DNS with DNSSEC, Google-managed TLS, one global
  HTTPS load balancer, host routing for website/API/tax, and separate Cloud
  Armor policies. Direct public Cloud Run ingress is disabled; PDF/email remain
  internal and require the Pub/Sub push identity.

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
- SQL RPCs for clients and inventory pagination are backend-only; website/mobile callers reach them through the Cloud Run API.
- Privileged RPC implementations live in the private schema; only narrow `smart_job_api`-executable wrappers are exposed to the Cloud Run API.
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
- Non-tax document IDs use the canonical suffix plus number pattern.
- Tax flows require server-side validation and idempotency.

### Writes and side effects

- Protected writes to locked business collections stay backend-only.
- Rate limiting, deduplication, and idempotency must happen before push/email/Pub/Sub side effects.
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
owned by `packages/db/migrations` and Drizzle. For full-stack development,
Supabase CLI starts on the explicit external `smart-job-local` network and
`compose.local.yml` attaches the application services and emulators to it:

```text
browser -> standalone website -> cloudrun-api -> Supabase Auth/Postgres/Storage
                                  |       |
                                  |       `-> durable local adapter -> PDF/email push
                                  |                                `-> Mailpit (SES)
optional archiver ----------------+---------------------------------> fake GCS
```

The adapter's persistent queue is a local substitute for Pub/Sub transport,
not a different application contract: messages still contain only `taskId` or
`deliveryId`, and workers load canonical state through private SQL RPCs. Local
identity, internal HTTP routing, and emulator endpoints are rejected unless the
repository marker is mounted. The removed archiver admin compatibility mode is
rejected in every environment.
Production-mode website cookies become insecure-loopback cookies only after
the image entrypoint validates that marker. Tax remains disabled.

### Build and release trust

- Every external GitHub Action, Dockerfile base, and Compose image is pinned by
  immutable digest and checked by `scripts/check-supply-chain-pins.mjs`.
- CI builds and tests every independent package, exercises database migrations
  and tenant behavior, runs Playwright and Maestro journeys, emits an SBOM, and
  blocks on CodeQL, secret, audit, and container findings outside the bounded
  exception policy.
- Staging Cloud Run release jobs build each image once, scan it, resolve the
  Artifact Registry digest, and keyless-sign that digest. Production refuses to
  rebuild: it copies and verifies the same OCI manifest digest, then signs the
  destination reference. Mutable tags are discovery labels only.
- A dedicated migrator identity and numbered secret version run expand-only SQL
  before tagged no-traffic revisions. An internal credential-free smoke job
  validates candidate URLs, then separate approvals move 10%, 50%, and 100% of
  traffic. Failed edge smoke restores the previously serving revisions.
- Shared Terraform modules create explicit dev/staging/prod platforms with
  isolated state prefixes, fixed two-region egress, connection-budget guards,
  durable queues/DLQs, schedules, archive/backup buckets, monitoring services,
  thirty-day SLOs, alerts, and GitHub WIF. Terraform never manages secret bytes.
- Operational deployment, rollback, restore, replay, and reconciliation
  procedures live under `docs/runbooks/`.

## Migration Direction

The Edge-to-Cloud-API cutover is complete. All Supabase Edge functions and
handlers have been deleted. The Cloud Run API is the sole backend trust
boundary. Firebase Messaging and Crashlytics remain for push notifications and
native crash reporting. Production tax submission remains disabled pending certification, and
stable API DNS is a production mobile-release gate.
