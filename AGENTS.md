# AGENTS.md

> For a concise project overview, see [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md) first.

## Project Context

This repository is a development environment. You are allowed to make normal code changes without asking for permission first.

You may:
- edit existing files
- create new files
- refactor code
- improve structure
- fix bugs
- add or update tests
- run install, build, lint, format, and test commands
- make reasonable performance and quality improvements while working

Do not treat the current state as production. The goal is to improve the project safely and efficiently.

---

## Core Rule

Before making changes, understand the request, inspect the relevant files, and make a short plan.

While working, think about:
- correctness
- simplicity
- performance
- maintainability
- security
- user experience
- edge cases
- future scalability

Prefer clean, minimal changes over large rewrites.

---

## Planning Instructions

For any non-trivial task, create a plan before editing.

The plan should include:
1. What needs to be changed
2. Which files or areas are likely involved
3. Possible risks
4. Tests or checks to run after the change
5. Any performance, optimization, or cleanup opportunities

Do not over-plan small fixes. For tiny changes, inspect the file and make the edit directly.

---

## When Implementing a Feature

When adding a new feature:

1. Understand the existing architecture first.
2. Find the closest existing pattern and follow it.
3. Keep the implementation simple and consistent.
4. Add or update types, validation, and error handling.
5. Update UI states if relevant:
   - loading
   - success
   - empty state
   - error state
   - disabled state
6. Add tests when a test structure exists.
7. Update documentation or comments only when helpful.
8. Run relevant checks before finishing.
9. Summarize exactly what changed.

Do not add unnecessary abstractions. Only generalize code when there is a clear repeated pattern.

---

## When Fixing a Bug

When fixing a bug:

1. Reproduce or reason through the issue.
2. Identify the root cause, not just the symptom.
3. Make the smallest reliable fix.
4. Check for similar bugs nearby.
5. Add a regression test if possible.
6. Run the relevant test/build command.
7. Explain the cause and the fix in the final response.

---

## Optimization and Performance Guidelines

Always consider performance while editing, especially in frequently used paths.

Look for:
- unnecessary re-renders
- repeated network requests
- expensive loops
- duplicated calculations
- large bundle impact
- blocking async work
- inefficient database queries
- missing memoization where useful
- avoidable client-side work
- unnecessary dependency additions

Only optimize when it is useful and justified. Do not make code harder to understand for tiny performance gains.

When making performance changes, explain:
- what was slow or inefficient
- what changed
- why it improves performance
- any tradeoffs

---

## Code Quality Guidelines

Prefer:
- readable code
- clear names
- small functions
- predictable data flow
- strong typing when available
- explicit error handling
- simple interfaces
- consistent formatting
- project conventions over personal preference

Avoid:
- large rewrites without need
- hidden side effects
- duplicate logic
- overly clever code
- unnecessary dependencies
- changing public behavior accidentally
- mixing unrelated changes into one task

---

## Safety Rules

You do not need to ask before normal development edits.

Ask before:
- deleting major files or folders
- changing database schemas or migrations
- adding large dependencies
- changing authentication or authorization logic
- changing payment, billing, or security-sensitive code
- rewriting the project architecture
- removing tests
- modifying deployment configuration
- performing irreversible actions

Never:
- delete user data
- wipe the repository
- force-push
- commit secrets
- expose API keys
- disable security checks just to make tests pass
- ignore failing tests without mentioning them

---

## Dependencies

Before adding a dependency:
1. Check if the project already has a tool/library that solves the problem.
2. Prefer built-in platform features when reasonable.
3. Avoid large dependencies for small utilities.
4. If adding a dependency, explain why it is needed.

---

## Testing and Validation

After changes, run the most relevant available checks.

Common checks may include:
- install/build command
- unit tests
- integration tests
- lint
- formatter
- typecheck
- app-specific validation scripts

If checks cannot be run, explain why.

If a check fails:
1. Try to fix it if it is related to your changes.
2. If unrelated, mention it clearly.
3. Do not hide failing results.

---

## Final Response Format

At the end of the task, respond with:

1. Summary of changes
2. Files changed
3. Tests/checks run
4. Performance or improvement notes, if relevant
5. Anything that still needs review

Keep the final response concise but complete.

---

## Preferred Working Style

Work like a careful senior developer:
- inspect before editing
- plan before large changes
- keep changes focused
- improve nearby code when it clearly helps
- test before finishing
- explain tradeoffs
- avoid unnecessary questions
- make progress with reasonable assumptions

