# GitHub Copilot Instructions - Smart-Job ERP Monorepo

These instructions apply to the full repository.

Use `SETUP.md` as the canonical setup and deployment guide. Do not create new setup-only markdown files for Cloud Run, Pub/Sub, notifications, or email; update `SETUP.md` instead.

## 2026 Source of Truth Updates

- Mobile UI must follow the design system in `phone_app/theme.js` and shared components in `phone_app/components/`.
- Business registration is website-only (`website/src/app/register`, `website/src/app/onboarding`).
- Mobile route `phone_app/app/BusinessReg.js` was removed. Do not recreate it.
- Stored account types are canonical in `@smart-job/contracts`: only `solo` and `business`.
- Website may present a Basic workspace option, but it must resolve to canonical runtime values: `accountType: solo`, `role: basic`.
- Saved company documents persist `storagePath`; fetch short-lived PDF URLs through backend functions instead of storing durable bearer download URLs on document records.
- Job attachments must also persist canonical `{ storagePath }` refs; never persist durable Storage download URLs for job photos or signatures.
- Solo finished jobs must create the Firestore job first, upload attachments under the returned server job ID, then attach file refs with `updateJobV1`.
- Tax invoice submissions must include an `idempotencyKey`; linked jobs/proposals are validated server-side before the Tax Authority request.
- Upgrade moderation is backend-controlled; do not update `upgrade_requests` directly from Firestore clients or admin UIs.
- Firestore transactions must read before they write. Never add `tx.get()` after any transaction write call.
- Notification triggers must claim idempotency/dedup records before sending external push side effects.
- Cloud Run PDF generation must preserve create-only semantics for new generated PDFs/documents and clean up orphaned files on finalize failure.

## Current Version Targets (2026-04-13)

