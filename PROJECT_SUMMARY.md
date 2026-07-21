# Smart-Job ERP — Project Summary

> Read this first when working on the codebase. It is a condensed overview of architecture, conventions, build/test commands, and known remediation work.

## What this project is

Smart-Job ERP is a **multi-tenant field-service platform**.

- **Website:** Next.js 16 App Router business dashboard (registration, onboarding, clients, jobs, documents, inventory, workers, settings).
- **Mobile app:** Expo 57 / React Native 0.86 field app for managers, workers, and customers.
- **Mobile React compatibility:** keep React/React DOM at Expo 57's supported
  19.2.3 pair until Expo/React Native publish an aligned renderer update; this
  client does not enable React Server Components.
- **Backend transition:** The `cloudrun-api` implements viewer/workspace/bootstrap
  (including the bounded subscription entitlement summary),
  bounded job/client/inventory reads, atomic job create/complete, private
  attachment upload sessions, first-workspace business registration, push-token
  mutations, invitation create/redeem, opaque web sessions, client/inventory/job
  mutations, document tasks with durable PDF dispatch outbox, tax callback
  processing, authoritative tax creation/submission, durable document-email
  delivery, document workflow detail, and archive listing directly against
  Postgres/Auth/Storage.
- **Regional service:** `cloudrun-tax` is a stateless Cloud Run gateway in
  `me-west1` that terminates HMAC-authenticated tax-authority callbacks,
  forwards them to a protected internal main-API endpoint via Cloud Run IAM,
  and accepts tax approval requests from the main API using service identity
  verification.
- **Shared packages:** `@smart-job/contracts` (constants/enums), `@smart-job/api-contracts` (runtime HTTP schemas), and `@smart-job/db` (schema + access helpers).

## Package layout

| Path | Runtime | Purpose |
|---|---|---|
| `packages/contracts/` | Node | Shared enums/constants (`Role`, `JobStatus`, `DocType`, `VAT_RATE`, `Tier`, etc.) |
| `packages/api-contracts/` | Node 22 | Shared Zod request, response, DTO, cursor, and entity-version contracts |
| `packages/db/` | Node | Drizzle schema, migrations, SQL access helpers |
| `website/` | Node 22 / Next.js 16 | Admin/business web dashboard |
| `phone_app/` | Node 22 / Expo 57 | React Native field app |
| `cloudrun-api/` | Node 22 / Fastify | Main API foundation with dual auth and initial domain routes |
| `cloudrun-tax/` | Node 22 / Fastify | Stateless Israel tax gateway foundation |
| `cloudrun-pdf/` | Node 22 / Puppeteer | PDF preview/generation service |
| `cloudrun-email/` | Node 22 / Fastify | Durable SES document-email worker |
| `cloudrun-archiver/` | Node 22 | Monthly archive batch job |

## Build order

Build `packages/contracts` first. Then build `packages/api-contracts` and
`packages/db`; `cloudrun-api` needs all three, while `cloudrun-tax` needs the
two contracts packages.

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix packages/db run db:migrate   # apply migrations before running services
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-api install
npm --prefix cloudrun-tax install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-email install
npm --prefix cloudrun-archiver install
```

`@smart-job/contracts/index.js` must exist before any package that imports it.

## Developer commands

### Shared packages
```bash
npm --prefix packages/contracts run typecheck
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run typecheck
npm --prefix packages/api-contracts run test
npm --prefix packages/api-contracts run build
npm --prefix packages/db run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run db:generate
npm --prefix packages/db run db:migrate
npm --prefix packages/db run test:migrations # destructive; loopback database only
```

### Website
```bash
npm --prefix website run dev
npm --prefix website run typecheck
npm --prefix website run lint
npm --prefix website run test
npm --prefix website run build
```

### Mobile app
```bash
npm --prefix phone_app run typecheck
npm --prefix phone_app run test
npm --prefix phone_app run doctor
npm --prefix phone_app run start
```

### Cloud Run services
```bash
npm --prefix cloudrun-pdf run test      # build + test
npm --prefix cloudrun-archiver run test # build + test
npm --prefix cloudrun-api run test
npm --prefix cloudrun-tax run test
npm --prefix cloudrun-email run test
```

### Production-shaped local platform

`supabase/config.toml` defines the Docker Desktop project
`smart-job-erp-local`. Its core ports are API `55321`, PostgreSQL `55322`,
Studio `55323`, Inbucket `55324`, and Edge inspector `55883`. Drizzle remains
the migration owner through `packages/db/migrations`. The Supabase CLI services
join the external Docker network `smart-job-local`; `compose.local.yml` adds
the standalone website, API, disabled tax gateway, PDF/email workers, local
Pub/Sub/identity adapter, fake GCS, and Mailpit on the same network.

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes
```