When uncertain, choose the safest reasonable approach and mention the assumption in the final response.
Smart-Job ERP — multi-tenant field-service platform.  
**No root workspace.** Each sub-package is installed and run independently.

---

## Package layout

| Path | Type | Runtime |
|---|---|---|
| `website/` | Next.js 16 App Router | Node 22 |
| `phone_app/` | Expo 57 / React Native 0.86 | Node 22 / EAS |
| `cloudrun-api/` | Modular API with dual auth and initial domain routes | Node 22 |
| `cloudrun-tax/` | Stateless Israel tax gateway foundation | Node 22 |
| `cloudrun-pdf/` | PDF generation service | Node 22 |
| `cloudrun-email/` | Durable SES document-email worker | Node 22 |
| `cloudrun-archiver/` | Monthly archive batch job | Node 22 |
| `cloudrun-migrations/` | Dedicated migration and internal smoke image | Node 22 / Cloud Run Jobs |
| `packages/contracts/` | Shared enums/constants (`@smart-job/contracts`) | Node |
| `packages/api-contracts/` | Shared Zod HTTP contracts (`@smart-job/api-contracts`) | Node 22 |
| `packages/db/` | Drizzle ORM schema + migrations (`@smart-job/db`) | Node 22 |

---

## Build order

Build `packages/contracts` first. Build `packages/api-contracts` and
`packages/db` next; `cloudrun-api` needs all three and `cloudrun-tax` needs the
two contracts packages.
`contracts` compiled output (`index.js`) must exist before any package that imports it.
`api-contracts` must be built before either new Fastify service; `db` must also
be built before `cloudrun-api`.

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix packages/db run db:migrate   # apply latest SQL migrations first
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-api install
npm --prefix cloudrun-tax install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-email install
npm --prefix cloudrun-archiver install
```

---

## Developer commands

### website/
```bash
npm --prefix website run dev
npm --prefix website run typecheck      # tsc --noEmit
npm --prefix website run lint           # ESLint 9 + next/core-web-vitals
npm --prefix website run test           # node --test --experimental-strip-types tests/*.test.mts
npm --prefix website run build
```

### phone_app/
```bash
npm --prefix phone_app run typecheck    # tsc --noEmit
npm --prefix phone_app run test         # node --test --experimental-strip-types tests/*.test.mts
npm --prefix phone_app run doctor       # Expo dependency/config validation
npm --prefix phone_app run start        # expo start
```

Keep the Expo 57-supported React/React DOM 19.2.3 pair. Do not upgrade React
independently of the React Native renderer; this mobile client does not use
React Server Components.

### packages/contracts, packages/api-contracts & packages/db
```bash
npm --prefix packages/contracts run typecheck
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run typecheck
npm --prefix packages/api-contracts run test
npm --prefix packages/api-contracts run build
npm --prefix packages/db run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run test
npm --prefix packages/db run test:integration   # requires the isolated local Supabase DB
npm --prefix packages/db run test:migrations    # creates/drops one isolated loopback DB; verifies 0024 upgrade
npm --prefix packages/db run db:generate   # drizzle-kit generate (new migration from schema change)
npm --prefix packages/db run db:migrate    # drizzle-kit migrate (apply to DB)
```

Database profiling before broad index work:
```bash
# Run against local/staging with realistic row counts through psql or Supabase SQL editor
packages/db/perf/profiling.sql
```

### Cloud Run packages
```bash
# Build local file dependencies first.
# Tests internally run `npm run build` first — never skip build
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run build
npm --prefix packages/db run build
npm --prefix cloudrun-api run test
npm --prefix cloudrun-tax run test
npm --prefix cloudrun-pdf run test
npm --prefix cloudrun-email run test
npm --prefix cloudrun-archiver run test
```

### Isolated local Supabase stack

The repository-owned Docker Desktop stack uses `project_id = "smart-job-erp-local"`
from `supabase/config.toml`; do not reuse another project's containers or ports.
Application migrations remain under `packages/db/migrations` and are intentionally
disabled in the Supabase CLI migration directory.

```powershell
supabase start
supabase status

# Fresh local database: reset the Supabase services first, then apply Drizzle migrations.
supabase db reset --local --no-seed
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
$env:DATABASE_SSL_MODE = "disable"
npm --prefix packages/db run db:migrate
npm --prefix packages/db run test:integration
supabase db lint --local --schema public,private --level warning
```

Core ports are API `55321`, PostgreSQL `55322`, Studio `55323`, Inbucket
`55324`, and Edge inspector `55883`; the full allocation is documented in
`SETUP.md`. Never use `supabase stop --all` for this project.

### Complete local platform (recommended)

After starting Docker Desktop, use the repository lifecycle script instead of
manually combining Supabase and Compose:

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes
```

