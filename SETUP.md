# Smart-Job ERP Setup Guide

This is the canonical setup and deployment guide for the current Smart-Job ERP stack.

It reflects the active July 18, 2026 architecture and the pre-launch backend
migration foundation:

- Supabase Auth for website and mobile sign-in
- Supabase Edge gateways under `supabase/functions/` as the in-repo backend trust boundary
- PostgreSQL as the primary company-scoped ERP persistence layer
- Firestore and Cloud Storage for compatibility, rules, operations, and files
- Cloud Run services for API, tax gateway, PDF generation, durable SES email,
  and archiving
- Supabase Edge Functions remain the active application gateway during migration
- `cloudrun-api`, `cloudrun-tax`, `cloudrun-pdf`, and `cloudrun-email` are
  implemented and locally tested; production resource provisioning and launch
  gates remain separate work. Tax stays disabled pending certification.

## 1. Repository Components

```text
ERP-System/
|-- website/             Next.js website
|-- phone_app/           Expo mobile app
|-- supabase/functions/  Edge gateway and endpoint runtime in this repository
|-- cloudrun-api/        Main Fastify API foundation
|-- cloudrun-tax/        Stateless Israel tax gateway foundation
|-- cloudrun-pdf/        PDF preview/generation service
|-- cloudrun-email/      Durable SES document-email worker
|-- cloudrun-archiver/   Archive batch job
|-- packages/contracts/  Shared enums/constants/path helpers
|-- packages/api-contracts/ Shared Zod HTTP contracts
|-- packages/db/         PostgreSQL schema, migrations, access layer
`-- supabase/            Backend gateway runtime and migration work area
```

## 2. Prerequisites

Install locally:

- Node.js 22
- npm
- Firebase CLI
- Google Cloud CLI
- Java 17 or newer for emulators
- Docker Desktop for the isolated local Supabase stack, plus Docker or Cloud
  Build access for future Cloud Run images
- Supabase CLI
- EAS CLI for mobile builds
- PostgreSQL access for SQL-backed development and deploys
- Supabase project access for auth and migration testing
- AWS access only if SES email delivery is used

Suggested installs:

```bash
npm install -g firebase-tools eas-cli
```

Authenticate:

```bash
firebase login
gcloud auth login
gcloud auth application-default login
```

## 3. Cloud Project Setup

Create or configure the Firebase and Google Cloud project:

1. Create a Firebase project.
2. Upgrade to Blaze.
3. Enable Firestore.
4. Enable Firebase Storage.
5. Enable Cloud Messaging.
6. Enable Authentication if you still need Firebase-native mobile or runtime services, but do not treat Firebase Auth as the primary client auth provider.
7. Enable these Google Cloud APIs:

```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebasestorage.googleapis.com \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com
```

Set local shell variables as needed:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export ARCHIVE_BUCKET="your-archive-bucket"
export ARTIFACT_REPO="smart-job"
export PDF_SERVICE="pdf-service"
export ARCHIVER_JOB="smart-job-archiver"
```

PowerShell:

```powershell
$env:PROJECT_ID = "your-project-id"
$env:REGION = "us-central1"
$env:ARCHIVE_BUCKET = "your-archive-bucket"
$env:ARTIFACT_REPO = "smart-job"
$env:PDF_SERVICE = "pdf-service"
$env:ARCHIVER_JOB = "smart-job-archiver"
```

## 4. Install Dependencies

There is no root package-manager workspace. Install packages individually:

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

Apply SQL migrations for the target database:

```bash
npm --prefix packages/db run db:migrate
```

On a disposable loopback database, `npm --prefix packages/db run
test:migrations` reconstructs the schema through `0024`, proves that the `0025`
metadata baseline is a no-op, and applies every later migration. Reset the
local Supabase database afterward before the normal Drizzle migration run.

## 5. Website Environment

Create `website/.env.local` and configure:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false

SESSION_COOKIE_SECRET=
WEBSITE_SESSION_SECRET=
CONTACT_CHALLENGE_SECRET=          # optional; falls back to WEBSITE_SESSION_SECRET

