# GitHub Copilot Instructions - Smart-Job ERP Monorepo

These instructions apply to the full repository.

## Current Runtime State

As of April 26, 2026:

- Supabase Auth is the active auth provider for website and mobile sign-in.
- The in-repo backend runtime and trust boundary are under `supabase/functions/`.
- PostgreSQL, through `packages/db`, is the primary persistence layer for company-scoped ERP data.
- Firestore and Cloud Storage still support compatibility reads, operational metadata, rules-backed surfaces, and file storage.
- Supabase Edge gateway rollout is still in hardening, but repository backend runtime changes target `supabase/functions/` and `supabase/handlers/`.

This means backend migration code is live in `supabase/`. Treat `supabase/functions/` and `supabase/handlers/` as the implementation target for backend runtime changes in this repository.

## Canonical Docs

- Use `SETUP.md` for setup and deployment.
- Use `architecture.md` for the current storage and runtime map.
- Use `backend.md` for backend service boundaries.
- Use `SUPABASE-MIGRATION-GUIDE.md` and `supabase/README.md` for migration-specific work.

Do not create new setup-only markdown files for Cloud Run, Pub/Sub, notifications, or email. Update `SETUP.md` instead.

## Core Domain Rules

### Identity

- Always use `uid` as the canonical user identity key.
- In the current stack, that `uid` comes from Supabase-authenticated flows and must remain stable across backend, SQL, and compatibility surfaces.
- Always use `companyId` for tenant scope.
- `companyId` is backend-allocated through SQL counters; never derive it from `uid` or email.
- In backend handlers, normalize incoming/public `companyId` values to internal company UUIDs before SQL filters.
- Never derive identifiers from email.

### Counters and IDs

- Allocate sequential company-scoped IDs through SQL-backed counters.
- Do not allocate `public_company_id`, `member_no`, `client_no`, or `job_no` via `MAX + 1` query patterns.
- Prefer shared counter allocation helpers before inserting rows that require sequential numbers.
- Apply the same SQL counter requirement to tax invoice numbering (`doc_305`) and company inventory part numbering (`part_no`).

### Account and onboarding rules

- Stored account types are only `solo` and `business`.
- Canonical onboarding tuples are only `manager + business`, `user + solo`, and `basic + solo`.
- Website may present a Basic workspace option, but it must resolve to canonical runtime values: `accountType: solo`, `role: basic`.
- Business registration and onboarding remain website-only.
- Do not recreate the removed mobile business-registration route.

### Jobs and documents

- Valid job statuses are `pending`, `waiting`, `finished`, and `denied`.
- Use short canonical job identity fields: `wid`, `wname`, `mid`, `mname`, `cid`, `cname`, `cphone`.
- Do not reintroduce old field names such as `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name`, `id`, `jid`, or `createdBy`.
- Non-tax document IDs use the canonical backend-generated suffix-plus-number format.
- Tax invoice submissions must include an `idempotencyKey`.
- `updateBusinessInfoV1` must reject `vat_number` updates after onboarding.
- Document task URL fields are canonicalized by task type: `preview_url` for preview tasks and `generate_url` for generate tasks.

### Files and storage

- Persist canonical `storagePath` refs for generated PDFs, job photos, and signatures.
- Never persist durable Storage download URLs on document or job records.
- Signed access to company documents, job files, and archives stays backend-controlled.
- Keep signed URL buckets server-controlled; do not allow caller-selected buckets for protected file URLs.
- Archived months must be loaded through backend functions such as `fetchArchiveMonthV1`.

### Mutations and side effects

- Protected writes stay backend-only for locked business collections.
- All company-scoped business mutations should go through backend functions or gateways.
- Claim idempotency or deduplication before push, email, Pub/Sub, or other external side effects.
- Firestore transactions must read before they write.
- Do not weaken create-only semantics for generated document files and records.
- Keep invite redemption race-safe with atomic state transitions.

## Mobile Rules (`phone_app/`)