`compose.local.yml` and the Supabase CLI stack share the labeled external
`smart-job-local` network. Generated role passwords and emulator tokens are
stored only in ignored `local-platform/.env.generated`. Do not hand-set the
`SMART_JOB_LOCAL_PLATFORM*` flags: services require the mounted repository
marker, the website derives its verification signal in its entrypoint, and tax
must remain disabled. The optional `archive` command uses the dedicated
`smart_job_archiver` role and the same leased, resumable archive protocol as
the deployed job.

### Repo-level CI scripts
```bash
node scripts/check-no-ts-nocheck.mjs   # blocks CI; run before pushing
node scripts/check-js-syntax.mjs .        # checks .js, .cjs, and .mjs outside generated dirs
node scripts/check-local-platform.mjs  # static Compose/container safeguards
node scripts/check-deployment-security.mjs # Terraform/release/migration/traffic safeguards
node scripts/check-perf-budget.mjs     # blocking pagination/cursor/read-bound safeguards
node scripts/check-maestro-flows.mjs   # required login/tenant/job/offline flows
node scripts/check-supply-chain-pins.mjs # immutable Action/container inputs
node scripts/check-npm-audit.mjs       # live audit + exact expiring exceptions
```

---

## CI (`.github/workflows/ci.yml`)

All jobs run on every push/PR with **Node 22**. A top-level `concurrency` group with `cancel-in-progress: true` avoids redundant runs.

The `repo_guards` job validates the local topology and blocking source/config
guards, and `local_platform_adapter` runs the durable adapter unit tests. Image
CI builds and vulnerability-scans the standalone website, local adapter, and
all Cloud Run images.

- `repo_guards` → syntax/tests + local/deployment/performance/Maestro/supply-chain guards
- `lockfile_audit` → every independent npm lockfile + exact 30-day exception policy
- `codeql` / `secret_scan` / `sbom` → SAST, repository secret scan, SPDX SBOM
- `deno` → check/test every Deno source when present
- `infrastructure_security` → Terraform fmt/validate for dev/staging/prod, tflint, and Trivy
- `packages_contracts` → `npm ci` → typecheck → build
- `packages_api_contracts` → builds `packages/contracts` → `npm ci` → typecheck → test
- `packages_db` → builds `packages/contracts` → `npm ci` → typecheck → build → test
- `website` → builds `packages/contracts` → `npm ci` → **test → typecheck → lint → build** (order matters)
- `phone_app` → builds `packages/contracts` → `npm ci` → test → typecheck → Expo Doctor
- `cloudrun_pdf` → builds both contracts packages → `npm ci` → typecheck → test
- `cloudrun_email` → builds both contracts packages → `npm ci` → typecheck → test
- `cloudrun_archiver` → builds `packages/contracts` + `packages/db` → `npm ci` → typecheck → test
- `cloudrun_api` → builds all three local packages → `npm ci` → typecheck → test
- `cloudrun_tax` → builds contracts packages → `npm ci` → typecheck → test
- `integration_tests` → migration-upgrade verification, clean migrate, DB/API integration, Supabase lint
- `website_e2e` → mandatory self-contained Playwright auth/tenant journeys
- `mobile_e2e` → mandatory Maestro Cloud login/tenant/job/offline journeys
- `cloudrun_images` → one Docker build per image + blocking HIGH/CRITICAL Trivy scan (no push)

The Edge deploy workflow has been removed. All Edge functions and handlers
under `supabase/functions/` and `supabase/handlers/` have been deleted.
Mobile and website callers now use the Cloud Run API exclusively. Firebase
Messaging and Crashlytics remain for push notifications and native crash
reporting; Firebase Storage is no longer a runtime dependency.

---

## @ts-nocheck policy (enforced by CI)

`check-no-ts-nocheck.mjs` blocks new `@ts-nocheck` in:
- `website/src`, `website/tests`
- `phone_app/components`, `phone_app/contexts`, `phone_app/tests`, `phone_app/firebase.ts`
- `phone_app/modules/` (allowlist of legacy files exempted; all new files blocked)
- `packages/contracts`
- `packages/api-contracts`, `cloudrun-api/src`, `cloudrun-tax/src`, `cloudrun-email/src`

Do not add `@ts-nocheck` to any file in those paths.

---

## Required environment files (not committed)