BACKEND_PROJECT_ID=
BACKEND_EDGE_FUNCTIONS_BASE_URL=
BACKEND_API_BASE_URL=              # server-only Cloud Run API base; HTTPS except local loopback
BACKEND_API_TIMEOUT_MS=12000       # optional; maximum 12000
WEBSITE_ORIGIN=http://localhost:3000

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
```

Notes:

- Supabase variables are required for active web auth.
- `SESSION_COOKIE_SECRET` must be a strong shared secret per environment; it signs the website `__session` metadata payload.
- Website server proxy auth uses two HttpOnly cookies: signed metadata in `__session`, bearer transport in `__session_access`.
- Protected session validation requires both cookies; `__session` metadata alone is not enough to authorize backend proxy calls.
- `BACKEND_EDGE_FUNCTIONS_BASE_URL` is the explicit website proxy override.
- If `BACKEND_EDGE_FUNCTIONS_BASE_URL` is not set, the website falls back to `${SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL}/functions/v1`.
- `BACKEND_API_BASE_URL` and `WEBSITE_ORIGIN` enable the new opaque-session
  BFF entrypoints. The backend base is read only on the server, and mutation
  Origin headers must exactly match `WEBSITE_ORIGIN`.
- The opaque-session foundation uses `__Host-sj_web_session` in production
  (`sj_web_session` on insecure localhost) plus the readable `sj_csrf`
  double-submit cookie. It is not the active ERP client session until the
  remaining website data slices are moved off browser bearer transport.
- Website auth transport avoids storing refresh tokens durably in `localStorage`; session continuity should rely on the signed cookie-backed session plus in-memory auth transport state.
- Firebase web/admin vars are still required where Firebase services remain in use.

## 6. Mobile Environment And Native Files

The mobile app still requires Firebase native app registration for the installed services it uses.

Place these files in `phone_app/`:

- `google-services.json`
- `GoogleService-Info.plist`

Configure mobile envs as needed:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL=
```

Notes:

- Registration and onboarding remain website-only.
- If `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL` is empty, the app uses `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1`.
- Mobile Supabase transport tokens are stored in Expo SecureStore, separate from the general cache MMKV store.
- General MMKV stores non-sensitive cache and identity hints only; do not store access or refresh tokens there.
- Push notification listeners and token registration are attached after authenticated cache bootstrap succeeds for the active session; Android channel setup is safe to call more than once.

## 7. Supabase Edge Environment

Create `supabase/.env` (or configure Supabase secrets) for local development and deployment configuration:

```dotenv
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-website.example

SMART_JOB_PERSISTENCE_BACKEND=sql
DATABASE_URL=
DATABASE_SSL_MODE=disable
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_SSL_CA=
DATABASE_MAX_CONNECTIONS=10
DATABASE_CONNECT_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
GCP_SERVICE_ACCOUNT_EMAIL=
GCP_SERVICE_ACCOUNT_PRIVATE_KEY=
PUBSUB_VERIFICATION_TOKEN=
CLOUD_RUN_PDF_SERVICE_URL=
DOCUMENTS_BUCKET=smart-job-company-files
ARCHIVE_BUCKET=

TAX_SUBMISSION_MODE=disabled
TAX_AUTH_URL=
TAX_TOKEN_URL=
TAX_APPROVAL_URL=
TAX_CLIENT_ID=
TAX_CLIENT_SECRET=
TAX_SCOPE=
TAX_CALLBACK_URL=
APP_SCHEME=erpsystem
```

Rules:

