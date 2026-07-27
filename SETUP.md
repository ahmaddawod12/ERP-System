# Smart-Job ERP Setup Guide

This is the canonical setup and deployment guide for the current Smart-Job ERP stack.

It reflects the July 22, 2026 architecture after the completed Edge-to-Cloud-API
cutover:

- Supabase Auth for website and mobile sign-in
- The Cloud Run API (`cloudrun-api`) as the sole backend trust boundary
- PostgreSQL as the primary company-scoped ERP persistence layer
- Supabase Storage for job attachments and generated documents; GCS for monthly
  archives
- Cloud Run services for API, tax gateway, PDF generation, durable SES email,
  and archiving
- Firebase Messaging and Crashlytics for mobile push notifications and native
  crash reporting; Firebase Storage, Firestore, and App Check have been removed
- Tax stays disabled pending certification

## 1. Repository Components

```text
ERP-System/
|-- website/             Next.js website
|-- phone_app/           Expo mobile app
|-- cloudrun-api/        Main Fastify API foundation
|-- cloudrun-tax/        Stateless Israel tax gateway foundation
|-- cloudrun-pdf/        PDF preview/generation service
|-- cloudrun-email/      Durable SES document-email worker
|-- cloudrun-archiver/   Archive batch job
|-- cloudrun-migrations/ Dedicated migration and internal smoke image
|-- infra/               Terraform modules and dev/staging/prod roots
|-- packages/contracts/  Shared enums/constants/path helpers
|-- packages/api-contracts/ Shared Zod HTTP contracts
|-- packages/db/         PostgreSQL schema, migrations, access layer
`-- supabase/            Local CLI configuration and Auth email templates
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
- Terraform 1.14.3 and TFLint 0.64.0 for Batch 8 infrastructure validation

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

Create or configure Firebase for mobile push/crash reporting:

1. Create a Firebase project.
2. Upgrade to Blaze.
3. Enable Cloud Messaging.
4. Enable Crashlytics and register the Android and iOS applications.
5. Download the native Firebase configuration files used by Messaging and
   Crashlytics. Do not enable Firebase Auth, Firestore, or Storage for ERP data.

The production platform has a narrow manual bootstrap boundary. Pre-create one
billed GCP project per environment and one versioned, encrypted,
uniformly-controlled GCS Terraform-state bucket. Use a separate state prefix
from each `infra/environments/*/backend.hcl.example`. Terraform then owns the
service APIs, Artifact Registry, IAM, network/NAT, static egress, DNS/TLS/load
balancing, Cloud Armor, workloads, queues, schedules, data buckets, monitoring,
and GitHub WIF. See `infra/README.md` for the staged three-apply bootstrap.

Secret payloads are populated out of band after the foundation apply. Record
only their numeric enabled versions in the ignored `terraform.tfvars`; never
put secret bytes in Terraform, CI variables, or the repository.

## 4. Install Dependencies

There is no root package-manager workspace. Install packages individually:

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix packages/observability install
npm --prefix packages/observability run build
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-api install
npm --prefix cloudrun-tax install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-email install
npm --prefix cloudrun-archiver install
npm --prefix cloudrun-backup install
```

Sanitized templates exist for every environment-consuming package:
`website/.env.example`, `phone_app/.env.example`, `packages/db/.env.example`,
and each `cloudrun-*/.env.example`. Copy them only into the package that owns
the variables. Shared contracts and observability packages require no
environment file. Serving workloads preload
`@smart-job/observability/register`; telemetry stays off unless
`OTEL_ENABLED=true`.

Apply SQL migrations for the target database:

```bash
npm --prefix packages/db run db:migrate
```

On a disposable loopback database, `npm --prefix packages/db run
test:migrations` applies the single baseline through Drizzle, verifies its
critical schema/security surface, and proves a second migration run is a no-op.
Reset the local Supabase database afterward before the normal Drizzle migration
run.

## 5. Website Environment

Copy `website/.env.example` to `website/.env.local` and replace every
placeholder:

```dotenv
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_AUTH_TIMEOUT_MS=8000
BACKEND_API_BASE_URL=
BACKEND_API_TIMEOUT_MS=12000
WEBSITE_ORIGIN=
WEBSITE_SESSION_SECRET=
CONTACT_CHALLENGE_SECRET=          # optional; falls back to WEBSITE_SESSION_SECRET
RECAPTCHA_ENTERPRISE_PROJECT_ID=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
RECAPTCHA_ENTERPRISE_MIN_SCORE=0.7
RECAPTCHA_ENTERPRISE_TIMEOUT_MS=8000
```

Notes:

- `SUPABASE_URL` and the publishable key are server-only Auth configuration.
- `BACKEND_API_BASE_URL` is an exact Cloud Run API origin; production requires
  HTTPS. The browser never calls it directly.
- `WEBSITE_ORIGIN` must exactly match mutation Origin headers.
- `WEBSITE_SESSION_SECRET` contains at least 32 random characters and signs only
  recovery/challenge state. The API owns encrypted opaque session credentials.
- Production uses `__Host-sj_web_session` (HttpOnly) plus readable `sj_csrf` for
  double-submit CSRF. Supabase credentials never enter browser JavaScript.
- The website has no Firebase, Edge-function, anon-key, service-role, or split
  legacy-cookie configuration.

## 6. Mobile Environment And Native Files

The mobile app still requires Firebase native app registration for the installed services it uses.

For EAS, create file-secret variables in each `development`, `preview`, and
`production` environment:

- `GOOGLE_SERVICES_JSON` containing `google-services.json`
- `GOOGLE_SERVICE_INFO_PLIST` containing `GoogleService-Info.plist`

For local prebuilds only, place the two ignored files directly in `phone_app/`.
They must remain untracked.

Configure mobile envs as needed:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_BACKEND_API_BASE_URL=
```