### Mobile (`phone_app/package.json`)
- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/*` `^23.8.8`

### Website (`website/package.json`)
- Next.js `16.2.3`
- React / React DOM `19.2.3`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`

### Functions (`functions/package.json`)
- Node `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`
- Axios `^1.15.0`

When generating code, prefer compatibility with these versions.

## Core Identity and Firestore Rules

1. Identity:
- Always use Firebase Auth `uid` for user-scoped data.
- Always use `companyId` for company-scoped data.
- `companyId` is allocated by backend registration from `system/data/comid` (never `uid` fallback).
- Never derive identifiers from email.
- Canonical onboarding tuples are only `manager + business`, `user + solo`, and `basic + solo`.

2. Inventory model:
- Inventory currently remains a single document with a `parts` array and `nextId`.
- Backend mutations must enforce the inventory document-size budget before writes.
- Do not introduce a partial client-side subcollection migration. A future migration to `inventoryParts/{partId}` must be backend-led and include readers, rules, backfill, and rollback.

3. Job model:
- All jobs live in a single `jobs` collection; status determines lifecycle phase.
- Job IDs are server-generated sequential string IDs from `companies/{companyId}/counters/jnext`.
- Document IDs are canonical string IDs. Non-tax documents currently use `{DOC_SUFFIX}{documentNumber}-{companyId}` (for example `PP42-1007`); do not invent alternate ID formats client-side.
- Valid statuses: `pending`, `waiting`, `finished`, `denied`
- Job fields use short canonical names: `wid`/`wname` (worker), `mid`/`mname` (manager), `cid`/`cname`/`cphone` (client).
- Do not use old field names: `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name`.

4. Writes:
- Firestore rules lock all writes to `clients`, `jobs`, `documents`, `invites`, and `workers` collections (`allow create, update, delete: if false`). Only Cloud Functions (Admin SDK) can mutate them.
- Firestore rules also expose read-only manager membership docs at `companies/{companyId}/managers/{mid}`; writes remain backend-only.
- All protected mutations must go through the corresponding Cloud Function.
- Prefer callable/HTTP function flows over direct client writes for all company-scoped data.
- Support conversations are function-controlled; clients may only call the support mutation functions.
- Support mutation callables are rate-limited per authenticated user; preserve those limits when editing support flows.
- Company Storage writes for `companies/{companyId}/documents/*` are backend-only.
- Company document PDFs, company job-file reads, and company archives are backend-controlled; direct client reads from `companies/{companyId}/documents/*`, `companies/{companyId}/jobs/*`, and `companies/{companyId}/archives/*` are not allowed.
- User job attachments may upload only to owner paths (`{uid}/jobs/{jobId}/*`) and must be shared cross-user only through backend-issued signed URLs (`createJobFileDownloadUrlV1`).
- Archived months must be loaded through `fetchArchiveMonthV1` so role filtering happens server-side before data reaches the client.
- Server-side limits: `MAX_ITEMS_PER_DOCUMENT = 100`, `MAX_JOB_ARRAY_LENGTH = 200`.

## Mobile Coding Rules (`phone_app/`)

- Keep screen logic in `modules/`.
- Keep `app/` files as thin wrappers and route entries.
- Use `withGate` for role/module-gated screens.
- Use shared primitives (`AppText`, `AppInput`, `AppButton`, `AppCard`, etc.) before custom one-off UI.
- Prefer `AppInput` over raw `TextInput` from `react-native` in module screens. Component-level wrappers (e.g. `SearchInput`, `ClientSelector`) may use raw `TextInput` internally.
- Use `useAlert()` and never `Alert.alert()`.
- Use `safeJsonParse()` from `utils/helpers` instead of raw `JSON.parse()` for route params and cached data. Never use unguarded `JSON.parse()` in screen modules.
- Keep `GlobalHeader` usage consistent with existing screen patterns.
- MMKV utilities (`storage`, `getStorage`, `CACHE_KEYS`, scope helpers) live in `contexts/mmkv-storage.js`. Import from there for non-React code; `CacheContext` re-exports them for backward compatibility.
- `ThemeContext` uses the shared MMKV store from `mmkv-storage.js` — do not create separate MMKV instances for preferences.
- `AlertContext` values are memoized (`useCallback` / `useMemo`) — preserve this when modifying alert logic.
- Screen modules live in `modules/{domain}/` organized by feature:
  - `modules/auth/` — Login
  - `modules/homepage/` — ManagerHomepage, WorkerHomepage, UserHomepage, BasicHomepage
  - `modules/settings/` — Settings
  - `modules/team/`, `modules/solojob/`, `modules/documents/`, `modules/inventory/`, `modules/support/`, `modules/clients/`, `modules/shared/` — existing feature modules

## Website Coding Rules (`website/`)

- Registration/onboarding flows belong to website.
- `/register` creates Firebase Auth user only.
- `/onboarding` performs provisioning:
  - manager/solo -> `registerBusinessV1`
  - worker -> `/api/onboarding/join-company` -> `joinCompanyV1`
  - basic workspace -> `registerBusinessV1` with canonical `accountType: solo`
- Use existing form stack and validation patterns already used in the app.
- Keep API route and Cloud Function proxy patterns consistent with current code.
- `cn()` utility (`src/lib/utils.ts`) uses `clsx` + `tailwind-merge` for conflict-free class merging.
- All page routes use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps client in `<Suspense>`.
  - `page-client.tsx` — `"use client"` shell with all hooks and interactivity.
  - Do not add `"use client"` directly to `page.tsx` files.
  - This applies to `/app/*` dashboard pages AND public auth pages (`/login`, `/register`, `/forgot-password`, `/onboarding`).
- Static marketing pages (`/`, `/features`, `/pricing`, `/security`, `/contact`, `/terms`, `/privacy`, `/solutions/*`) use `export const revalidate = 3600` for ISR.
- `middleware.ts` handles auth redirect for `/app/*` routes.
- Auth middleware uses an HttpOnly `__session` cookie set by `/api/auth/session`. Do not write Firebase ID tokens into JavaScript-readable cookies.
- Login redirect validation blocks `//` prefix URLs to prevent open redirects.
- `buildAuthedJsonHeaders()` in `client-auth.ts` calls `getIdToken(true)` to force-refresh the token.
- Invite, join-company, upgrade-request, and contact HTTP functions use Firestore-backed rate limiting; keep Next.js API routes as thin validation/proxy layers.
- `website/src`, `website/tests`, `functions/src`, `functions/tests`, `packages/contracts`, `phone_app/components`, `phone_app/contexts`, and `phone_app/tests` are protected typed surfaces. Do not add `@ts-nocheck` there.
- CSP includes `base-uri 'self'` and `form-action 'self'` directives. `'unsafe-inline'` in `script-src` is required by Next.js hydration — migrate to nonce-based CSP when Next.js supports it.

## Functions Rules (`functions/`)

- Cloud Functions are split into domain modules under `functions/src/`:
  - `shared.js` — Firebase Admin init, constants, and thin aggregator/wrapper exports for shared infra helpers such as busy-flag & Pub/Sub helpers (`clearCompanyBusyFlag`, `acquireCompanyBusyFlag`, `publishGenerateTaskHelper`)
  - `shared-http.js` — HTTP/CORS/auth-header helpers and request validation helpers used by `shared.js`
  - `shared-access.js` — canonical profile/company access and membership validation helpers used by `shared.js`
  - `auth.js` — manageWorker, registerBusinessV1
  - `jobs.js` — createJobV1, updateJobV1, deleteJobV1, acceptJobV1, triggers
  - `job-mutation-resolver.js` — canonical worker/client resolution and denormalized job payload shaping
  - `clients.js` — addClientV1, deleteClientV1, updateClientV1
  - `documents.js` — publishPreviewTask, publishGenerateTask, deleteDocumentV1, createDocumentDownloadUrlV1, fetchArchiveMonthV1, onTaskCompleted
  - `tax.js` — startTaxAuthorityAuth, taxAuthorityCallback, getInvoiceApproval (me-west1)
  - `tax-oauth.js` — Tax Authority OAuth config/deep-link/callback HTML helpers used by `tax.js`
  - `invites.js` — createInviteV1, joinCompanyV1
  - `inventory.js` — updateInventoryV1
  - `profile.js` — updateProfileV1 (syncs worker + manager docs), updatePushTokenV1, updateBusinessInfoV1, updateCacheV1, clearPushTokenV1
  - `support.js` — support conversation/message mutation boundary
- `misc.js` — requestUpgradeV1, listUpgradeRequestsV1, moderateUpgradeRequestV1, contactRequestV1
- `functions/index.js` is a thin re-exporter — do not add logic there.
- All shared utilities must be imported from `./shared.js`.
- Keep role checks explicit.
- Preserve App Check and auth verification behavior where already enforced.
- When adding new infra helpers, prefer focused helper modules behind `shared.js` instead of expanding `shared.js` with more unrelated inline logic.
- HTTP Functions called through trusted website server proxies (`joinCompanyV1`, invite routes, upgrade routes) intentionally set `enforceAppCheck: false`; do not turn that back on unless the proxy architecture changes too.
- Avoid schema drift: use canonical field names (`uid`, `companyId`, `wid`, `wname`, `mid`, `mname`, `cid`, `cname`, `cphone`, `he_name`, `en_name`, `vat_number`).
- Counters live in `companies/{companyId}/counters/{wnext|mnext|cnext|jnext}` subcollection, each doc has `{ next: <number> }`.
- Workers are keyed by `wid` (sequential ID) at `companies/{companyId}/workers/{wid}`, not by Firebase Auth UID.
- Profile stores `wid` for workers and `mid` for managers.
- Node 22 runtime provides native `fetch()` — do not add `node-fetch` or similar polyfills.
- Validate array field lengths against `MAX_JOB_ARRAY_LENGTH` (200) in job mutation functions.
- Validate item counts against `MAX_ITEMS_PER_DOCUMENT` (100) in document generation functions.
- PubSub is lazy-loaded via `getPubSub()` — do not import `@google-cloud/pubsub` at top level.
- Busy-flag helpers (`clearCompanyBusyFlag`, `acquireCompanyBusyFlag`, `publishGenerateTaskHelper`) live in `shared.js` — do not duplicate them in domain modules.
- `updateProfileV1` syncs name/phone changes to worker and manager membership docs inside a Firestore transaction when `wid` or `mid` is present.
- `updateCacheV1` has an `ALLOWED_CACHE_FIELDS` whitelist. Do not accept arbitrary fields.
- Personal worker-scoped resources (user inventory, cross-user cache bumps, user job/inventory storage paths) must not be shared across same-company managers. Same company is not sufficient authorization.
- `updateBusinessInfoV1` is restricted to manager roles only.
- `tax.js` token refresh uses a Firestore transaction to avoid race conditions when multiple concurrent requests attempt to refresh the same OAuth token.
- Tax invoice approval uses reservation records at `companies/{companyId}/tax_invoice_reservations/{documentId}`. Never decrement invoice counters on failure; rejected numbers are burned/reserved in state instead.
- `isCert` is server-managed. Do not accept `isCert` from client job update payloads.
- Inventory quantities and document item amounts must be finite and non-negative; usage quantities must be finite and positive where stock is deducted.
- Worker accounts must not be created with manager-supplied passwords. Use backend-generated secrets and password-reset claim flows.
- `auth.js` writes a marker document to `system/orphaned_users/pending/{uid}` when orphaned auth user cleanup fails, for later reconciliation.
- `shared.js` rate limiting is Firestore-backed (`rate_limits/{hash}`) so it remains effective across multiple function instances.
- Upgrade moderation must remain inside `moderateUpgradeRequestV1`; Firestore rules intentionally block direct client updates/deletes on `upgrade_requests`.
- `shared.js` email validation (`isValidEmail`) requires a minimum 2-char TLD and max 254-char total length.
- `documentTasks` documents include an `expireAt` TTL field (30 days) for automatic cleanup.
- `documentTasks` stuck in `processing` may be reclaimed by Cloud Run after `DOCUMENT_TASK_PROCESSING_STALE_AFTER_MS`.
- Closed support conversations are terminal until a dedicated reopen action exists; do not append messages to a closed conversation.

## Cloud Run Services

### `cloudrun-pdf/`
- Express + Puppeteer PDF generation service with preview and generate endpoints.
- Both `/preview` and `/generate` verify requester identity (uid + companyId + role) from Firestore before processing.
- `google-auth-library` is used for OIDC JWT verification of Pub/Sub push requests.
- `@google-cloud/pubsub` is NOT a direct dependency — messages arrive via HTTP push, not pull.
- `VAT_RATE` constant (0.18) is defined locally in `htmlTemplate.js` for Israeli tax rate (sync note references `@smart-job/contracts`).
- All document HTML is forced to Hebrew (`effectiveLanguage = 'he'`) per Israeli tax regulations. The en/ar label tables are retained for future non-tax document types.
- `acquireTab()` returns the browser generation counter. Callers must validate the generation hasn't changed before using the browser, to detect browser restarts during tab waits.
- Logo cache has a size cap (`LOGO_CACHE_MAX_SIZE = 100`) with LRU eviction.
- Pub/Sub push handlers return `200` for permanent failures (bad payload, validation errors) to prevent infinite retries. Only transient errors (browser crash, timeout) return `500` for Pub/Sub retry.
- Pub/Sub push requests should use OIDC verification and, when configured, the shared `x-pubsub-token` header. Do not weaken this to token-only auth in production.
- New non-tax generated documents use `ifGenerationMatch: 0` Storage preconditions and Firestore `create()`. Do not change this to overwrite semantics.
- If a generated PDF is saved but Firestore finalization fails, the service must attempt to delete the orphaned file before marking the task failed.

### `cloudrun-archiver/`
- Batch Cloud Run Job that archives old Firestore data (finished jobs + documents) to Cloud Storage.
- Date fields (`finishedAt`, `createdAt`) are stored as ISO-8601 strings — queries must use string comparison, not Firestore Timestamps.
- Idempotent via per-company manifest files in Cloud Storage.
- Archives include SHA-256 checksums in Storage metadata; `verifyArchive()` validates both doc count and integrity.
- Delete only exact document IDs captured in the verified archive. Do not delete by re-running a date-range query after upload.

## Shared Contracts Package (`packages/contracts/`)

- `@smart-job/contracts` exports canonical enums (`Role`, `JobStatus`, `DocType`, `Tier`, `SubStatus`), SCREAMING_SNAKE aliases (`DOC_TYPE`), lookup maps (`DOC_SUFFIX`), constants (`VAT_RATE`), path builders (`paths.*`), and `resolveCompanyScope`.
- Wired as `file:../packages/contracts` dependency in `functions/` and `phone_app/`.
- Prefer importing shared constants from `@smart-job/contracts` when adding new modules.
- Do not duplicate enum values that already exist in contracts.
- `cloudrun-pdf/` keeps local copies of `DOC_TYPE` and `VAT_RATE` (Docker can't use `file:` deps) with sync-note comments pointing back to contracts.

## Do Not Introduce

- `username`, `companyName`, or email-derived path keys
- Non-canonical job status names (`in_progress`, `completed`, `received`)
- Separate `PendingJobs`/`finishedJobs` collections (use unified `jobs` collection)
- `p_`/`f_`/`d_` ID prefixes or ad hoc ID formats that bypass canonical backend-generated IDs
- A new mobile business-registration route
- Ad hoc UI styles that bypass the shared design system
- `node-fetch` or similar polyfills (Node 22 has native `fetch()`)
- Direct Firestore client writes to locked collections (`clients`, `jobs`, `documents`, `invites`, `workers`)
- `Alert.alert()` or `RNAlert.alert()` in mobile code (use `useAlert()` only)
- `AsyncStorage` for language preference or hidden conversations (use MMKV via `storage` from `CacheContext`)
- Raw `Text` from `react-native` in context providers (use `AppText` from `components/`)
- Old job field names: `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name`, `id`, `jid`, `createdBy`
- Counters on company root doc (use `counters/` subcollection)
- Workers keyed by UID (use `wid` sequential ID)
- Transaction read-after-write patterns
- Push/email/Pub/Sub side effects before idempotency claims
