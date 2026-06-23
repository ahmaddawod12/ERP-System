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
# Bash: enable globstar so nested function paths (e.g., tax/callback) are included
shopt -s globstar
deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
supabase functions serve mutation-gateway --env-file supabase/.env
```

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
- `packages_db` → `npm ci` → typecheck → build
- `website` → builds `packages/contracts` → `npm ci` → **test → typecheck → lint → build** (order matters)
- `phone_app` → builds `packages/contracts` → `npm ci` → test → typecheck
- `cloudrun_pdf` → `npm ci` → typecheck → test
- `cloudrun_archiver` → builds `packages/contracts` + `packages/db` → `npm ci` → typecheck → test
- `supabase_edge` → `deno check` on all edge `.ts` files (uses `shopt -s globstar` to include nested paths)
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
JWT_SECRET=                                       # required for edge JWT verification
TAX_AUTH_URL=, TAX_TOKEN_URL=, TAX_CLIENT_ID=, TAX_CLIENT_SECRET=, ...
APP_SCHEME=erpsystem
```

### `phone_app/` env + native files
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
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