- Set `SMART_JOB_PERSISTENCE_BACKEND=sql` explicitly in real environments.
- Do not rely on implicit SQL enablement when database settings are present.
- Keep CORS origins aligned with website domains and local dev origins.
- Do not use `*` for CORS when sending credentials; use explicit origins in `CORS_ALLOWED_ORIGINS`.
- Keep `CORS_ALLOWED_ORIGINS` non-empty in real environments. Empty origin lists are treated as fail-closed.
- Supabase variables are required because backend HTTP auth verification and gateway routing are Supabase-based.
- `JWT_SECRET` is required for edge JWT verification; the edge runtime throws at startup if it is missing.
- `SUPABASE_SERVICE_ROLE_KEY` is required for service-role database access; the edge runtime throws at startup if it is missing.
- Shared edge auth verification derives the expected JWT issuer/audience from the configured Supabase project and fails closed on empty `uid` claims.
- Keep `ALLOW_FIREBASE_AUTH_FALLBACK=false` unless a controlled compatibility incident requires temporary fallback.
- `GCP_SERVICE_ACCOUNT_EMAIL` / `GCP_SERVICE_ACCOUNT_PRIVATE_KEY` allow edge handlers to mint OIDC tokens for trusted `cloudrun-pdf` dispatch.
- `cloudrun-pdf` should be configured with the same service-account identity material when you want it to verify the edge-signed bearer JWT path locally.
- The same service account credentials are used by `fetchArchiveMonthV1` to read archive objects from `ARCHIVE_BUCKET` through backend-controlled bucket/path access.
- `PUBSUB_VERIFICATION_TOKEN` should match the shared verification token expected by `cloudrun-pdf` when that hardening layer is enabled.
- `CLOUD_RUN_PDF_SERVICE_URL` is required for preview/generate task dispatch from the edge runtime.
- `DOCUMENTS_BUCKET` must be `smart-job-company-files` so transition-time signed document downloads use the same private bucket as `cloudrun-pdf`.
- `ARCHIVE_BUCKET` is required if mobile or other clients need archived month retrieval through `fetchArchiveMonthV1`.

## 8. SQL Setup

`packages/db` is the canonical SQL schema and migration surface.

Current migration shape:
- Empty/new databases apply the optimized baseline migration
  `0000_optimized_baseline.sql`, then every journaled forward migration in
  numeric order through the current Drizzle journal tail. The historical
  incremental migrations before the baseline were intentionally squashed
  because this database starts empty.
- The baseline includes:
  - RLS enabled on all public-schema tables, with client-visible policies only where the app needs direct reads
  - owner-or-dev RLS for personal `support_conversations` and `support_messages`, including records with no company scope
  - cursor-covering read-model indexes for timestamp-plus-id jobs/documents pagination
  - targeted hot-path indexes for active memberships, finished-job archives, assignee/date job cursors, document date filters, clients pagination/search, active inventory catalogs, tax reservations, tax OAuth callbacks, and support queues
  - `contact_requests.subject` column and UUID `upgrade_requests.company_id`
  - `document_tasks.lock_key` plus active uniqueness on `(company_id, task_type, lock_key)`
  - `redeem_company_invite(...)` atomic invite redemption RPC
  - `claim_tax_invoice_idempotency(...)` atomic tax idempotency claim RPC
  - `allocate_company_counter`, `allocate_system_counter`, `increment_rate_limit_bucket`, `apply_inventory_movement(...)`, `apply_inventory_pick_batch(...)`, `get_clients_page(...)`, `get_company_inventory_page(...)`, `get_member_inventory_page(...)`, and `bump_company_sync_version(...)` RPCs
  - `apply_job_inventory_consumption_batch(...)` for atomic finished-job inventory consumption
  - `create_job_with_details(...)` for atomic job creation
  - `register_business_account(...)` for atomic business registration
  - role-sensitive RLS for jobs, documents, and membership lists so direct table reads do not rely only on Edge code
  - private-schema privileged RPC implementations with public service-role-only compatibility wrappers
  - explicit `search_path = ''` on trigger functions that execute privileged logic
  - `get_inventory_counts(...)` for lightweight dashboard/count-only reads
  - `cleanup_expired_operational_rows(...)` for scheduled cleanup of expired operational rows
  - partial idempotency indexes for jobs and inventory movements so empty idempotency keys do not bloat uniqueness indexes
  - active membership uniqueness on `(company_id, user_id)` for active memberships only
  - split `inventory_locations` uniqueness for company-only rows vs membership-scoped rows

Migration `0006_api_security_foundation.sql` additionally establishes the future
main API database boundary:

