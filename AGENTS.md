# AGENTS.md

Smart-Job ERP — multi-tenant field-service platform.  
**No root workspace.** Each sub-package is installed and run independently.

---

## Package layout

| Path | Type | Runtime |
|---|---|---|
| `website/` | Next.js 16 App Router | Node 22 |
| `phone_app/` | Expo 55 / React Native 0.83.4 | Node 22 / EAS |
| `supabase/functions/` | Edge Function HTTP entrypoints | Deno |
| `supabase/handlers/` | Domain logic called by edge functions | Deno |
| `cloudrun-pdf/` | PDF generation service | Node 22 |
| `cloudrun-archiver/` | Monthly archive batch job | Node 22 |
| `packages/contracts/` | Shared enums/constants (`@smart-job/contracts`) | Node |
| `packages/db/` | Drizzle ORM schema + migrations (`@smart-job/db`) | Node 22 |

---

## Build order

`packages/contracts` → `packages/db` → everything else.  
`contracts` compiled output (`index.js`) must exist before any package that imports it.

```bash
npm --prefix packages/contracts install
npm --prefix packages/db install
npm --prefix packages/db run db:migrate   # apply latest SQL migrations first
npm --prefix website install
npm --prefix phone_app install
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
npm --prefix phone_app run start        # expo start
```

### packages/contracts & packages/db
```bash
npm --prefix packages/contracts run typecheck
npm --prefix packages/contracts run build
npm --prefix packages/db run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run db:generate   # drizzle-kit generate (new migration from schema change)
npm --prefix packages/db run db:migrate    # drizzle-kit migrate (apply to DB)
```

Database profiling before broad index work:
```bash
# Run against local/staging with realistic row counts through psql or Supabase SQL editor
packages/db/perf/profiling.sql
```

### cloudrun-pdf / cloudrun-archiver
```bash
# Tests internally run `npm run build` first — never skip build
npm --prefix cloudrun-pdf run test
npm --prefix cloudrun-archiver run test
```

### supabase/ (Deno — no npm scripts)
```bash
deno check supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
supabase functions serve mutation-gateway --env-file supabase/.env
```

### Repo-level CI scripts
```bash
node scripts/check-no-ts-nocheck.mjs   # blocks CI; run before pushing
node scripts/check-perf-budget.mjs     # warnings only, exits 0 always
```

---

## CI (`.github/workflows/ci.yml`)

All jobs run in parallel on every push/PR with **Node 22**:

- `repo_guards` → `check-no-ts-nocheck.mjs`
- `packages_contracts` → `npm ci` → typecheck → build
- `packages_db` → `npm ci` → typecheck → build
- `website` → `npm ci` → **test → typecheck → lint → build** (order matters)
- `phone_app` → `npm ci` → test → typecheck
- `cloudrun_pdf` / `cloudrun_archiver` → `npm ci` → test (build is embedded in test)
- `supabase_edge` → `deno check` on all edge `.ts` files
- `perf_budget` → `continue-on-error: true` (never blocks)
- `cloudrun_images` → Docker build (no push)

Edge deploy (`supabase-edge-deploy.yml`) is **manual `workflow_dispatch` only**. Nested function paths (e.g. `contact/request`) are flattened to `contact-request` before deploy.

---

## @ts-nocheck policy (enforced by CI)

`check-no-ts-nocheck.mjs` blocks new `@ts-nocheck` in:
- `website/src`, `website/tests`
- `phone_app/components`, `phone_app/contexts`, `phone_app/tests`, `phone_app/firebase.ts`
- `phone_app/modules/` (allowlist of legacy files exempted; all new files blocked)
- `packages/contracts`

Do not add `@ts-nocheck` to any file in those paths.

---

## Required environment files (not committed)

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
BACKEND_EDGE_FUNCTIONS_BASE_URL=   # optional; defaults to ${SUPABASE_URL}/functions/v1
NEXT_PUBLIC_FIREBASE_*=            # all Firebase public vars
FIREBASE_ADMIN_*=                  # service account vars
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
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
TAX_AUTH_URL=, TAX_TOKEN_URL=, TAX_CLIENT_ID=, TAX_CLIENT_SECRET=, ...
APP_SCHEME=erpsystem
```

### `phone_app/` env + native files
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```
Also requires: `phone_app/google-services.json`, `phone_app/GoogleService-Info.plist`

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

### `vat_number` is immutable after onboarding
`updateBusinessInfoV1` must reject mutations to this field.

### Invite redemption
Must consume invite state atomically before finalizing membership (prevents multi-join races).

### Inventory mutations
Inventory movement writes must use SQL helpers. Multi-part picks use `apply_inventory_pick_batch(...)` so balance changes and movement rows commit or fail together.

---

## Per-package conventions

### website/
- `page.tsx` = server component wrapper only — **never add `"use client"` to `page.tsx`**
- `page-client.tsx` = client shell pattern
- Auth: Supabase bearer → HttpOnly `__session` cookie. No tokens in `localStorage` or JS-readable cookies.
- Tailwind v4 with `@tailwindcss/postcss`; forms via React Hook Form + Zod v4

### phone_app/
- Local persistence: `react-native-mmkv` — **never `AsyncStorage`** for MMKV-owned surfaces
- Auth transport tokens: Expo SecureStore — never MMKV, AsyncStorage, localStorage, or JS-readable cookies
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
- Puppeteer 24; Docker base `ghcr.io/puppeteer/puppeteer:24.2.1`
- Must set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable` in container env

---

## Existing instruction sources

More detailed domain rules live in:
- `.github/copilot-instructions.md` — repo-wide domain, identity, counter, doc/job rules
- `website/.github/copilot-instructions.md` — website auth, route, API proxy, doc flow rules
- `phone_app/.github/copilot-instructions.md` — mobile structure, design system, data rules
- `architecture.md`, `backend.md`, `SETUP.md`, `SUPABASE-MIGRATION-GUIDE.md`