- Keep screen logic in `modules/` and route wrappers in `app/`.
- Follow the design system in `phone_app/theme.ts` and shared primitives in `phone_app/components/`.
- Prefer shared components such as `AppText`, `AppInput`, `AppButton`, and `AppCard` over raw one-off UI.
- Use `useAlert()` and never `Alert.alert()`.
- Use `safeJsonParse()` instead of raw `JSON.parse()` in screen modules.
- MMKV utilities live in `phone_app/contexts/mmkv-storage.ts`; do not create separate MMKV instances for preferences.
- Registration stays off mobile.

## Website Rules (`website/`)

- `/register`, `/login`, and `/forgot-password` use Supabase auth flows.
- `/api/auth/session` verifies the bearer token server-side and sets the HttpOnly `__session` cookie.
- `middleware.ts` protects `/app/*` routes.
- Keep API routes thin: parse, validate, auth-check if needed, then proxy.
- Keep form handling on the existing React Hook Form plus Zod patterns.
- Keep the server-wrapper plus client-shell route pattern: `page.tsx` as server component, `page-client.tsx` as client shell.
- Do not write protected business data directly from browser code.

## Backend Rules (`supabase/functions/` and `supabase/handlers/`)

- `supabase/functions/` is the active backend gateway surface in this workspace.
- `mutation-gateway`, `mutation-gateway-me-west1`, and `read-model` are active HTTP entry surfaces.
- Keep `read-model` request/response contracts aligned with website/mobile `kind` payloads.
- Keep role and company-scope checks explicit.
- For multi-step mutations, prefer atomic SQL transaction boundaries; if unavailable in the current handler layer, add explicit compensating cleanup logic.
- Reuse shared helper logic from `supabase/shared-edge-helpers.ts`.
- Preserve trusted-proxy and verification behavior where already enforced.
- Prefer focused domain modules under `supabase/handlers/` rather than growing unrelated inline logic.
- Avoid schema drift: use canonical field names and shared contract enums from `@smart-job/contracts`.
- Node 22 provides native `fetch()`; do not add `node-fetch` or similar polyfills.
- Validate `MAX_JOB_ARRAY_LENGTH` and `MAX_ITEMS_PER_DOCUMENT` limits where relevant.
- Support flows are SQL-backed now; do not reintroduce Firestore-backed support mutations.
- Rate limiting is SQL-backed in the current backend; do not reintroduce Firestore-backed rate-limit state for migrated paths.
- Keep CORS allowlists explicit. Do not rely on empty CORS allowlists as permissive behavior.

## Cloud Run Services

### `cloudrun-pdf/`

- Preserve requester validation, Pub/Sub OIDC verification, and canonical `storagePath` persistence.
- Keep create-only semantics for new generated files and records.
- If finalization fails after a PDF write, attempt orphan cleanup before marking failure.

### `cloudrun-archiver/`

- Preserve idempotent archive runs.
- Treat date fields as ISO strings where the service expects string comparison.
- Delete only the exact IDs captured in the verified archive.

## Shared Contracts And SQL

- Prefer importing enums, constants, and suffix maps from `@smart-job/contracts` instead of duplicating literals.
- Treat `packages/db` as the canonical SQL schema, migration, and access layer.
- Do not introduce direct client SQL access for protected ERP operations.

## Supabase Migration Rules

- `supabase/handlers/` is the current migration work area for extracted business logic.
- Keep website and mobile behavior unchanged while migrating backend runtime.
- Preserve region split between the default gateway and the `me-west1` tax gateway.
- Do not delete or bypass live compatibility runtime paths until rollout and cleanup phases explicitly require it.

## Do Not Introduce

- `username`, `companyName`, or email-derived path keys
- non-canonical job statuses such as `in_progress`, `completed`, or `received`
- ad hoc ID prefixes that bypass backend-generated canonical IDs
- a new mobile business-registration route
- direct client writes to locked collections
- durable bearer download URLs stored on document or job records
- `AsyncStorage` for MMKV-owned preference or cache surfaces
- raw `Text` in React Native context providers where `AppText` should be used
- transaction read-after-write patterns
- push, email, or Pub/Sub side effects before idempotency claims
