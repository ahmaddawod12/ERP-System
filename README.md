# Smart-Job ERP Monorepo

Smart-Job ERP is a multi-tenant field-service platform for solo operators and business teams.

## Runtime Snapshot (July 21, 2026)

- Supabase Auth is the active sign-in provider for website and mobile.
- The Cloud Run API (`cloudrun-api`) is the sole backend trust boundary. All
  Supabase Edge functions and handlers have been deleted.
- PostgreSQL (via `packages/db`) is the primary source of truth for company-scoped ERP data.
- Firebase Messaging and Crashlytics remain for mobile push notifications and
  native crash reporting. Firebase Storage, Firestore, and App Check have been
  removed. Active job files, PDFs, and previews use private Supabase Storage;
  GCS remains for monthly archives.
- Cloud Run workers handle PDF generation, durable SES document delivery, and
  monthly archives. Pub/Sub messages for PDF/email contain opaque IDs only;
  workers claim canonical state through least-privilege private SQL RPCs.
- `cloudrun-api` includes dual authentication, opaque sessions, bounded domain
  APIs, durable document/email drains, archive content retrieval, and the
  authoritative tax outbox. Production tax submission remains fail-closed
  pending certification.

## Repository Layout

```text
ERP-System/
|-- website/             Next.js website
|-- phone_app/           Expo mobile app
|-- supabase/            Local Supabase CLI config and auth email templates
|-- cloudrun-api/        Main Fastify API foundation
|-- cloudrun-tax/        Stateless Israel tax gateway foundation
|-- cloudrun-pdf/        PDF preview/generation service
|-- cloudrun-email/      Durable SES document-email worker
|-- cloudrun-archiver/   Monthly archive service
|-- packages/contracts/  Shared contracts and constants
|-- packages/api-contracts/ Runtime-validated HTTP contracts
|-- packages/db/         SQL schema, migrations, and access layer
|-- SETUP.md             Setup and deployment guide
|-- architecture.md      System and data ownership map
`-- backend.md           Backend boundaries and responsibilities
```

## Canonical Documentation

- `SETUP.md`: environment setup, deployment order, release prerequisites
- `architecture.md`: architecture and data ownership
- `backend.md`: backend runtime boundaries and invariants
- `website/README.md`: web app responsibilities and API proxy model
- `phone_app/README.md`: mobile app architecture and operational rules

## Quick Start

Install dependencies per package:

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-api install
npm --prefix cloudrun-tax install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-email install
npm --prefix cloudrun-archiver install
```

For the complete local server platform, start Docker Desktop and run one
repository-owned command from PowerShell:

```powershell
.\scripts\local-platform.ps1 start
```

This starts the isolated Supabase CLI stack and the production-shaped Compose
data plane: standalone non-root website, API, disabled tax gateway, PDF/email
workers, durable local Pub/Sub/identity adapter, fake GCS, and Mailpit. It
applies Drizzle migrations and bootstraps fresh local passwords for the
least-privilege database roles. Generated credentials live only in ignored
`local-platform/.env.generated`.

```powershell
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes  # deletes only this project's local data
```

The website is at `http://127.0.0.1:3000`, Mailpit at
`http://127.0.0.1:58025`, Supabase Studio at `http://127.0.0.1:55323`, and the
API at `http://127.0.0.1:58081`. Tax submission is always disabled locally.
The Expo app remains a native host/EAS workflow and points to the loopback API
or the development machine's LAN address; it is not run inside Compose.

The Supabase `project_id` remains `smart-job-erp-local`; migrations remain
under `packages/db/migrations`, not `supabase/migrations`. See `SETUP.md` for
the topology, ports, reset scope, and the optional archiver command.

Common checks:

```bash
npm --prefix website run typecheck
npm --prefix phone_app run typecheck
npm --prefix website run test
npm --prefix phone_app run test
npm --prefix packages/api-contracts test
npm --prefix cloudrun-api test
npm --prefix cloudrun-tax test
npm --prefix cloudrun-pdf test
npm --prefix cloudrun-email test
npm --prefix phone_app run doctor
```

## Core Rules