### `website/.env.local`
```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=          # preferred server-side Auth key (sb_publishable_...)
BACKEND_API_BASE_URL=              # server-only Cloud Run API origin
BACKEND_API_TIMEOUT_MS=12000       # optional; capped at 12 seconds
WEBSITE_ORIGIN=                    # exact same-origin/CSRF origin
WEBSITE_SESSION_SECRET=            # recovery/challenge signing; at least 32 chars
CONTACT_CHALLENGE_SECRET=          # optional; falls back to WEBSITE_SESSION_SECRET
RECAPTCHA_ENTERPRISE_PROJECT_ID=
RECAPTCHA_ENTERPRISE_MIN_SCORE=0.7
RECAPTCHA_ENTERPRISE_TIMEOUT_MS=8000
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=

```

The opaque-session/SSR path must not expose a Supabase access or refresh token
to browser JavaScript. The website has no Edge, Firebase, anon/service-role, or
split legacy-cookie configuration. Secret keys exist only in trusted server
workloads.

### `cloudrun-api/` env
```
DATABASE_URL=                      # must authenticate as smart_job_api
DATABASE_SSL_MODE=require          # disable only for loopback development
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=          # sb_publishable_...
SUPABASE_SECRET_KEY=               # sb_secret_...; Storage administration only
SUPABASE_STORAGE_BUCKET=smart-job-company-files
SUPABASE_JWT_ISSUER=               # optional; defaults to ${SUPABASE_URL}/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
WEB_SESSION_ENCRYPTION_KEY_BASE64= # exactly 32 random bytes, canonical base64
WEB_SESSION_ENCRYPTION_KEY_VERSION=
DOCUMENT_PUBSUB_PROJECT_ID=
DOCUMENT_PREVIEW_TOPIC=
DOCUMENT_GENERATE_TOPIC=
EMAIL_DELIVERY_TOPIC=
ARCHIVE_BUCKET=
TAX_SUBMISSION_MODE=disabled       # production launch remains disabled
TAX_GATEWAY_URL=
TAX_GATEWAY_AUDIENCE=
TAX_GATEWAY_TIMEOUT_MS=8000
INTERNAL_API_AUDIENCE=
INTERNAL_CALLER_SERVICE_ACCOUNTS=
```

### `cloudrun-email/` env
```
DATABASE_URL=                      # must authenticate as smart_job_email in production
DATABASE_SSL_MODE=require
CLOUD_RUN_SERVICE_URL=
PUBSUB_ALLOWED_SERVICE_ACCOUNTS=
SUPABASE_URL=
SUPABASE_SECRET_KEY=               # sb_secret_...; signed download creation only
SUPABASE_STORAGE_BUCKET=smart-job-company-files
AWS_REGION=eu-central-1
SES_FROM_EMAIL=
SES_FROM_NAME=Smart-Job
```

There is no application `supabase/.env`: the Edge runtime has been removed.
`supabase/config.toml` owns only the isolated local services and Auth templates;
the lifecycle script generates ignored local credentials under
`local-platform/.env.generated`.

### `phone_app/` env + native files
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_BACKEND_API_BASE_URL=
```
Also requires: `phone_app/google-services.json`, `phone_app/GoogleService-Info.plist`

> Native config files and `.env` files must not be committed. They are listed in `.gitignore` and `phone_app/.gitignore`.

---

## Architecture rules (will break things if violated)

### Identity
- `uid` = canonical user identity (Supabase-issued)
- `companyId` = canonical tenant scope (SQL-allocated integer, NOT derived from uid or email)
- Backend handlers must normalize public/incoming `companyId` to internal UUID before any SQL op

### Sequential IDs
Use SQL counters — never `MAX + 1`. Applies to: `public_company_id`, `member_no`, `client_no`, `job_no`, tax invoice numbers (`doc_305`), `part_no`.

### Canonical values (from `@smart-job/contracts`)
- Job statuses: `pending`, `waiting`, `finished`, `denied` — no others
- Account types: `solo`, `business`
- Roles: `manager`, `worker`, `user`, `basic`, `dev`
- Doc types: `10` PriceProposal, `200` DeliveryNote, `210` ReturnCertificate, `305` TaxInvoice, `330` Refund, `400` Receipt
- VAT rate: `0.18`

### Forbidden field/variable names on jobs
`in_progress`, `completed`, `received` (statuses); `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `jid`, `createdBy`

### Document tasks
`preview_url` → `previewURL` (website mapping), `generate_url` → `downloadURL`. Create-only semantics — never overwrite existing generated PDFs.