Notes:

- Registration and onboarding remain website-only.
- Mobile Supabase transport tokens are stored in Expo SecureStore, separate from the general cache MMKV store.
- General MMKV stores non-sensitive cache and identity hints only; do not store access or refresh tokens there.
- Push notification listeners and token registration are attached after authenticated cache bootstrap succeeds for the active session; Android channel setup is safe to call more than once.

## 7. Supabase Local Environment

`supabase/config.toml` owns only the isolated local Auth/Postgres/Storage stack
and Auth email templates. No Edge runtime remains, so there is no application
`supabase/.env` and no Edge CORS, service-role, JWT, Firebase fallback, tax, PDF,
or archive dispatch configuration.

Use `scripts/local-platform.ps1` for the complete stack. It obtains the local
Supabase publishable/secret values, generates dedicated database-role passwords
and emulator tokens, and writes them only to ignored
`local-platform/.env.generated`. Do not copy those values into package examples
or set `SMART_JOB_LOCAL_PLATFORM*` / marker paths manually.

For direct package development, use the loopback values in the relevant
package's `.env.example`. Production uses current publishable/secret key formats
only in the trusted workloads documented there; browser/mobile bundles never
receive a Supabase secret key.

## 8. SQL Setup

`packages/db` is the canonical SQL schema and migration surface.

Current migration shape:
- Empty/new databases apply only `0000_baseline.sql`. The pre-production
  incremental history through the former `0035` tail was squashed into this
  baseline. Reset any development database whose Drizzle history predates the
  squash before running `db:migrate`.
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
  - role-sensitive RLS for jobs, documents, and membership lists as a second line of defense
  - private-schema privileged RPC implementations with public service-role-only compatibility wrappers
  - explicit `search_path = ''` on trigger functions that execute privileged logic
  - `get_inventory_counts(...)` for lightweight dashboard/count-only reads
  - `cleanup_expired_operational_rows(...)` for scheduled cleanup of expired operational rows
  - partial idempotency indexes for jobs and inventory movements so empty idempotency keys do not bloat uniqueness indexes
  - active membership uniqueness on `(company_id, user_id)` for active memberships only
  - split `inventory_locations` uniqueness for company-only rows vs membership-scoped rows

The consolidated baseline establishes the main API database boundary:

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
- Attachment session hardening removes direct
  runtime writes to `private.file_upload_sessions`. The API must use the narrow
  prepare/signing-failure RPCs with a prior idempotency claim. Preparation uses
  a committed 12-session/10-minute user limiter, a transaction-serialized
  four-pending-session user/workspace quota, and one-minute expiry response
  floor. Replays sign fresh URLs and three initial signing failures enqueue the
  canonical manifest for the bounded cleanup worker.
- Client mutation hardening adds client entity versions, the
  default active-list cursor index, reference lookup indexes, and API-only
  create/update/delete-or-archive functions. Runtime table writes remain
  revoked. Live acceptance must cover manager/user/basic authority, worker and
  cross-tenant denial, idempotent replay, stale-version 409, referenced-client
  archival, unreferenced deletion, and concurrent `client_no` allocation.