- `smart_job_api` is a least-privileged login role with explicit grants and
  bounded statement, lock, and idle-transaction timeouts. The migration does
  not assign a password; provision it out of band and inject the runtime
  connection URL through Secret Manager or another environment secret store.
- `private.set_api_request_context(...)` records the authenticated `sub` and
  transaction-local timeouts before each API transaction. Role/company access
  continues to come from SQL membership data.
- `private.web_sessions` stores SHA-256 session/CSRF hashes and encrypted
  Supabase credentials; `private.api_idempotency` and
  `private.file_upload_sessions` store bounded replay and upload-finalization
  state.
- `jobs.entity_version` provides opaque optimistic concurrency. The private
  `complete_job_with_details(...)` RPC validates the expected version and
  commits the job finish, optional part replacement, inventory consumption,
  upload-session consumption, attachment rows, and sync-version bumps in one
  transaction.
- `smart_job_api` has no general direct write grant on public ERP tables and no
  execute grant on legacy privileged RPCs that trust caller-provided identity.
- Migration `0016_upload_session_idempotency_limits.sql` also removes direct
  runtime writes to `private.file_upload_sessions`. The API must use the narrow
  prepare/signing-failure RPCs with a prior idempotency claim. Preparation uses
  a committed 12-session/10-minute user limiter, a transaction-serialized
  four-pending-session user/workspace quota, and one-minute expiry response
  floor. Replays sign fresh URLs and three initial signing failures enqueue the
  canonical manifest for the migration `0009` cleanup worker.
- Migration `0018_api_client_mutations.sql` adds client entity versions, the
  default active-list cursor index, reference lookup indexes, and API-only
  create/update/delete-or-archive functions. Runtime table writes remain
  revoked. Live acceptance must cover manager/user/basic authority, worker and
  cross-tenant denial, idempotent replay, stale-version 409, referenced-client
  archival, unreferenced deletion, and concurrent `client_no` allocation.
- Migration `0019_api_inventory_mutations.sql` adds part/balance entity
  versions and API-only inventory mutation RPCs. Runtime table writes remain
  revoked. Acceptance covers manager versus worker authority, self-member
  adjustment, cross-tenant denial, idempotent replay, stale and insufficient
  stock conflicts, concurrent writes, atomic transfer/pick, zero-company/member-stock archive,
  and same-transaction inventory sync bumps.
- Migration `0021_api_job_mutations.sql` adds API-only, version-checked job
  metadata/client/assignee update, manager/dev acceptance, and guarded deletion
  RPCs. Live acceptance covers SQL-derived tenant/module/role/assignment
  authority, idempotent replay, stale-version 409, rejection of direct PATCH
  completion, pending/waiting-only acceptance, and deletion conflicts for
  certificates, document links, inventory movements, upload sessions, and
  attachments. The runtime role retains no direct job-table writes.
- Migration `0025_post_0024_metadata_baseline.sql` intentionally changes no
  schema. It brings Drizzle metadata up to the schema produced through `0024`;
  the loopback-only `test:migrations` command verifies the fingerprint before
  applying later migrations.
- Migrations `0026`–`0030` add accepted-job inventory consumption, dedicated
  least-privilege PDF/email/archiver roles, private durable email/tax/archive
  state, opaque ID-only worker dispatch, lease-token completion, and the
  authoritative tax transaction/outbox. New private objects remain outside the
  Data API and runtime roles receive only named private RPC grants.

Database profiling:

- Use `packages/db/perf/profiling.sql` against local or staging data with realistic row counts before adding broad indexes or dropping unused indexes.
- The profiling checklist uses `pg_stat_statements`, Supabase `index_advisor`, Supabase Security/Performance Advisors, and representative `EXPLAIN (analyze, buffers)` targets for clients, jobs, documents, inventory, tax, and support paths.
- Schedule `cleanup_expired_operational_rows()` daily through Supabase Scheduled Functions, pg_cron, or an external trusted job if the project accumulates rate-limit, document task, notification, contact, or failed idempotency rows.
- Migration `0009` exposes service-role-only
  `queue_expired_file_upload_cleanup(...)`,
  `claim_file_upload_cleanup_batch(...)`, and
  `finish_file_upload_cleanup(...)` wrappers. Claims use skip-locked leases and
  return only canonical session object paths; malformed/cross-prefix manifests
  and exhausted fifth attempts remain as `cleanup_failed` rows for review.

