# Smart-Job ERP — Project Summary

> Read this first when working on the codebase. It is a condensed overview of architecture, conventions, build/test commands, and known remediation work.

## What this project is

Smart-Job ERP is a **multi-tenant field-service platform**.

- **Website:** Next.js 16 App Router business dashboard (registration, onboarding, clients, jobs, documents, inventory, workers, settings).
- **Mobile app:** Expo 55 / React Native 0.83.4 field app for managers, workers, and customers.
- **Backend:** Supabase Edge Functions (Deno) + Postgres (Drizzle ORM) + Cloud Run services (PDF generation, monthly archive).
- **Shared packages:** `@smart-job/contracts` (constants/enums) and `@smart-job/db` (schema + access helpers).

## Package layout

| Path | Runtime | Purpose |
|---|---|---|
| `packages/contracts/` | Node / Deno | Shared enums/constants (`Role`, `JobStatus`, `DocType`, `VAT_RATE`, `Tier`, etc.) |
| `packages/db/` | Node | Drizzle schema, migrations, SQL access helpers |
| `website/` | Node 22 / Next.js 16 | Admin/business web dashboard |
| `phone_app/` | Node 22 / Expo 55 | React Native field app |
| `supabase/functions/` | Deno | HTTP edge entrypoints |
| `supabase/handlers/` | Deno | Domain logic called by edge functions |
| `cloudrun-pdf/` | Node 22 / Puppeteer | PDF preview/generation service |
| `cloudrun-archiver/` | Node 22 | Monthly archive batch job |

## Build order

`packages/contracts` → `packages/db` → everything else.

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/db install
npm --prefix packages/db run db:migrate   # apply migrations before running services
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-archiver install
```

`@smart-job/contracts/index.js` must exist before any package that imports it.

## Developer commands

### Shared packages
```bash
npm --prefix packages/contracts run typecheck
npm --prefix packages/contracts run build
npm --prefix packages/db run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run db:generate
npm --prefix packages/db run db:migrate
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
npm --prefix phone_app run start
```

### Cloud Run services
```bash
npm --prefix cloudrun-pdf run test      # build + test
npm --prefix cloudrun-archiver run test # build + test
```

### Edge functions
```bash
deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
```

### Repo guards
```bash
node scripts/check-no-ts-nocheck.mjs
node scripts/check-js-syntax.mjs scripts
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
- **Website:** Supabase bearer → HttpOnly `__session` + `__session_access` cookies. No tokens in `localStorage` or JS-readable cookies.
- **Mobile:** Auth transport tokens in Expo SecureStore; cache/non-sensitive data in `react-native-mmkv`. Never `AsyncStorage` for tokens.
- **Edge:** JWT verified (issuer, audience, `uid`/`sub`); `--no-verify-jwt` is forbidden.

### Documents
- `preview_url` → `previewURL` (website mapping), `generate_url` → `downloadURL`.
- Create-only semantics — never overwrite existing generated PDFs.

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
| Edge HTTP entry | `supabase/functions/<name>/index.ts` |
| Edge domain logic | `supabase/handlers/<domain>.ts` |
| DB access helpers | `packages/db/<domain>.ts` |

## Environment requirements

### `website/.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
SESSION_COOKIE_SECRET=
WEBSITE_SESSION_SECRET=
BACKEND_PROJECT_ID=
BACKEND_EDGE_FUNCTIONS_BASE_URL=   # optional
NEXT_PUBLIC_FIREBASE_*=
FIREBASE_ADMIN_*=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
```

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
```

### `phone_app/`
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
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

## Still on the technical-debt radar

- Mobile has ~25 `@ts-nocheck` files under `phone_app/modules/` that should be typed incrementally.
- `strict: false` is set in several `tsconfig.json` files; enabling strict mode will surface latent type errors.
- Mobile screens are very large (1000+ lines) and should be split into hooks/components.
- Some mobile lists use `.map()` inside `ScrollView` instead of `FlatList`.
- `npm audit` findings remain in `phone_app` and other packages; update dependencies after baseline testing.
- Website client list and inventory UIs should move to server-paginated/autocomplete patterns instead of loading full collections.
- Edge import-map deployment config should be verified (`deno.json` exists but Supabase deploy may need `supabase/functions/import_map.json`).
- Some CI jobs build shared packages inline; consider a reusable composite action once the matrix stabilizes.

## When in doubt

- Keep changes minimal and follow the closest existing pattern.
- Update this file and `AGENTS.md` when behavior, contracts, env requirements, or architecture change.
- Run the relevant package tests/typecheck/lint before finishing.