- `uid` is canonical user identity.
- `companyId` is canonical tenant scope; backend handlers resolve public numeric company IDs and internal UUIDs through separate SQL filters.
- Sequential IDs are allocated through SQL-backed counters, not `MAX + 1` reads.
- Protected company writes stay backend-only.
- Persist canonical `storagePath` for generated files, not durable download URLs.
- Valid job statuses are `pending`, `waiting`, `finished`, and `denied`.
- Public job API boundaries use sequential job numbers; internal UUIDs are resolved only inside backend handlers.
- Keep `read-model` `kind` contracts synchronized across website, mobile, and backend handlers.
- Clients and inventory read-model calls use SQL RPC-backed pagination/search; do not reintroduce full-collection in-memory filtering for those paths.
- Document read-model calls exclude unapproved tax invoices and return the same rich document shape used by website/mobile history screens.
- Approved tax invoices cannot be deleted.
- Finished solo jobs consume member inventory through the SQL `apply_job_inventory_consumption_batch(...)` helper.
- `deleteJobV1` and `deleteClientV1` reject requests when linked documents, inventory movements, or jobs exist.
- Module entitlement is enforced for both mutations and read-model kinds (`jobs`, `clients`, `inventory`, `documents`, `workers`).
- `smart_job_api` is a least-privileged database runtime role. Its password is
  provisioned out of band and must never be committed or embedded in a
  migration; authenticated API transactions set their user/timeouts through
  `private.set_api_request_context(...)`.
- Job updates use opaque `entity_version` values. Atomic completion goes through
  `private.complete_job_with_details(...)` and returns a conflict for stale
  versions instead of performing compensating writes.
- Manager/dev job acceptance consumes its recorded parts in the same locked SQL
  transaction before status finalization; insufficient inventory rolls back.
- Tax invoices use one authoritative SQL transaction and durable submission
  outbox. `reserved` and `submitted` are not approval; only `approved` may show
  a confirmation or enqueue the final PDF.
- SES delivery uses `queued|sending|sent|failed|delivery_unknown`. An ambiguous
  provider outcome is manual-review state and is never automatically resent.

### Production workflow migrations (`0025`–`0030`)

- `0025` is a verified no-op Drizzle metadata baseline after `0024`.
- `0026` makes job acceptance consume inventory exactly once.
- `0027`–`0028` add durable workflow tables, dedicated PDF/email/archiver
  roles, canonical worker claims, and the email state machine.
- `0029` adds atomic tax creation, outbox claiming, replay/conflict handling,
  `submission_unknown`, and approval-only PDF creation; `0030` synchronizes
  migration metadata.
- `npm --prefix packages/db run test:migrations` verifies the `0024` upgrade
  path on a loopback database. The regular clean migration plus integration
  suite verifies role, tenant, inventory, PDF, email, and tax behavior.

## Recent Hardening (April 26-June 22, 2026)

### Backend / SQL (optimized baseline `0000_optimized_baseline.sql`)
- Supabase mutation handlers normalize incoming `companyId` to internal company UUID before SQL queries.
- `resolveCompanyIdentifiers` now resolves public numeric IDs and internal UUIDs with separate queries so public company IDs are never OR-filtered against UUID columns.
- SQL counter RPCs (`allocate_company_counter`, `allocate_system_counter`) cover all sequential IDs: `public_company_id`, `member_no`, `client_no`, `job_no`, tax invoice numbers (`doc_305`), and inventory part numbers (`part_no`).
- New empty databases start from the optimized SQL baseline plus forward hardening migrations. The baseline includes RLS hardening, support-owner policies, document task locks, atomic inventory/invite/idempotency RPCs, read-model indexes for jobs/documents/clients/memberships/inventory, and service-role RPCs for client/inventory pages.
- Privileged RPC implementations live behind the private schema after `0001_supabase_cost_perf_security_hardening.sql`; public RPC names are compatibility wrappers granted to `service_role` only.
- `packages/db/perf/profiling.sql` contains the read-only profiling checklist for Supabase advisors, `pg_stat_statements`, and `EXPLAIN` before broader index changes.
- New migrations continue in numeric order through the current Drizzle journal
  tail; that journal is the authoritative forward-migration manifest.
- Migration `0006` adds `private.web_sessions`, `private.api_idempotency`, and
  `private.file_upload_sessions`; the `smart_job_api` role receives only the
  explicit reads and private RPC/DML grants required by the future API.