Minimum steps:

1. Provision PostgreSQL.
2. Set `DATABASE_URL` for backend services.
3. Run migrations from `packages/db`.
4. Verify backend services can connect before deploying Supabase Edge Functions or Cloud Run.

Do not add direct client SQL access for protected ERP operations.

## 9. Local Development

### Isolated local Supabase

`supabase/config.toml` owns a dedicated Docker Desktop stack with
`project_id = "smart-job-erp-local"`. It must not reuse containers, volumes, or
ports from another Supabase project. The reserved ports are:

| Service | Port |
|---|---:|
| Shadow database | `55320` |
| API gateway | `55321` |
| PostgreSQL | `55322` |
| Studio | `55323` |
| Inbucket UI | `55324` |
| Inbucket SMTP | `55325` |
| Inbucket POP3 | `55326` |
| Analytics | `55327` |
| Pooler (when enabled) | `55329` |
| Edge inspector | `55883` |

Start and inspect only this project from the repository root:

```powershell
supabase start
supabase status
```

The Supabase CLI migration/seed directories are disabled in
`supabase/config.toml`; `packages/db/migrations` remains the single application
migration source. For a clean local database, reset the Supabase database and
then run Drizzle explicitly:

```powershell
supabase db reset --local --no-seed
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
$env:DATABASE_SSL_MODE = "disable"
npm --prefix packages/db run db:migrate
npm --prefix packages/db run test:integration
supabase db lint --local --schema public,private --level warning
```

Do not use `supabase stop --all`; if the stack needs to be stopped, target this
project from its configured workdir. Never copy local generated API keys or the
database password into tracked files.

### Package development

Common commands:

```bash
npm --prefix website run dev
npm --prefix website run typecheck
npm --prefix website run test

npm --prefix phone_app run start
npm --prefix phone_app run typecheck
npm --prefix phone_app run test
npm --prefix phone_app run doctor

npm --prefix packages/api-contracts run test
npm --prefix cloudrun-api run test
npm --prefix cloudrun-tax run test
```

If you use emulators, keep local website origins in `CORS_ALLOWED_ORIGINS` and point client envs to emulator origins explicitly.

The mobile notification module uses pinned `react-native-notify-kit` for the
Notifee-compatible local API surface. Firebase Messaging still owns remote push
delivery; iOS config therefore uses `handleRemoteNotifications: false`. Rebuild
the native development client after installing or changing this native module.
Android uses the versioned private channel `smart_job_private_v2`; keep the new
ID because Android does not reliably replace privacy settings on an existing
channel. Push registration generates one UUID-like device ID in SecureStore and
sends it in both register and clear requests.

## 10. Cloud Run API And Tax Workflow

Build and test the non-deployed foundations locally after their file
dependencies:

```bash
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run build
npm --prefix packages/db run build
npm --prefix cloudrun-api run test
npm --prefix cloudrun-tax run test
npm --prefix cloudrun-email run test
```

`cloudrun-api` now includes the least-privileged Postgres runtime, Supabase
JWKS/Bearer validation, opaque web sessions, bounded domain APIs, opaque
document/email dispatch, authoritative document workflow detail, and the tax
creation/submission outbox. Domain routes accept exactly one `Bearer` or
`SmartJobSession` credential. The isolated runtime integration test is enabled
with:

```powershell
$env:SMART_JOB_TEST_ADMIN_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
npm --prefix cloudrun-api run test
```

The test temporarily provisions a random local `smart_job_api` password and
removes it during cleanup; no runtime password is committed. `cloudrun-tax`
uses separate `MAIN_API_AUDIENCE` and `TAX_GATEWAY_AUDIENCE` values: the first
is used for its outbound main-API identity token and the second verifies tokens
received by `/api/v1/tax/approval`. Configure both the main API and tax gateway
with public Cloud Run ingress so Supabase bearer/session authentication and
callback HMAC verification can run in the application handlers.