The lifecycle script generates ignored local-only credentials, applies all
Drizzle migrations, and assigns role-specific passwords outside migration
files. Local service overrides require both exact environment flags and the
mounted repository marker. The website container entrypoint derives its local
verification signal only after reading that marker. Tax cannot be changed from
`disabled` in this topology. The legacy archiver is an explicit `archive`
command because its least-privilege leased rewrite belongs to Batch 5.

### Repo guards
```bash
node scripts/check-no-ts-nocheck.mjs
node scripts/check-js-syntax.mjs scripts
node scripts/check-local-platform.mjs
node scripts/check-perf-budget.mjs
```

## Core architecture rules

### Identity and tenancy
- `uid` = canonical user identity (Supabase-issued).
- `companyId` = canonical tenant scope (SQL integer `public_company_id`, NOT derived from uid/email).
- Backend handlers normalize public `companyId` to internal UUID before any SQL op.

### Sequential IDs
Use SQL counters (`company_counters`, `system_counters`) — never `MAX + 1`.
Applies to: `public_company_id`, `member_no`, `client_no`, `job_no`, `part_no`, document numbers.

### Canonical values (from `@smart-job/contracts`)
- Job statuses: `pending`, `waiting`, `finished`, `denied`.
- Account types: `solo`, `business`.
- Roles: `manager`, `worker`, `user`, `basic`, `dev`.
- Doc types: `10` PriceProposal, `200` DeliveryNote, `210` ReturnCertificate, `305` TaxInvoice, `330` Refund, `400` Receipt.
- VAT rate: `0.18`.