- Inventory mutation hardening adds part/balance entity
  versions and API-only inventory mutation RPCs. Runtime table writes remain
  revoked. Acceptance covers manager versus worker authority, self-member
  adjustment, cross-tenant denial, idempotent replay, stale and insufficient
  stock conflicts, concurrent writes, atomic transfer/pick, zero-company/member-stock archive,
  and same-transaction inventory sync bumps.
- Job mutation hardening adds API-only, version-checked job
  metadata/client/assignee update, manager/dev acceptance, and guarded deletion
  RPCs. Live acceptance covers SQL-derived tenant/module/role/assignment
  authority, idempotent replay, stale-version 409, rejection of direct PATCH
  completion, pending/waiting-only acceptance, and deletion conflicts for
  certificates, document links, inventory movements, upload sessions, and
  attachments. The runtime role retains no direct job-table writes.
- The single journal entry and `0000_snapshot.json` represent the complete
  baseline. The loopback-only `test:migrations` command applies it on a fresh
  isolated database and verifies that a second Drizzle migration run is a no-op.
- The baseline includes accepted-job inventory consumption, dedicated
  least-privilege PDF/email/archiver roles, private durable email/tax/archive
  state, opaque ID-only worker dispatch, lease-token completion, and the
  authoritative tax transaction/outbox. New private objects remain outside the
  Data API and runtime roles receive only named private RPC grants.

Database profiling:

- Use `packages/db/perf/profiling.sql` against local or staging data with realistic row counts before adding broad indexes or dropping unused indexes.
- The profiling checklist uses `pg_stat_statements`, Supabase `index_advisor`, Supabase Security/Performance Advisors, and representative `EXPLAIN (analyze, buffers)` targets for clients, jobs, documents, inventory, tax, and support paths.
- Schedule `cleanup_expired_operational_rows()` daily through Supabase Scheduled Functions, pg_cron, or an external trusted job if the project accumulates rate-limit, document task, notification, contact, or failed idempotency rows.
- The baseline exposes service-role-only
  `queue_expired_file_upload_cleanup(...)`,
  `claim_file_upload_cleanup_batch(...)`, and
  `finish_file_upload_cleanup(...)` wrappers. Claims use skip-locked leases and
  return only canonical session object paths; malformed/cross-prefix manifests
  and exhausted fifth attempts remain as `cleanup_failed` rows for review.

Minimum steps:

1. Provision PostgreSQL.
2. Set `DATABASE_URL` for backend services.
3. Run migrations from `packages/db`.
4. Verify backend services can connect before deploying Cloud Run services.

Do not add direct client SQL access for protected ERP operations.

## 9. Local Development

### One-command local platform (recommended)

The production-shaped local checkpoint uses two owners on one explicit Docker
network:

- Supabase CLI owns PostgreSQL 17, Auth, Storage, Studio, and its supporting
  services for `project_id = "smart-job-erp-local"`.
- `compose.local.yml` owns the standalone non-root website, main API, disabled
  tax gateway, PDF/email workers, the durable local Pub/Sub/identity adapter,
  fake GCS for archive objects, and Mailpit for SES-compatible test delivery.

Start Docker Desktop first, then run from the repository root:

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
```

`start` creates the labeled external network `smart-job-local`, starts
Supabase with `--network-id smart-job-local`, generates stable local-only
credentials, applies all Drizzle migrations, bootstraps the
`smart_job_api|pdf|email|archiver` passwords, builds the images, and waits for
readiness. It never writes a credential to a tracked file; the runtime file is
`local-platform/.env.generated` and is ignored.

| Local surface | URL |
|---|---|
| Website | `http://127.0.0.1:3000` |
| Main API | `http://127.0.0.1:58081` |
| Tax gateway (submission disabled) | `http://127.0.0.1:58082` |
| PDF readiness endpoint | `http://127.0.0.1:58083/readyz` |
| Local adapter | `http://127.0.0.1:58084/readyz` |
| Email readiness endpoint | `http://127.0.0.1:58085/readyz` |
| Mailpit UI | `http://127.0.0.1:58025` |
| Fake GCS | `http://127.0.0.1:58080` |
| Supabase API / Studio | `http://127.0.0.1:55321` / `http://127.0.0.1:55323` |