- Migration `0016` replaces direct runtime writes to upload-session state with
  claim-backed preparation/signing-failure RPCs, a committed 12-per-10-minute
  per-user limiter, a four-active-session user/workspace quota, and bounded
  cleanup after three initial Storage-signing failures. Replays mint fresh
  signed URLs and never persist them in idempotency state.
- Migration `0018` adds client entity versions and narrow API-only
  create/update/delete-or-archive functions. Client numbers use the locked SQL
  counter, stale writes fail with 409, manager/user/basic may mutate while
  workers are denied, referenced clients are archived, and default list reads
  omit archived rows unless `status=archived` or `status=all` is requested.
- Migration `0019` adds opaque inventory part and location-stock versions plus
  narrow API-only create/update/archive, company/self adjustment, manager
  transfer, and bounded batch-pick functions. SQL owns tenant/role/module
  checks, deterministic locks, underflow prevention, movement rows, and the
  inventory sync bump; the runtime role retains no direct table writes.
- Migration `0021` adds narrow API-only job update, acceptance, and deletion
  functions. Requests use opaque versions and idempotency; SQL owns
  tenant/module/role/assignment checks and the jobs sync bump. PATCH cannot
  complete a job, acceptance is manager/dev-only from pending or waiting, and
  deletion refuses protected database or private-file references.
- Web-session rows contain SHA-256 token/CSRF hashes and encrypted Supabase
  credentials, never plaintext session tokens. Operational cleanup now covers
  expired sessions, idempotency rows, and abandoned upload-session state.

## Optimizations (May 1-May 15, 2026)

### Database and API
- The optimized SQL baseline includes timestamp-plus-id covering indexes for jobs/documents read-model pagination and common role/status filters.
- The optimized SQL baseline includes operational lookup indexes for tax reservations, tax OAuth callbacks, support queues, and client email prefix search.
- `contact_requests` now stores a dedicated `subject VARCHAR(500)` column.
- `upgrade_requests.company_id` migrated from `VARCHAR(32)` to `UUID`; the API stores the internal company UUID.
- `document_tasks` now persist `lock_key`, and active-task uniqueness is enforced on `(company_id, task_type, lock_key)`.
- `redeem_company_invite(...)` atomically consumes invite state before membership finalization.
- `claim_tax_invoice_idempotency(...)` atomically claims tax approval work before side effects.
- `manageWorker` add handles unique-conflict races gracefully.
- Read-model service-role queries enforce the runtime role matrix before returning rows: workers/business users only get assigned jobs, basic users get no jobs, workers get no documents, and worker lists are manager/dev only.
- Read-model additionally enforces module entitlement (`jobs`, `clients`, `inventory`, `documents`, `workers`) per `company_subscriptions.enabled_modules`.
- Read-model cursor pagination for jobs/documents uses composite timestamp-plus-id cursors via PostgREST `.or()` and honors `status`, date range, document type, creator, `pageSize`, `limit`, and `afterCursor` filters.
- `documentTask` lookup is filtered by `company_id`.
- Client and inventory read-model pagination/search now execute through service-role SQL RPCs (`get_clients_page`, `get_company_inventory_page`, `get_member_inventory_page`) while preserving the website/mobile response shapes.
- `bootstrap` returns `jobsNextCursor` and `documentsNextCursor` from the first read-model page instead of hardcoded `null`.
- `bootstrap` count-only calls use SQL counts instead of loading full inventory payloads, and collection bootstrap includes `clientsNextCursor` for compatible pagination.
- `userSyncState` kind now returns `app_users.updated_at` instead of hardcoded zeros.
- Inventory part listing attaches the next sequential part ID from the SQL counter.
- Invite redemption consumes invite state atomically before membership finalization (prevents multi-join races).
- `contact/request` passes `subject` as a dedicated field; `company` defaults to `"General"` when absent.
- Double-fault catch in all three gateways (`mutation-gateway`, `mutation-gateway-me-west1`, `read-model`) now resolves with a safe CORS-aware error response instead of an unhandled rejection.
- Preview and generate requests now create SQL-backed `document_tasks`, enrich company/document payloads server-side, and dispatch trusted work to `cloudrun-pdf` directly from the edge runtime.
- Tax invoice submission is fail-closed pending Tax Authority certification. The legacy `getInvoiceApproval` compatibility operation returns an unavailable response before allocating a number, writing a document, or dispatching a PDF.
- Duplicate preview/generate dispatches are suppressed when an active SQL `document_tasks` row already exists for the same lock key.
- `fetchArchiveMonthV1` now retrieves archived month JSON through the backend trust boundary using server-controlled bucket/path access.
- Job mutations and read-model responses now preserve worker/mobile job fields such as `timeFrom`, `timeTo`, `travelDistance`, `signingPerson`, `photos`, `signature`, and `partsUsed`.
- `createJobV1` resolves job part references before inserting the job row, preventing partial job creation when a supplied part ID is invalid.
- `updateJobV1` loads existing attachment rows before replacement and attempts to restore them if a replacement insert fails.
- Job reads and writes now return public sequential job/member IDs at the API boundary while still accepting legacy UUID job identifiers internally during transition.
- Job pagination cursors still use the stable internal `(created_at, id)` tuple even though the payload exposes public sequential job IDs.
- Job file signed URL issuance now requires an exact `job_attachments.storage_path` match for the resolved job before a short-lived URL is minted.
- Edge-to-Cloud-Run document dispatch now accepts either a Google-issued invoker token or the Supabase edge service-account JWT signed with `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`, while still requiring the shared `x-pubsub-token` layer when configured.
- Inventory mutation helpers now fail closed on negative balances instead of clamping underflow to zero.
- Inventory movement writes now use the SQL `apply_inventory_movement(...)` RPC, and active company-membership / inventory-location uniqueness is enforced with runtime-safe partial indexes.
- Multi-part inventory picks now use `apply_inventory_pick_batch(...)` so the pick operation commits or fails as one database transaction.
- Finished job inventory consumption now uses `apply_job_inventory_consumption_batch(...)`, and direct table RLS mirrors the backend role matrix for jobs, documents, and membership lists.
- Invite join responses now return the public membership number as `wid` and no longer leak the internal membership UUID.

