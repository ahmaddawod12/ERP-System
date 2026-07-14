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
| `supabase/functions/` | Edge Function HTTP entrypoints | Deno |
| `supabase/handlers/` | Domain logic called by edge functions | Deno |
| `cloudrun-api/` | Modular API with dual auth and initial domain routes | Node 22 |
| `cloudrun-tax/` | Stateless Israel tax gateway foundation | Node 22 |
| `cloudrun-pdf/` | PDF generation service | Node 22 |
| `cloudrun-archiver/` | Monthly archive batch job | Node 22 |
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
npm --prefix cloudrun-archiver run test
```

### supabase/ (Deno — no npm scripts)
```bash
# Bash: enable globstar so nested function paths (e.g., tax/callback) are included
shopt -s globstar
deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
deno test --config deno.json --allow-read="$PWD/supabase,$PWD/packages/db/migrations" supabase/handlers/handlers-hardening.test.ts
supabase functions serve mutation-gateway --env-file supabase/.env
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

### Repo-level CI scripts
```bash
node scripts/check-no-ts-nocheck.mjs   # blocks CI; run before pushing
node scripts/check-js-syntax.mjs scripts  # quick syntax sweep of repo scripts
node scripts/check-perf-budget.mjs     # warnings only, exits 0 always
```

---

## CI (`.github/workflows/ci.yml`)

All jobs run on every push/PR with **Node 22**. A top-level `concurrency` group with `cancel-in-progress: true` avoids redundant runs.

- `repo_guards` → `check-no-ts-nocheck.mjs` + `check-js-syntax.mjs scripts`
- `packages_contracts` → `npm ci` → typecheck → build
- `packages_api_contracts` → builds `packages/contracts` → `npm ci` → typecheck → test
- `packages_db` → builds `packages/contracts` → `npm ci` → typecheck → build
- `website` → builds `packages/contracts` → `npm ci` → **test → typecheck → lint → build** (order matters)
- `phone_app` → builds `packages/contracts` → `npm ci` → test → typecheck → Expo Doctor
- `cloudrun_pdf` → builds `packages/contracts` → `npm ci` → typecheck → test
- `cloudrun_archiver` → builds `packages/contracts` + `packages/db` → `npm ci` → typecheck → test
- `cloudrun_api` → builds all three local packages → `npm ci` → typecheck → test
- `cloudrun_tax` → builds contracts packages → `npm ci` → typecheck → test
- `supabase_edge` → `deno check` on all edge `.ts` files + hardening tests
- `perf_budget` → `continue-on-error: true` (never blocks)
- `cloudrun_images` → Docker build (no push)

Edge deploy (`supabase-edge-deploy.yml`) is **manual `workflow_dispatch` only**. Nested function paths (e.g. `contact/request`) are flattened to `contact-request` before deploy; website/mobile callers must use the same dashed names.

---

## @ts-nocheck policy (enforced by CI)

`check-no-ts-nocheck.mjs` blocks new `@ts-nocheck` in:
- `website/src`, `website/tests`
- `phone_app/components`, `phone_app/contexts`, `phone_app/tests`, `phone_app/firebase.ts`
- `phone_app/modules/` (allowlist of legacy files exempted; all new files blocked)
- `packages/contracts`
- `packages/api-contracts`, `cloudrun-api/src`, `cloudrun-tax/src`

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
WEBSITE_SESSION_SECRET=            # recovery state + transitional cookie signing
CONTACT_CHALLENGE_SECRET=          # optional; falls back to WEBSITE_SESSION_SECRET

# Transitional legacy website/Edge/Firebase routes only; remove after cutover.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
SESSION_COOKIE_SECRET=
BACKEND_PROJECT_ID=
BACKEND_EDGE_FUNCTIONS_BASE_URL=   # optional; defaults to ${SUPABASE_URL}/functions/v1
NEXT_PUBLIC_FIREBASE_*=
FIREBASE_ADMIN_*=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
```

The opaque-session/SSR path must not expose a Supabase access or refresh token
to browser JavaScript. Legacy anon/service-role variables above exist only for
the remaining pre-cutover routes; new code uses publishable keys in public/Auth
contexts and secret keys only in trusted server workloads.

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
```

### `supabase/.env`
```
CORS_ALLOWED_ORIGINS=http://localhost:3000,...   # empty = deny all (not allow all)
SMART_JOB_PERSISTENCE_BACKEND=sql               # must be explicit; no implicit SQL mode
DATABASE_URL=
DATABASE_SSL_MODE=disable
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
JWT_SECRET=                                       # required for edge JWT verification
TAX_AUTH_URL=, TAX_TOKEN_URL=, TAX_CLIENT_ID=, TAX_CLIENT_SECRET=, ...
APP_SCHEME=erpsystem
DOCUMENTS_BUCKET=smart-job-company-files
```

### `phone_app/` env + native files
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_BACKEND_API_BASE_URL=
EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL=   # transitional legacy Edge operations
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
- The implemented API slices through `0021` join viewer/workspaces/bootstrap;
  bounded jobs, clients, company inventory, and member inventory reads; atomic
  job create/complete plus versioned update/accept/delete; attachment upload
  sessions; opaque web sessions;
  first-workspace registration; push-token register/clear; and invitation
  create/redeem plus client create/update/delete-or-archive and inventory
  create/update/archive/adjust/transfer/pick. Do not describe an in-progress route as available until its
  contract, SQL migration, and integration tests land together.

---

## Per-package conventions

### website/
- `page.tsx` = server component wrapper only — **never add `"use client"` to `page.tsx`**
- `page-client.tsx` = client shell pattern
- New explicit-tenant routes under `/app/c/{companyId}` use the opaque
  Postgres-backed session cookie (`__Host-sj_web_session` in production), a
  server-only DAL/BFF, and Server Components. The overview, jobs, clients, and
  inventory read slices are implemented; the remaining `/app/*` routes still
  use the legacy `__session`/`__session_access` transition path.
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

### supabase/ (Deno)
- Type-check with `deno check`, not `tsc`
- Keep `deno.json` import mappings in sync with any npm packages used by edge code
- Node 22 native `fetch()` is available — do not add `node-fetch` or polyfills
- `--no-verify-jwt` must never appear in shared or production configs

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

### Remaining approval gates
- The database/security foundation and initial API, SSR website, mobile outbox,
  and private Storage/PDF slices are implemented locally. New API/tax
  Dockerfiles, deployment/IAM configuration, stable API domain, remaining
  domain routes and frontend cutover, remaining legacy file paths, and deletion
  of Edge/Firebase infrastructure are not complete and still require their
  implementation-time approvals.

---