Compose publishes its application and emulator ports on loopback only. The
Supabase CLI owns its separate port bindings and the supported CLI version has
no bind-address flag; keep Docker Desktop behind the host firewall and use a
trusted network whenever a physical device connects over the LAN.

Lifecycle commands:

```powershell
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes
.\scripts\local-platform.ps1 archive
```

`stop` preserves named volumes. `reset -Yes` destroys only this Compose
project's queues, fake archives, test email, and the configured local Supabase
database, then recreates them. It never calls `supabase stop --all`.
`status` captures the Supabase status internally and never prints its local
publishable, secret, database, or S3 credentials.

The adapter persists opaque Pub/Sub messages before push, retries boundedly,
moves exhausted messages to its local dead-letter directory, supplies only a
marker-gated local service identity token, invokes the document/email outbox
drains, and translates SES `SendEmail` requests to Mailpit. Supabase Storage
remains the local backend for active files/PDFs; fake GCS represents only the
separate archive bucket.

The `archive` command is deliberately opt-in. It authenticates as the generated
least-privilege `smart_job_archiver` role and exercises the same leased,
immutable record/ID-object protocol used by the deployed job. The removed
`ALLOW_LOCAL_ARCHIVER_ADMIN` compatibility path is rejected.

Every local-only service override requires the exact Compose flags and mounted
`/run/secrets/smart_job_local_platform` marker. The website's production-mode
entrypoint validates the marker before enabling loopback HTTP cookies. Without
that proof, production HTTPS/database/identity checks remain fail-closed.