### Website
- Auth transport no longer persists Supabase access token or refresh token in `localStorage`; access token and expiry are kept in-memory and only non-sensitive user info (`uid`, `email`) is written to `sessionStorage`.
- `UserProfile.wid` / `mid` type narrowed from `string | number` to `number | null` to match SQL-allocated integer membership IDs.
- `generateCompanySlug` now uses `crypto.getRandomValues` instead of `Math.random()` for the randomized suffix.
- Document task URLs split by task type: `preview_url` → `previewURL`, `generate_url` → `downloadURL`. `updateBusinessInfoV1` rejects `vat_number` mutations after onboarding.
- Website server proxy auth now uses split HttpOnly cookies: signed session metadata in `__session`, current bearer token in `__session_access`.
- Session route validation now requires the `__session_access` bearer cookie in addition to the signed `__session` metadata cookie.
- Registration now requires email confirmation and does not create a browser session. Confirmation is handled server-side; the user signs in only after the email is verified.
- Contact request spam/challenge failures now return `400` route errors with stable codes (`spam_rejected`, `invalid_challenge`).
- The explicit-tenant clients page keeps its bounded initial directory
  server-rendered and sends create/update/delete-or-archive only through
  tenant-scoped opaque-session BFF routes with exact Origin, double-submit
  CSRF, stable idempotency keys, and client entity versions.

### Mobile (`phone_app`)
- Tax invoice `idempotencyKey` suffix now uses `crypto.randomUUID()` instead of `Math.random()`.
- `document-copy.ts` replaced all hardcoded numeric doc-type keys with `[DOC_TYPE.*]` computed properties from `@smart-job/contracts`.
- `SupportChat.tsx` back-button label fixed (was mojibake `×—×–×•×¨` / `Ø±Ø¬ÙˆØ¹`; now correct UTF-8 `חזור` / `رجوع`).
- Jobs/documents cache bootstrap and version refresh drain paginated read-model pages only for the active 90-day cache window: open jobs, recently updated closed jobs, and recent documents.
- Mobile read-model array helpers unwrap paginated `{ items, nextCursor }` responses while page helpers preserve the cursor for future infinite-scroll callers.
- Client Book and compatibility cache client mutations now use authenticated
  Cloud API calls with active-only bounded pages, opaque entity versions,
  retry-stable idempotency keys, and tenant-scoped React Query invalidation;
  these paths no longer call Edge client mutations or Firebase data writes.