### Cursor pagination
Composite cursor `(createdAt, id)` — must remain stable; never change to single-field.
Read-model edge queries must honor `status`, date range, document type, creator, `pageSize`, `limit`, and `afterCursor` filters without in-memory post-filtering as the primary access control.
Service-role read-model code must enforce role scoping before returning rows: workers/business users only assigned jobs, basic no jobs, workers no documents, workers list manager/dev only.
Client and inventory read-model search/pagination are SQL RPC-backed (`get_clients_page`, `get_company_inventory_page`, `get_member_inventory_page`); do not reintroduce full-collection Edge memory filtering.
Count-only/bootstrap reads must stay lightweight; do not fetch full inventory or collection payloads for dashboard counts.
Privileged RPC implementations belong behind the private schema, with public RPC names kept only as service-role wrappers for Edge code.

### `vat_number` is immutable after onboarding
`updateBusinessInfoV1` must reject mutations to this field.

### Invite redemption
Must consume invite state atomically before finalizing membership (prevents multi-join races).

### Inventory mutations
Inventory movement writes must use SQL helpers. Multi-part picks use `apply_inventory_pick_batch(...)` so balance changes and movement rows commit or fail together.
Finished-job inventory consumption uses `apply_job_inventory_consumption_batch(...)` so all consumed parts commit or fail together.

### Job creation
`createJobV1` uses the `create_job_with_details(...)` SQL RPC so the job row, part usages, attachments, and finished-job inventory consumption are inserted in a single transaction.

### Business registration
`registerBusinessV1` uses the `register_business_account(...)` SQL RPC so the company, profile, subscription, sync state, and owner membership are created in a single transaction.

The new `POST /api/v1/auth/business-registration` path uses migration
`0010_hardened_api_business_registration.sql` and
`private.register_api_business_account(...)`. It is first-workspace-only,
requires verified email plus an idempotency key, derives the authenticated uid,
role, tier, enabled modules, and public company counter server-side, and commits
the company/profile/subscription/sync/membership state atomically.

### API database security foundation
- Migration `0006_api_security_foundation.sql` creates the least-privileged
  `smart_job_api` runtime role. Its password is never stored in migrations or
  source control; provision it out of band and inject the runtime connection
  string through the environment/Secret Manager.
- Every API transaction must call `private.set_api_request_context(...)` before
  authenticated SQL work so `request.jwt.claim.sub` and transaction-local
  statement, lock, and idle-transaction timeouts are set together.
- `private.web_sessions` stores only token hashes plus encrypted Supabase
  credentials; `private.api_idempotency` and `private.file_upload_sessions`
  hold bounded operational state.
- Jobs carry an opaque positive `entity_version`. Completion must use
  `private.complete_job_with_details(...)`, which rejects stale versions and
  atomically finishes the job, replaces optional parts, consumes inventory,
  consumes an upload session, inserts attachments, and bumps sync versions.
- Migration `0007_api_job_creation_and_storage.sql` adds atomic API job
  creation plus the canonical private `smart-job-company-files` upload bucket;
  migration `0008_pdf_supabase_storage.sql` extends that bucket to generated
  PDF content, and migration `0009_bounded_upload_session_cleanup.sql` adds the
  bounded abandoned-upload cleanup protocol.
- Migration `0010_hardened_api_business_registration.sql` owns the API-only
  first-workspace registration transaction described above.
- Do not grant `smart_job_api` direct write access to public ERP tables or
  execute access to legacy privileged RPCs that trust caller-supplied identity.
- Migration `0011_api_push_tokens.sql` exposes only self-scoped
  `private.upsert_api_push_token(...)` and `private.clear_api_push_token()` to
  `smart_job_api`. Push-token values are write-only API data; never return or
  log them, and never accept a caller-supplied target user id.
- Migration `0012_hardened_api_invitations.sql` derives invitation identity,
  verified email, tenant role, and membership authority in SQL. Create/redeem
  use separate hashed 10-per-minute buckets, mandatory idempotency, exact
  company/code row locking, and atomic invite consumption plus membership.
- Migration `0016_upload_session_idempotency_limits.sql` makes attachment
  session creation idempotency-key-only: the claim UUID owns one session,
  replays mint fresh signed URLs, and Postgres enforces 12 new sessions per
  user per ten minutes plus four active sessions per user/company. Direct
  runtime writes are revoked; three initial signing failures enqueue bounded
  cleanup and the final minute before expiry is never returned.