The phone app is not containerized. Run Expo on the host and use the backend
port above (or the development machine's LAN address for a physical device).

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

The following manual commands are for database troubleshooting. Prefer the
lifecycle command above for the complete platform. Start and inspect only this
project from the repository root:

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

The mobile notification module uses pinned `react-native-notify-kit` for the
Notifee-compatible local API surface. Firebase Messaging still owns remote push
delivery; iOS config therefore uses `handleRemoteNotifications: false`. Rebuild
the native development client after installing or changing this native module.
Android uses the versioned private channel `smart_job_private_v2`; keep the new
ID because Android does not reliably replace privacy settings on an existing
channel. Push registration generates one UUID-like device ID in SecureStore and
sends it in both register and clear requests.

## 10. Cloud Run API And Tax Workflow

Build and test the services locally after their file dependencies:

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
behind their approved ingress. External website/mobile traffic reaches the API
through the HTTPS load balancer; internal routes still require Google service
identity. The tax callback endpoint additionally verifies its HMAC contract.

Main API production configuration additionally requires all four Pub/Sub
settings (`DOCUMENT_PUBSUB_PROJECT_ID`, `DOCUMENT_PREVIEW_TOPIC`,
`DOCUMENT_GENERATE_TOPIC`, and `EMAIL_DELIVERY_TOPIC`) plus Google internal
identity settings. Keep `TAX_SUBMISSION_MODE=disabled` at platform launch.
Sandbox/production modes additionally require exact `TAX_GATEWAY_URL` and
`TAX_GATEWAY_AUDIENCE` service origins.

Batch 8 Terraform is the production source of truth. The release workflow uses
the Terraform-created WIF identities and service/job names; it does not create
or repair IAM, networking, queues, DNS, or monitoring.

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
- trusted invocations from the Cloud Run API for preview/generate task dispatch

The secret key bypasses Storage RLS and must remain in Secret Manager/Cloud Run
only. Do not expose it to website or mobile bundles and do not log it. The
consolidated baseline keeps the canonical bucket private and adds
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
  authenticate as `smart_job_archiver` and execute only the baseline's archive
  RPCs; it has no direct ERP-table writes
- Cloud Storage archive bucket access
- `SUPABASE_URL` plus a dedicated `SUPABASE_SECRET_KEY` (`sb_secret_...`) for
  bounded abandoned-upload cleanup; the opaque key is sent only as `apikey`
- optional cleanup bounds: `UPLOAD_CLEANUP_BATCH_SIZE` (1-100, default 25),
  `UPLOAD_CLEANUP_LEASE_SECONDS` (30-900, default 300),
  `UPLOAD_CLEANUP_CONCURRENCY` (1-10, default 4), and
  `UPLOAD_CLEANUP_HTTP_TIMEOUT_MS` (1000-12000, default 10000)
- scheduler or manual job trigger
- one task, a 60-minute task timeout, two retries, and an internal 55-minute
  deadline (`ARCHIVER_JOB_DEADLINE_MS=3300000`)
- bounded query pages (maximum 500), historical candidate discovery (maximum
  2,000 company/month/type rows), and company concurrency (maximum 4)
- image builds must use repo-root Docker context because `cloudrun-archiver` depends on local `packages/db` and `packages/contracts`

Preserve these invariants:

- upload cleanup is a separately reported startup phase and must not block the
  monthly archive phase
- cleanup deletes only exact paths from a claimed canonical
  `smart-job-company-files` manifest; it never recursively deletes a prefix,
  deletes consumed/finalized work, or reconciles generated PDFs
- a company/month/type claim is lease- and advisory-lock protected; empty claims
  release without permanently closing the month, and bounded candidate discovery
  revisits older months when late historical rows appear
- immutable record and companion ID objects use GCS `ifGenerationMatch=0`
- month exports stream every bounded SQL page to disk rather than retaining a
  whole month in memory
- deletion resumes from the verified ID object and advances only in exact
  chunks of at most 500

## 14. Supabase Migration Workspace

The `supabase/` directory contains local CLI configuration and Auth email
templates. Application migrations and backend runtime code live under
`packages/db/` and `cloudrun-api/` respectively.

Use these docs when working there:

- `backend.md`
- `architecture.md`

Cloud Run deployment, Terraform-owned Cloud Armor policies, and mandatory
Playwright E2E CI are implemented. Each website/API policy includes separate
per-IP auth and contact throttles in addition to its managed WAF and global
backend limit; there is no manual post-deploy policy script or policy-name
secret to drift from Terraform. Cloud Run ingress prevents a bypassing direct
domain mapping. The
Edge-to-Cloud-API cutover is complete; all Supabase
Edge functions and handlers have been deleted. Firebase Messaging and
Crashlytics remain for push notifications and native crash reporting.
Production tax submission
remains disabled pending certification, and stable API DNS is a mobile-release
gate.

The `website_e2e` job always runs against a self-contained strict fixture API,
so it needs no external credentials. It verifies authenticated login/reload/
logout, unauthenticated redirects, exact tenant boundaries, and absence of
Supabase credentials in browser-visible state. The mandatory `mobile_e2e` job
uses Maestro Cloud and requires the repository configuration documented in
`phone_app/MOBILE_ROLLOUT.md`.

## 15. Deployment Order

Recommended high-level order:

1. Pre-create billed projects and the protected Terraform-state bucket.
2. Apply each environment root with `enable_runtime=false`.
3. Populate numbered Secret Manager versions, configure GitHub environment
   variables/reviewers, and record the purchased Supabase connection ceiling.
4. Build/sign the migration image, set `enable_release_jobs=true`, apply, and
   execute the migration job before any serving workload exists.
5. Enter all seven immutable digests and numbered secret versions, then apply
   with `enable_runtime=true` while public DNS remains undelegated.
6. Dispatch the `candidate` release stage. It runs the dedicated expand-only
   migration job, creates no-traffic revisions, and executes internal smoke.
7. Dispatch separate `10`, `50`, and `100` stages, observing alerts and SLOs
   between steps. Production requires the protected environment approval.
8. Keep tax submission disabled until the separate certification approval and
   finish website/mobile validation only after the platform reaches 100%.

CI/CD evidence:

- The Edge deploy workflow has been removed. All Supabase Edge functions and
  handlers have been deleted; mobile and website callers use the Cloud Run API
  exclusively.
- CI pins all external Actions and container bases by immutable digest, produces
  an SBOM, audits every independent lockfile, and blocks on SAST, secret,
  container, database, Playwright, and Maestro verification.
- Cloud Run release requires the repository and protected-environment variables
  documented in `infra/README.md`. No long-lived GCP key is required.
- Operational preflight, rollback, recovery, replay, and reconciliation steps
  are indexed in `docs/runbooks/README.md`.

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
- migration job isolation, candidate smoke, and 10/50/100 traffic evidence
- DNSSEC, managed-certificate activation, fixed egress IPs, Cloud Armor logs,
  database pool budget, queue/DLQ alerts, and SLO visibility

## 17. Canonical Documentation Rule

Keep installation and topology guidance here. Keep task-specific operational
procedures under `docs/runbooks/` and link them from this guide instead of
duplicating commands in unrelated package READMEs.