### Forbidden job field/variable names
Never use: `in_progress`, `completed`, `received`, `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `jid`, `createdBy`.

### Auth
- **Website (legacy routes):** Supabase bearer → HttpOnly `__session` +
  `__session_access` cookies. Those routes remain only during vertical-slice
  migration; tokens are never stored in browser-readable storage.
- **Website (implemented server slices):** `/app/select-company` and the
  explicit-tenant overview/jobs/clients/inventory routes under
  `/app/c/{companyId}` use the server-only Cloud Run transport,
  `__Host-sj_web_session` in production, `sj_csrf`, runtime-validated envelopes,
  and Server Components. Other `/app/*` routes still use the legacy path.
- **Mobile:** Supabase access/refresh tokens use an Expo SecureStore adapter and
  AppState-controlled refresh. MMKV still backs transitional preferences,
  legacy caches/drafts, and bounded encrypted query snapshots, but never Auth
  tokens or the new durable field outbox.
- **Mobile notifications:** pinned `react-native-notify-kit` `10.4.8` owns local
  notification APIs while Firebase Messaging remains the remote push transport.
  A SecureStore-only installation ID scopes token cleanup to one device;
  display/open handling requires the restored uid plus current accessible tenant,
  and Android uses a versioned private channel.
- **Mobile pending work:** each field operation reports reconciled, queued,
  retry, conflict, or terminal status. The Pending Work screen supports manual
  retry and explicit discard while same-user encrypted work survives logout.
- **Edge:** JWT verified (issuer, audience, `uid`/`sub`); `--no-verify-jwt` is forbidden.

### API database boundary
- Migration `0006_api_security_foundation.sql` creates the least-privileged
  `smart_job_api` role, private opaque web-session/idempotency/upload-session
  state, job entity versions, and atomic version-checked job completion.
- API transactions establish the user and bounded database timeouts through
  `private.set_api_request_context(...)`; authorization remains derived from
  SQL memberships, not caller metadata.
- The runtime-role password is intentionally absent from source and migrations;
  provision it out of band and deliver the connection URL via Secret Manager or
  equivalent environment injection.
- Initial domain routes accept exactly one Supabase Bearer JWT or opaque
  `SmartJobSession` credential. Opaque resolution keeps rotating Supabase
  credentials inside the web-session service and exposes only user identity and
  the 12-hour absolute expiry to domain authorization.
- Migrations `0007`–`0012` add atomic API job creation/private upload storage,
  private PDF storage support, bounded abandoned-upload cleanup, hardened
  first-workspace registration, self-scoped push-token mutations, and hardened
  invitation creation/redemption.
- Migration `0016` binds each upload idempotency claim to one session, mints
  fresh signed URLs on replay, enforces a committed 12-per-10-minute user limit
  plus four-active-session user/workspace quota, and queues the canonical
  manifest after three initial signing failures.
- Migration `0018` adds opaque client entity versions and API-only client
  create/update/delete-or-archive functions. Tenant, module, subscription, and
  role authority are derived in SQL; manager/user/basic are permitted, workers
  are denied, sequential client numbers use the locked company counter, and
  referenced clients are archived instead of orphaning history.
- Migration `0021` adds API-only job update, acceptance, and deletion
  functions. All require an opaque expected version and route-level
  idempotency. SQL derives tenant/module/role/assignment authority, blocks
  direct PATCH transitions to `finished`, limits acceptance to manager/dev
  from pending or waiting, and refuses deletion when certificates, documents,
  inventory movements, upload sessions, or attachments protect the job.
- Migration `0019` adds opaque versions for inventory part metadata and each
  location balance, hardens shared movement/pick tenant checks and lock order,
  and provides verified/idempotent API-only create, update, zero-company/member-stock archive,
  company/self adjustment, manager transfer, and bounded batch-pick operations.
  Movements and the inventory sync bump commit atomically.
- New client/Auth code uses `sb_publishable_...` keys; only trusted API/PDF/
  archiver workloads use `sb_secret_...`. Legacy anon/service-role variables
  remain solely for the Edge and website paths that have not been cut over.

### Documents
- `preview_url` → `previewURL` (website mapping), `generate_url` → `downloadURL`.
- Create-only semantics — never overwrite existing generated PDFs.
- Generated PDFs, previews, and company-logo reads use the private
  `smart-job-company-files` Supabase bucket. Paths are internal-company scoped;
  duplicate retries are accepted only after byte/hash verification.
- GCS remains only for internal monthly archives.

### Pagination
- Cursor pagination uses composite `(createdAt, id)`.
- Client/inventory search/pagination must be SQL-RPC-backed; avoid full-collection Edge memory filtering.
- Bootstrap reads are lightweight/count-only by default.

### Inventory
- Multi-part picks use `apply_inventory_pick_batch(...)`.
- Finished-job consumption uses `apply_job_inventory_consumption_batch(...)`.

### Immutability
- `vat_number` is immutable after onboarding.

## Key file patterns

| Concern | Pattern |
|---|---|
| Website page server wrapper | `page.tsx` (never add `"use client"`) |
| Website client shell | `page-client.tsx` |
| Mobile screen | `modules/<domain>/screens/<Name>.tsx` |
| API route | `cloudrun-api/src/routes/<domain>-<verb>.ts` |
| DB access helpers | `packages/db/<domain>.ts` |

## Environment requirements

### `website/.env.local`
```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
BACKEND_API_BASE_URL=              # server-only Cloud Run API URL
BACKEND_API_TIMEOUT_MS=12000       # optional; max 12000
WEBSITE_ORIGIN=
WEBSITE_SESSION_SECRET=
CONTACT_CHALLENGE_SECRET=          # optional; falls back to WEBSITE_SESSION_SECRET

# Transitional legacy routes only.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
SESSION_COOKIE_SECRET=
BACKEND_EDGE_FUNCTIONS_BASE_URL=   # optional
NEXT_PUBLIC_FIREBASE_*=
FIREBASE_ADMIN_*=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
```

### `cloudrun-api/`
```
DATABASE_URL=                      # smart_job_api runtime credential
DATABASE_SSL_MODE=require
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=          # sb_publishable_...
SUPABASE_SECRET_KEY=               # sb_secret_...; trusted Storage use only
SUPABASE_STORAGE_BUCKET=smart-job-company-files
SUPABASE_JWT_ISSUER=
SUPABASE_JWT_AUDIENCE=authenticated
WEB_SESSION_ENCRYPTION_KEY_BASE64=
WEB_SESSION_ENCRYPTION_KEY_VERSION=
DOCUMENT_PUBSUB_PROJECT_ID=
DOCUMENT_PREVIEW_TOPIC=
DOCUMENT_GENERATE_TOPIC=
EMAIL_DELIVERY_TOPIC=
TAX_SUBMISSION_MODE=disabled
TAX_GATEWAY_URL=
TAX_GATEWAY_AUDIENCE=
INTERNAL_API_AUDIENCE=
INTERNAL_CALLER_SERVICE_ACCOUNTS=
```

### `cloudrun-email/`
```
DATABASE_URL=                      # smart_job_email role
DATABASE_SSL_MODE=require
CLOUD_RUN_SERVICE_URL=
PUBSUB_ALLOWED_SERVICE_ACCOUNTS=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=smart-job-company-files
AWS_REGION=eu-central-1
SES_FROM_EMAIL=
```

### `cloudrun-tax/`
```
TAX_SUBMISSION_MODE=disabled
TAX_TOKEN_URL=
TAX_APPROVAL_URL=
TAX_CLIENT_ID=
TAX_CLIENT_SECRET=
TAX_CALLBACK_HMAC_SECRET=
MAIN_API_URL=                      # exact internal callback endpoint
MAIN_API_AUDIENCE=                 # main API Cloud Run audience
TAX_GATEWAY_AUDIENCE=              # tax gateway Cloud Run audience
TAX_APPROVAL_CALLER_SERVICE_ACCOUNT=
```

The archiver uses a separate privileged `DATABASE_URL` secret; it must not use
the `smart_job_api` runtime credential because the batch job performs exact
source-row deletes and archive-run writes directly.

### `supabase/.env`
```
CORS_ALLOWED_ORIGINS=http://localhost:3000,...
SMART_JOB_PERSISTENCE_BACKEND=sql
DATABASE_URL=
DATABASE_SSL_MODE=disable
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
JWT_SECRET=                        # required for edge JWT verification
APP_SCHEME=erpsystem
DOCUMENTS_BUCKET=smart-job-company-files
```

The Edge variables in this block intentionally retain legacy anon/service-role
names while that Deno runtime remains active. Do not copy a service-role or
secret key into website/mobile public variables.

### `phone_app/`
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_BACKEND_API_BASE_URL=
```
Also requires `google-services.json` and `GoogleService-Info.plist`.

## Phase 1 hardening (2026-06-15)

1. **Module entitlement gating** — `assertModuleEnabled` checks `company_subscriptions.enabled_modules` and rejects mutations for disabled modules (`jobs`, `inventory`, `documents`, `clients`, `workers`).
2. **Edge JWT hardening** — verification requires explicit `JWT_SECRET` and `SUPABASE_JWT_ISSUER`, restricts algorithms to `HS256`, validates issuer/audience, and fails closed.
3. **Website JWT hardening** — server-side token verification no longer falls back to anon-key introspection or public env vars.
4. **Read caps** — SQL page RPCs default to 50 rows; mobile full-collection drain capped at 50 pages / 10,000 items; read-model bootstrap skips full inventory/collection payloads for `countOnly`.
5. **Atomic inventory mutations** — verified all movement/pick/consumption paths use SQL RPCs (`apply_inventory_movement`, `apply_inventory_pick_batch`, `apply_job_inventory_consumption_batch`); removed unused read-modify-write helper.
6. **Atomic job creation** — new `create_job_with_details` SQL RPC inserts job, part usages, attachments, and finished-job inventory consumption in one transaction.
7. **Atomic business registration** — new `register_business_account` SQL RPC creates company, profile, subscription, sync state, and owner membership in one transaction.
8. **Document task idempotency** — unique partial index on active `(company_id, task_type, lock_key)` already prevents duplicate pending/queued/processing tasks; conflict handling preserved.
9. **New migrations** — `0002_phase1_read_caps.sql`, `0003_phase1_atomic_jobs.sql`, `0004_phase1_atomic_business_registration.sql`.

## Remediation pre-Phase 1 (2026-06-15)

The following production and security issues were also fixed before Phase 1:

1. **cloudrun-archiver Docker runtime** — final stage preserves the `/workspace` layout so the `file:` symlink to `@smart-job/db` resolves correctly.
2. **cloudrun-pdf logo rendering** — `sanitizeUrl` allows inline `data:image/png;base64` and `data:image/jpeg;base64` logos.
3. **cloudrun-pdf Puppeteer alignment** — Docker base image and package version aligned to `24.40.0`.
4. **cloudrun-pdf graceful shutdown** — added `SIGTERM`/`SIGINT` handlers that drain the server and close the browser pool.
5. **`@smart-job/db` package linkage** — built contracts and DB with declaration files; added `types`/`exports` to `package.json`.
6. **Mobile `crypto.randomUUID()` crash** — replaced with `expo-crypto` backed `generateUuid()` utility.
7. **VAT immutability** — `updateCompanyBusinessInfo` rejects `vat_number` mutations with `failed-precondition`.
8. **Document task create-only semantics** — `markDocumentTaskCompleted` no longer overwrites existing `preview_url`/`generate_url`/`storage_path`.
9. **Job status transitions** — `updateJob` validates allowed transitions; terminal statuses (`finished`, `denied`) cannot be reverted.
10. **Edge auth exemption** — `registerBusinessV1` requires authentication at the gateway (website-only onboarding).
11. **Document-type mismatch guard** — `publishGenerateTask` rejects reuse of an existing document when the requested `documentType` differs.
12. **`failed-precondition` HTTP mapping** — added to `httpStatusFromErrorCode`.
13. **User inventory removal** — `removeUserInventoryPart` archives the part and clears its balance consistently.
14. **Canonical constants** — edge handlers import `DocType`, `VAT_RATE`, `JobStatus`, `Role`, `AccountType`, tier helpers from `@smart-job/contracts` instead of duplicating values.
15. **Inventory read gating** — read-model inventory endpoints enforce role/tier access via `canReadCompanyInventory` / `canReadUserInventory`.
16. **Website auth flows** — registration, forgot-password, and reset-password call server-side API routes instead of Supabase Auth directly from the browser.
17. **Lightweight reads** — bootstrap defaults to count-only/lightweight; `listClients` defaults to a single bounded page and drains all pages only when `loadAll: true`.
18. **Supabase CLI pin** — deploy workflow pinned to a specific CLI version for reproducible deploys.

## Phase 2 hardening (2026-06-22)

1. **Edge handler crash fixes** — removed undefined `wantsPage` in read-model clients branch; fixed `updateCacheV1` rejecting `profile`; handled dev users in document context; validated dates before `new Date().toISOString()`; blocked deletion of approved tax invoices.
2. **Sync version fixes** — `tax.ts`, `documents.ts` (generate), and `invites.ts` (join) now bump `documents_version` / `workers_version` so clients see new data.
3. **Secrets fail-closed** — `getEnv()` throws when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `JWT_SECRET` are missing.
4. **Database security** — migration `0002` rebuilt to keep privileged page RPCs in `private.*` with thin `SECURITY INVOKER` public wrappers; new migration `0005` adds explicit `search_path = ''` to trigger functions.
5. **Cloud Run PDF hardening** — sanitized `item.quantity`, `item.price`, and `date` in templates; escaped email template variables; pinned Puppeteer to `24.40.0` to match Docker base image; set `NODE_ENV=production`.
6. **CI/deployment fixes** — dependent CI jobs now build shared packages locally; edge caller URLs updated to flattened dash names (`invites-create`, `upgrades-request`, etc.); mobile Firebase config files and env files added to `.gitignore`; added `concurrency`, `check-js-syntax`, and `typecheck` steps to CI.
7. **Read-model access controls** — read-model kinds now enforce module entitlements and filter document tasks by `company_id`; bootstrap and `countOnly` skip disabled modules.
8. **Dependency safety** — `deleteJobV1` and `deleteClientV1` check for linked documents/movements/jobs; `manageWorker` add handles unique-conflict races; `updateJobV1` blocks reverting finished jobs.
9. **Archiver resume fix** — `uploaded_not_deleted` retry now verifies the archive and can mark the manifest `deleted` when records are already gone.
10. **New migration** — `0005_phase2_trigger_search_path.sql`.

## Pre-launch database/security foundation (2026-07-13)

1. **Isolated local stack** — `supabase/config.toml` reserves a project-specific
   Docker stack and port range instead of sharing another local Supabase project.
2. **Runtime role** — migration `0006_api_security_foundation.sql` adds
   `smart_job_api` with explicit schema/table/function grants and bounded
   connection defaults; its password remains an out-of-band secret. Private
   web-session/idempotency/upload tables store only hashed tokens, encrypted
   credentials, and bounded operational state.
3. **Atomic jobs and uploads** — migration
   `0007_api_job_creation_and_storage.sql` creates the private
   `smart-job-company-files` bucket and the authenticated API job-creation
   transaction. Jobs expose an opaque `entity_version`, and
   `private.complete_job_with_details(...)` atomically validates the version,
   finishes the job, reconciles parts/attachments, consumes inventory/upload
   state, and bumps sync versions.
4. **Private PDF storage** — migration `0008_pdf_supabase_storage.sql` extends
   the bucket to generated PDFs. The PDF worker writes create-only, verifies
   duplicate bytes/hash before reuse, performs guarded SQL finalization, and
   leaves GCS only for internal monthly archives.
5. **Bounded upload cleanup** — migration `0009` adds service-role-only
   queue/claim/finish RPCs with skip-locked leases, five-attempt dead-lettering,
   and strict canonical manifest checks. `cloudrun-archiver` runs one bounded
   startup batch through native Supabase REST/Storage calls; cleanup errors are
   reported without blocking monthly archives.
6. **Hardened registration** — migration
   `0010_hardened_api_business_registration.sql` derives the verified Auth uid,
   owner role, tier, enabled modules, and public company counter inside one
   idempotent first-workspace transaction.
7. **Push tokens** — migration `0011_api_push_tokens.sql` exposes only
   self-scoped upsert/clear functions to `smart_job_api`; token values are
   write-only and never returned or logged.
8. **Invitations** — migration `0012_hardened_api_invitations.sql` derives
   verified identity and role authority in SQL, atomically consumes exact
   company/code invites, permits multiple workspaces, and enforces separate
   hashed create/redeem limits of 10 requests per minute.
9. **Staged domain API** — `cloudrun-api` implements `/api/v1/me`, workspaces,
   lightweight company bootstrap, bounded jobs/clients/inventory reads, secure
   idempotent client create/update/delete-or-archive, atomic
   job create/complete, job-attachment upload sessions, business registration,
   push-token mutations, invitation create/redeem, and the opaque web-session
   lifecycle. These routes are locally tested but are not the production gateway.
10. **Website SSR slices** — opaque login, `/app` workspace routing, onboarding,
   workspace selection, and explicit-tenant overview,
   jobs, clients, and inventory pages resolve the opaque session server-side,
   reject forged tenant URLs before scoped reads, and render the first bounded
   page before hydration. Client create/edit/delete-or-archive and manager/dev
   inventory create/edit/archive/company-adjust now cross only exact-Origin,
   double-submit-CSRF BFF routes with retry-stable idempotency and the required
   opaque entity/stock versions. Legacy `/app/*` pages still coexist.
11. **Mobile API/outbox slices** — the provider shell, tenant-scoped React Query
    job/client/inventory reads, authenticated client and inventory mutations,
    and encrypted
    offline operations are implemented for only
    `job.create_finished` and `job.complete_assigned`. Each uid has a SQLCipher
    database with a SecureStore key; staged files are AES-256-GCM chunk-encrypted
    and synchronize only at app start, foreground, or connectivity restoration.
    Pinned NotifyKit `10.4.8` handles local notifications while Firebase
    Messaging remains the remote push transport. Client Book and legacy cache
    client actions now share bounded active Cloud API pages, entity versions,
    stable idempotency keys, and tenant-scoped query invalidation instead of
    Edge/Firebase writes. Manager/dev company inventory writes and worker self-
    stock adjustments now use the same API/versioned invalidation path; user
    company inventory stays read-only.

The database migration chain now runs through `0030`. It includes a verified
no-op post-`0024` metadata baseline, transactional accepted-job inventory
consumption, dedicated worker roles, durable PDF/email/tax/archive workflow
state, opaque dispatch, and authoritative approval-only tax PDF generation.
The tax callback/approval integration, archive retrieval API, Cloud Run
deployment/IAM workflow, CI integration-test job, and E2E test infrastructure
(Playwright + Maestro) are now implemented. Website Firebase/legacy-auth
infrastructure has been removed. Mobile Firestore/App Check have been removed;
Firebase Messaging and Storage remain for push notifications and file uploads.
The Edge-to-Cloud-API cutover is complete; all Supabase Edge functions and
handlers have been deleted. Production tax submission remains disabled pending
certification, and stable API DNS is a mobile-release gate.

## Still on the technical-debt radar

- Mobile has ~25 `@ts-nocheck` files under `phone_app/modules/` that should be typed incrementally.
- `strict: false` is set in several `tsconfig.json` files; enabling strict mode will surface latent type errors.
- Mobile screens are very large (1000+ lines) and should be split into hooks/components.
- Some mobile lists use `.map()` inside `ScrollView` instead of `FlatList`.
- `npm audit` findings remain in `phone_app` and other packages; update dependencies after baseline testing.
- Some CI jobs build shared packages inline; consider a reusable composite action once the matrix stabilizes.

## When in doubt

- Keep changes minimal and follow the closest existing pattern.
- Update this file and `AGENTS.md` when behavior, contracts, env requirements, or architecture change.
- Run the relevant package tests/typecheck/lint before finishing.