- Migration `0018_api_client_mutations.sql` gives clients opaque entity
  versions and exposes only narrow create/update/delete-or-archive functions
  to `smart_job_api`. Mutations require verified identity and idempotency,
  derive module/tenant/role authority in SQL, allow manager/user/basic while
  denying workers, allocate `client_no` through the company counter, and bump
  `clients_version` atomically. Referenced clients are archived; only
  unreferenced clients are physically deleted. Default client reads are
  active-only and accept explicit `active`, `archived`, or `all` filters.
- Migration `0019_api_inventory_mutations.sql` adds trigger-maintained opaque
  versions to inventory parts and location balances, hardens tenant validation
  plus deterministic lock order in shared movement/batch-pick helpers, and
  exposes only narrow create/update/archive/adjust/transfer/pick RPCs to
  `smart_job_api`. Company and cross-member mutations require manager/dev;
  `/inventory/me` adjustments are self-scoped. Archive requires zero company/member
  stock, picks are unique and capped at 100 items, and sync bumps atomically.
- Migration `0021_api_job_mutations.sql` exposes only versioned
  `private.update_api_job(...)`, `private.accept_api_job(...)`, and
  `private.delete_api_job(...)` to `smart_job_api`. Every route requires
  verified identity plus `Idempotency-Key`; SQL re-derives tenant, jobs-module,
  role, and assignment authority. PATCH cannot transition to `finished`.
  Accept is manager/dev-only from `pending` or `waiting`. Delete rejects
  certificates and any document, inventory-movement, upload-session, or
  attachment reference before removing the job and bumping `jobs_version`.
- The implemented API slices through `0021` join viewer/workspaces/bootstrap
  (including a bounded subscription entitlement summary);
  bounded jobs, clients, company inventory, and member inventory reads; atomic
  job create/complete plus versioned update/accept/delete; attachment upload
  sessions; opaque web sessions;
  first-workspace registration; push-token register/clear; and invitation
  create/redeem plus client create/update/delete-or-archive and inventory
  create/update/archive/adjust/transfer/pick. Do not describe an in-progress route as available until its
  contract, SQL migration, and integration tests land together.
- Migration `0023_api_tax_callback_processing.sql` adds
  `private.tax_callback_events` for idempotent callback tracking, an indexed
  `oauth_session_id` link on `tax_invoice_reservations`, and
  `private.bind_api_tax_approval_session(...)` so the document reservation is
  bound to the outbound correlation ID before authority submission. It also adds
  `private.process_api_tax_callback(...)` which atomically records the event,
  updates the document's `tax_authority_status` and reservation status, and
  bumps `documents_version`. Replays with the same payload hash return
  idempotently; different payload hashes raise `TAX_CALLBACK_PAYLOAD_CONFLICT`.
  Also exposes `private.cleanup_tax_callback_events(...)` for bounded retention.
- Migration `0024_api_archive_retrieval.sql` adds RLS policies and
  `smart_job_api` grants to the previously-dormant `archive_runs` table,
  plus `private.list_api_company_archives(...)` for bounded cursor pagination
  of archive run metadata. The archiver now records runs in `archive_runs`
  via `recordArchiveRun(...)`.
- Migration `0025_post_0024_metadata_baseline.sql` is an intentional no-op
  Drizzle metadata baseline. `test:migrations` verifies that its schema
  fingerprint exactly matches a database built through `0024`, then applies
  every later migration as an upgrade.
- Migration `0026_job_acceptance_inventory_consumption.sql` makes manager/dev
  job acceptance consume recorded part usages through
  `apply_job_inventory_consumption_batch(...)` before finalizing status. The
  locked transaction is exactly-once and rolls back the job on insufficient
  stock.
- Migrations `0027` and `0028` add private durable email/tax/archive state,
  dedicated passwordless-at-migration worker login roles, opaque ID-only
  Pub/Sub messages, lease-token PDF/email RPCs, and manual retry for
  `failed|delivery_unknown`. Runtime workers have no direct ERP-table writes.
- Migrations `0029` and `0030` add the authoritative tax-invoice transaction
  and synchronize Drizzle metadata. The API allocates `doc_305`, document,
  items, reservation, and submission outbox atomically. Only an `approved`
  result with a confirmation number creates the final PDF task; ambiguous
  submissions become `submission_unknown` and are never blindly retried.