- Core mobile cache/debug logging is routed through a dev-only logger wrapper; warnings and errors remain visible.
- MMKV draft, pending-job, and support hide-state keys are now scoped by active `uid` / `companyId` instead of sharing global device-wide keys.
- Supabase auth transport tokens now live in Expo SecureStore; non-sensitive identity hints remain in the general MMKV cache.
- The mobile Firebase barrel no longer exports `writeBatch` or `runTransaction`, which keeps protected Firestore writes out of shared client helpers.
- Offline solo-job sync now replaces the locally queued temp job with the server-created public job after replay succeeds.
- Company cache refresh now preserves the role-appropriate existing jobs cache when only documents change.
- Solo finished jobs now upload attachments before `createJobV1`, so the created job record is born with real file refs instead of an empty placeholder payload.
- Mobile job attachment uploads now use canonical company-scoped storage paths and may pass a temporary `attachmentUploadId` until the server allocates the final public job number.
- Notification channel initialization is now idempotent, and push listeners/token sync are attached only after the authenticated cache bootstrap succeeds for the active user session.
- Local notification APIs now come from pinned `react-native-notify-kit`; iOS
  disables NotifyKit remote-notification handling because Firebase Messaging
  continues to own remote push callbacks. Native dev clients must be rebuilt
  after this dependency change.

### `cloudrun-pdf`
- `buildStoredDocumentRecord` no longer writes forbidden field names (`clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `createdBy`) to stored document records.
- `htmlTemplate.ts` now sanitizes `logoUrl` through `sanitizeUrl()` which rejects `javascript:` and `data:` schemes before insertion into the `<img src>` attribute.
- Template rendering also sanitizes `item.quantity`, `item.price`, and `date` values to prevent injection through document line items.
- Email template variables are HTML-escaped before message composition.
- Email service is now a true singleton; the non-singleton `getEmailService()` export has been removed.
- Generated PDF finalization now stays create-only in both Storage and SQL document finalization for all document types.
- Generated PDFs, previews, and logo reads use the private
  `smart-job-company-files` Supabase bucket through a server-only secret key.
  Object paths are internal-UUID scoped; duplicate retries reuse only
  byte-identical PDFs, ambiguous finalization failures retain retryable bytes,
  and document finalization advances sync state atomically.
- `cloudrun-pdf` trusted dispatch verification now supports the Supabase edge self-signed service-account JWT path in addition to Google OIDC verification.
- Dockerfile pins Puppeteer to `24.40.0` and sets `NODE_ENV=production`.

### `cloudrun-archiver`
- Startup runs one bounded abandoned-upload cleanup batch before monthly archive
  work when `SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY` are configured.
  It claims sessions with leases, deletes only exact canonical manifest paths,
  and acknowledges completion or a bounded retry; failures are reported without
  blocking monthly archives.
- Monthly archives now drain paginated SQL reads and stream JSON payloads through temporary disk files before upload, which removes the old single-page and whole-month-in-memory failure mode.
- Archive verification now checks stored metadata and re-hashes the uploaded object via stream before deletion.
- Archive manifests remain resumable: `uploaded_not_deleted` retries verify the archive and mark the manifest `deleted` when records are already gone, instead of failing on exact-count mismatches.
- The archiver Docker image now builds from repo-root context so local `file:` dependencies on `packages/db` and `packages/contracts` resolve in the documented build order.

### CI / Scripts
- `check-no-ts-nocheck.mjs` enforces the protected path set from `AGENTS.md`.
- `check-js-syntax.mjs` is now invoked in CI for a quick syntax sweep of repo scripts.
- CI jobs use `concurrency.group` + `cancel-in-progress: true` to avoid redundant runs.
- CI now enforces the documented shared-package build order by making app/service jobs depend on `packages_contracts` and `packages_db` as needed, and builds shared packages inline where required.
- `cloudrun_pdf` and `cloudrun_archiver` CI now run `npm run typecheck` before test.
- `cloudrun_archiver` CI now builds `packages/contracts` and `packages/db` before installing/testing the archiver, and the image build now uses `docker build -f cloudrun-archiver/Dockerfile .`.

## Remaining Launch Gates

The Edge-to-Cloud-API cutover is complete. All Supabase Edge functions and
handlers have been deleted. Production tax submission remains disabled pending
certification, and stable API DNS is a mobile-release gate.