Main API production configuration additionally requires all four Pub/Sub
settings (`DOCUMENT_PUBSUB_PROJECT_ID`, `DOCUMENT_PREVIEW_TOPIC`,
`DOCUMENT_GENERATE_TOPIC`, and `EMAIL_DELIVERY_TOPIC`) plus Google internal
identity settings. Keep `TAX_SUBMISSION_MODE=disabled` at platform launch.
Sandbox/production modes additionally require exact `TAX_GATEWAY_URL` and
`TAX_GATEWAY_AUDIENCE` service origins.

The new API/tax Dockerfiles, Cloud Run service settings, IAM, Artifact Registry, OIDC/WIF, and
environment rollout remain deployment-configuration changes and require the
separate implementation checkpoint.

## 11. Cloud Run PDF Service

`cloudrun-pdf/` is responsible for preview and generate flows.

Required deployment concerns:

- OIDC verification for Pub/Sub push requests
- optional shared `x-pubsub-token` hardening if configured
- SQL access for task and document finalization in SQL mode
- a `DATABASE_URL` that authenticates as `smart_job_pdf` in production
- `SUPABASE_URL` plus a dedicated server-only `SUPABASE_SECRET_KEY` (`sb_secret_...`)
- `SUPABASE_STORAGE_BUCKET=smart-job-company-files` (optional because this exact canonical value is the only accepted/default value)
- environment for tax and document generation as required by the service
- trusted invocations from `supabase/functions/` for preview/generate task dispatch

The secret key bypasses Storage RLS and must remain in Secret Manager/Cloud Run
only. Do not expose it to website or mobile bundles and do not log it. Migration
`0008_pdf_supabase_storage.sql` keeps the canonical bucket private and adds
`application/pdf` to its existing image MIME allowlist.

Preserve these invariants:

- create-only semantics for new generated PDFs and documents across all document types
- SHA-256 byte verification before an identical duplicate object is reused on retry
- retain create-only objects across ambiguous signing/SQL failures so a committed row cannot point at a compensating-deleted file; remove only confirmed orphans through operational cleanup
- canonical `storagePath` persistence instead of durable URLs
- document finalization must refuse to overwrite an existing SQL `storage_path`
- object paths use internal company/document UUIDs; preview task keys are hashed before path construction
- document finalization and `documents_version` advancement share one SQL transaction

## 12. Cloud Run Email Worker

`cloudrun-email/` receives authenticated Pub/Sub pushes containing only a
`deliveryId`. It claims canonical tenant, recipient, document, and storage
state through the `smart_job_email` private SQL RPCs, signs a bounded Supabase
Storage download URL, submits to AWS SES, and records the provider result.

Required environment:

```dotenv
DATABASE_URL=postgresql://smart_job_email:...@.../postgres
DATABASE_SSL_MODE=require
CLOUD_RUN_SERVICE_URL=https://...
PUBSUB_ALLOWED_SERVICE_ACCOUNTS=...@....gserviceaccount.com
SUPABASE_URL=https://....supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=smart-job-company-files
AWS_REGION=eu-central-1
SES_FROM_EMAIL=documents@example.com
SES_FROM_NAME=Smart-Job
```

Do not automatically retry an ambiguous network/timeout result after SES may
have received the request. The database converts it to `delivery_unknown`; an
authorized manager/dev must explicitly retry. Definite pre-send failures and
provider-rejected transient failures may return to `queued`.

## 13. Cloud Run Archiver

`cloudrun-archiver/` is the monthly archive job.

Required deployment concerns:

- access to source data
- a dedicated `smart-job-archiver-database-url` secret whose database role can
  perform the archiver's direct archive-run writes and exact source-row deletes;
  do not reuse the least-privileged `smart_job_api` runtime credential
- Cloud Storage archive bucket access
- `SUPABASE_URL` plus a dedicated `SUPABASE_SECRET_KEY` (`sb_secret_...`) for
  bounded abandoned-upload cleanup; the opaque key is sent only as `apikey`