- The implemented API now also includes: internal tax callback processing at
  `POST /internal/v1/tax/callback` (Google service identity protected),
  correlation binding at `POST /internal/v1/tax/approval-session`, manager/dev
  member inventory reads at
  `GET /api/v1/companies/{companyId}/inventory/members/{memberNo}`,
  `cloudrun-tax` callback (`POST /api/v1/tax/callback`) and approval
  (`POST /api/v1/tax/approval`) routes, and archive listing at
  `GET /api/v1/companies/{companyId}/archives`.
- The API also exposes authoritative tax creation at
  `POST /api/v1/companies/{companyId}/tax-invoices`, document workflow detail
  at `GET /api/v1/companies/{companyId}/documents/{documentId}`, and authorized
  manual email retry. Google-identity-protected drains publish opaque document
  task and email delivery IDs and process the tax outbox. Production tax
  creation remains fail-closed while `TAX_SUBMISSION_MODE=disabled`.
- Migration `0031_batch5_archive_hardening.sql` replaces mutable archive
  manifests with least-privilege leased segments, immutable record/ID objects,
  exact generation/checksum metadata, and resumable 500-row deletion RPCs.
- Migration `0032_batch5_readiness_search.sql` records the exact API schema
  marker, exposes a narrow readiness privilege check, and adds generated
  normalized trigram search indexes. The measured 100k-job search p95 fell from
  958.70 ms to 7.33 ms; keep the reproducible profile under `packages/db/perf`.

---

## Per-package conventions

### website/
- `page.tsx` = server component wrapper only — **never add `"use client"` to `page.tsx`**
- All `/app/*` routes now use the opaque Postgres-backed session cookie
  (`__Host-sj_web_session` in production), a server-only DAL/BFF, and Server
  Components. The overview, jobs, clients, inventory, documents, workers,
  settings, and upgrade slices are implemented as explicit-tenant routes under
  `/app/c/{companyId}`. Legacy `/app/*` routes redirect to their
  explicit-tenant equivalents. The `firebase` and `firebase-admin` dependencies,
  the `__session`/`__session_access` cookie chain, the Edge proxy API routes
  (`/api/callable`, `/api/read-model`), and the legacy auth provider have been
  removed.
- The explicit-tenant clients slice creates, updates, and delete-or-archives
  only through same-origin opaque-session BFF routes. Keep the initial page
  server-rendered; browser mutations require exact Origin, double-submit CSRF,
  stable `Idempotency-Key`, and the current opaque client `entityVersion`.
- The explicit-tenant inventory slice keeps initial reads server-rendered and
  exposes manager/dev create/update/archive/company-adjust controls only through
  same-origin opaque-session BFF routes. Preserve retry-stable idempotency keys,
  part `entityVersion`, stock `stockEntityVersion`, and `router.refresh()` after
  confirmed writes; user and worker website inventory views are read-only.
- Login, `/app` workspace routing, and onboarding now use the opaque session.
  Onboarding creation/invitation mutations go only through same-origin BFF
  handlers; do not reintroduce browser Supabase tokens or `/api/callable` there.
- Mutations on the opaque path require the readable `sj_csrf` cookie to match
  `X-SJ-CSRF` and require the exact configured `WEBSITE_ORIGIN`. No Supabase
  token may enter HTML, browser storage, a readable cookie, or browser JSON.
- Tailwind v4 with `@tailwindcss/postcss`; forms via React Hook Form + Zod v4

### phone_app/
- Local notification APIs use pinned `react-native-notify-kit` `10.4.8`.
  Firebase Messaging remains the remote push transport, so iOS NotifyKit
  configuration keeps `handleRemoteNotifications: false`; rebuild native dev
  clients after changing this native dependency.
- Push register/clear bodies include one UUID-like per-installation `deviceId`
  stored only in SecureStore. Notification display/open paths fail closed unless
  payload `uid` matches the restored user and `companyId` matches the current
  accessible tenant; Android uses a newly versioned PRIVATE channel ID.
- Local persistence: `react-native-mmkv` — **never `AsyncStorage`** for MMKV-owned surfaces
- Auth transport tokens: Expo SecureStore — never MMKV, AsyncStorage, localStorage, or JS-readable cookies
- Migrated job, client, and inventory list queries use the Cloud API with keys
  containing both `uid` and `companyId`, bounded cursors/search, and stale-data
  retention. Inventory writes also use the Cloud API: manager/dev may mutate
  company parts, users remain read-only, and workers adjust only their own
  `/inventory/me` stock. Use Expo Crypto UUID idempotency keys plus the opaque
  part/stock versions and invalidate only the active tenant query prefix. Keep
  the company catalog picker disabled until its scoped transfer UI is complete.
- Client Book and cache client create/update/delete-or-archive paths use only
  the authenticated Cloud API. Preserve active-only default paging, stable
  retry idempotency keys, client entity versions, and tenant-scoped React Query
  invalidation; do not restore Edge callable or Firebase client writes.
- The offline v1 outbox supports only `job.create_finished` and
  `job.complete_assigned`. It uses one SQLCipher database per uid with its key
  in SecureStore, AES-256-GCM chunk-encrypted app-owned attachments, and
  synchronization only on app start, foreground, and connectivity restoration.
  Preserve pending work across logout for the same uid; delete staged files
  only after server reconciliation or explicit user discard. Online form success
  requires a `reconciled` operation outcome; queued/retry/conflict/terminal work
  stays visible in Pending Work with manual retry and explicit discard.
- Debug logging: use `utils/logger.ts`; noisy cache/read-model logs must be dev-only, while warnings/errors remain visible
- Alerts: `useAlert()` from `contexts/AlertContext` — **never `Alert.alert()`**
- JSON parsing: `safeJsonParse()` — **never raw `JSON.parse()`** in mobile modules
- Business registration is website-only — no registration routes in mobile

### Documentation upkeep
- If any code behavior, runtime contract, environment requirement, workflow, or architecture changes, review the affected `.md` files in the same task and update them when needed.
- Prefer updating existing markdown files over creating new ones.

### cloudrun-pdf
- Puppeteer 24; Docker base `ghcr.io/puppeteer/puppeteer:24.40.0`
- Must set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable` in container env
- Generated PDFs, previews, and logo reads use the private
  `smart-job-company-files` bucket. Configure server-only `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY`; the service rejects legacy service-role keys and any
  alternate bucket name.
- Production SQL connections must authenticate as `smart_job_pdf`. The worker
  receives canonical task state only from private lease-token RPCs; Pub/Sub
  payloads contain only `taskId`.

### cloudrun-email
- Pub/Sub payloads contain only `deliveryId`; canonical recipient, tenant,
  document, and object data come from private lease-token RPCs.
- Retry only definite pre-send or provider-rejected transient failures. A
  network/timeout ambiguity after SES submission must become
  `delivery_unknown` and requires an explicit authorized manual retry.
- Production SQL connections must authenticate as `smart_job_email`. Never log
  recipient addresses or place SES/Supabase credentials in source or images.

### cloudrun-archiver
- Before monthly archive work, the job runs one bounded abandoned-upload cleanup
  batch through service-role-only RPCs from migration
  `0009_bounded_upload_session_cleanup.sql`. Cleanup failure is reported but
  must not prevent the monthly archive phase.
- Configure server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
  (`sb_secret_...`) to enable cleanup. Native requests send the opaque key only
  in `apikey`, never in `Authorization`.
- Delete only the exact canonical `smart-job-company-files` paths returned by a
  claimed session manifest. Never delete consumed/finalized sessions, accept a
  cross-prefix path, or recursively delete a prefix.
- Monthly archive work authenticates only as `smart_job_archiver`. It claims a
  database lease/advisory lock per company/month/type, writes immutable record
  and companion ID objects with `ifGenerationMatch=0`, verifies generation,
  metadata, size, and SHA-256, then deletes only manifest IDs in chunks of at
  most 500. Empty snapshots release their lease and never close the month.
- Keep `ARCHIVER_QUERY_PAGE_SIZE <= 500`, `ARCHIVER_CANDIDATE_LIMIT <= 2000`,
  company concurrency `<= 4`, one Cloud Run task with a 60-minute timeout, two
  retries, and an internal deadline below the platform timeout. Candidate
  discovery must revisit older periods so late historical rows create later
  immutable segments.

### Remaining approval gates
- The database/security foundation, API domain routes, SSR website, mobile
  outbox, private Storage/PDF slices, tax callback/approval integration,
  archive retrieval API, Cloud Run deployment/IAM workflow, CI
  integration-test job, and E2E test infrastructure (Playwright + Maestro) are
  implemented. Website Firebase/legacy-auth infrastructure has been removed.
  Mobile Firebase business-data services have been removed; Firebase Messaging
  and Crashlytics remain for push notifications and native crash reporting.
  Mobile Edge caller cutover is complete and all Edge directories have been
  deleted. Batch 8 Terraform represents the production network, workloads,
  queues, DNS/TLS/load balancer, Cloud Armor, monitoring/SLOs, and GitHub WIF.
  The release pipeline gates migration, internal candidate smoke, and explicit
  10/50/100 traffic while direct public Cloud Run ingress remains forbidden.

---