- optional cleanup bounds: `UPLOAD_CLEANUP_BATCH_SIZE` (1-100, default 25),
  `UPLOAD_CLEANUP_LEASE_SECONDS` (30-900, default 300),
  `UPLOAD_CLEANUP_CONCURRENCY` (1-10, default 4), and
  `UPLOAD_CLEANUP_HTTP_TIMEOUT_MS` (1000-12000, default 10000)
- scheduler or manual job trigger
- checksum verification before delete
- image builds must use repo-root Docker context because `cloudrun-archiver` depends on local `packages/db` and `packages/contracts`

Preserve these invariants:

- upload cleanup is a separately reported startup phase and must not block the
  monthly archive phase
- cleanup deletes only exact paths from a claimed canonical
  `smart-job-company-files` manifest; it never recursively deletes a prefix,
  deletes consumed/finalized work, or reconciles generated PDFs
- archive manifests are idempotent
- month exports must drain every read-model page instead of relying on a single large query
- archive payloads should be streamed to disk/storage instead of loading a full month into memory
- date filtering respects ISO-string date storage
- deletion uses only the exact IDs captured in the verified archive
- manifests must remain resumable: `uploaded_not_deleted` retries verify the archive and can mark the manifest `deleted` when records are already gone, instead of failing on exact-count mismatches

## 14. Supabase Migration Workspace

The `supabase/` directory contains the in-repo backend runtime and migration hardening work.

Use these docs when working there:

- `SUPABASE-MIGRATION-GUIDE.md`
- `supabase/README.md`

If you still operate legacy Firebase backend paths outside this repository, keep rollback paths available until your production rollout is fully complete.

The approved database foundation does not authorize removing those legacy paths.
Cloud Run deployment/IAM workflow, custom API DNS mapping, and Playwright E2E
CI are implemented. Remaining mobile Edge caller cutover is the final step.
website/mobile cutovers, remaining non-PDF Storage unification, and final Edge/Firebase
directory deletion remain separate future approval gates.

The `website_e2e` CI job runs only when the repository variable
`RUN_WEBSITE_E2E` is set to `true`. Configure the repository secrets
`E2E_BASE_URL`, `E2E_TEST_EMAIL`, and `E2E_TEST_PASSWORD` for a seeded,
non-production test account before enabling it. Local Playwright runs still
exercise unauthenticated flows when credentials are absent and skip only the
authenticated scenarios.

## 15. Deployment Order

Recommended high-level order:

1. Provision Firebase, GCP APIs, PostgreSQL, and Supabase.
2. Apply expand-only SQL migrations through `0030` using the dedicated
   migration credential; runtime services never receive it.
3. Configure API, website, worker, tax, and remaining compatibility secrets.
4. Deploy the main API with tax mode disabled, then the private PDF/email
   workers and their authenticated Pub/Sub subscriptions/drain schedules.
5. Deploy `cloudrun-tax` in the Israel region, but do not enable authority
   submission until certification gates pass.
6. Deploy `cloudrun-archiver` and retain the compatibility Edge functions still
   required by the current mobile binary.
7. Configure website hosting, build/release mobile apps, and validate document,
   email, tax-disabled, and archive paths before traffic promotion.

CI/CD evidence:

- The Edge deploy workflow has been removed. Remaining Edge functions are
  retained for mobile screens not yet cut over to the Cloud API.
- Required repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`.

## 16. Post-Setup Checks

Verify:

- website login, registration, and onboarding
- mobile sign-in and protected operation routing
- backend SQL connectivity
- document preview and generate flows
- tax creation returns unavailable while production mode is disabled
- sandbox approval alone creates a final PDF task; reserved/submitted/rejected/failed states do not
- email timeout ambiguity becomes `delivery_unknown` rather than an automatic resend
- approved tax invoices cannot be deleted
- signed URL flows for documents and job files
- solo mobile job creation uploads attachments first and succeeds with temp `attachmentUploadId` references before the final job number exists
- push-token updates and notification paths
- archive creation and retrieval

## 17. Canonical Documentation Rule

If setup or deployment guidance changes, update this file instead of creating another setup-only markdown file.
