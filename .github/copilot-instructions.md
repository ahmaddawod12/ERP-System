# GitHub Copilot Instructions - Smart-Job ERP Monorepo

These instructions apply to the full repository.

## 2026 Source of Truth Updates

- Mobile UI must follow the design system in `phone_app/theme.js` and shared components in `phone_app/components/`.
- Business registration is website-only (`website/src/app/register`, `website/src/app/onboarding`).
- Mobile route `phone_app/app/BusinessReg.js` was removed. Do not recreate it.

## Current Version Targets (2026-02-28)

### Mobile (`phone_app/package.json`)
- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- `@react-native-firebase/*` `^23.8.6`

### Website (`website/package.json`)
- Next.js `16.1.6`
- React / React DOM `19.2.3`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`

### Functions (`functions/package.json`)
- Node `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`

When generating code, prefer compatibility with these versions.

## Core Identity and Firestore Rules

1. Identity:
- Always use Firebase Auth `uid` for user-scoped data.
- Always use `companyId` for company-scoped data.
- `companyId` is allocated by backend registration from `system/data/comid` (never `uid` fallback).
- Never derive identifiers from email.

2. Inventory model:
- Inventory is a single document with a `parts` array and `nextId`.
- Do not model inventory as a subcollection.

3. Job model:
- All jobs live in a single `jobs` collection; status determines lifecycle phase.
- Job IDs are server-generated plain Base62 from `counters/jnext` (no prefix).
- Document IDs are plain Base62 (no prefix).
- Valid statuses: `pending`, `waiting`, `finished`, `denied`
- Job fields use short canonical names: `wid`/`wname` (worker), `mid`/`mname` (manager), `cid`/`cname`/`cphone` (client).
- Do not use old field names: `workerId`, `completedBy`, `assignedTo`, `assignedBy`, `MUser`, `MName`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name`.

4. Writes:
- Firestore rules lock all writes to `clients`, `jobs`, `documents`, `invites`, and `workers` collections (`allow create, update, delete: if false`). Only Cloud Functions (Admin SDK) can mutate them.
- All protected mutations must go through the corresponding Cloud Function.
- Prefer callable/HTTP function flows over direct client writes for all company-scoped data.
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
- Auth cookie (`firebase-auth-token`) is set by `auth-provider.tsx` on sign-in and cleared on sign-out. The `Secure` flag is conditional on HTTPS (omitted on localhost). Middleware uses this cookie for server-side route guarding.
- Login redirect validation blocks `//` prefix URLs to prevent open redirects.
- `buildAuthedJsonHeaders()` in `client-auth.ts` calls `getIdToken(true)` to force-refresh the token.
- `/api/contact/request` has in-memory IP-based rate limiting (5 req/min).
- CSP includes `base-uri 'self'` and `form-action 'self'` directives. `'unsafe-inline'` in `script-src` is required by Next.js hydration — migrate to nonce-based CSP when Next.js supports it.

## Functions Rules (`functions/`)

- Cloud Functions are split into domain modules under `functions/src/`:
  - `shared.js` — Firebase Admin init, constants, helpers, auth, busy-flag & Pub/Sub helpers (`clearCompanyBusyFlag`, `acquireCompanyBusyFlag`, `publishGenerateTaskHelper`). Imports `DOC_TYPE`, `DOC_SUFFIX`, `VAT_RATE` from `@smart-job/contracts`.
  - `auth.js` — manageWorker, registerBusinessV1
  - `jobs.js` — createJobV1, updateJobV1, deleteJobV1, acceptJobV1, triggers
  - `clients.js` — addClientV1, deleteClientV1, updateClientV1
  - `documents.js` — publishPreviewTask, publishGenerateTask, deleteDocumentV1, onTaskCompleted
  - `tax.js` — startTaxAuthorityAuth, taxAuthorityCallback, getInvoiceApproval (me-west1)
  - `invites.js` — createInviteV1, joinCompanyV1
  - `inventory.js` — updateInventoryV1
  - `profile.js` — updateProfileV1 (syncs worker doc), updatePushTokenV1, updateBusinessInfoV1, updateCacheV1, clearPushTokenV1
  - `misc.js` — requestUpgradeV1, contactRequestV1
- `functions/index.js` is a thin re-exporter — do not add logic there.
- All shared utilities must be imported from `./shared.js`.
- Keep role checks explicit.
- Preserve App Check and auth verification behavior where already enforced.
- Avoid schema drift: use canonical field names (`uid`, `companyId`, `wid`, `wname`, `mid`, `mname`, `cid`, `cname`, `cphone`, `he_name`, `en_name`, `vat_number`).
- Counters live in `companies/{companyId}/counters/{wnext|mnext|cnext|jnext}` subcollection, each doc has `{ next: <number> }`.
- Workers are keyed by `wid` (sequential ID) at `companies/{companyId}/workers/{wid}`, not by Firebase Auth UID.
- Profile stores `wid` for workers and `mid` for managers.
- Node 22 runtime provides native `fetch()` — do not add `node-fetch` or similar polyfills.
- Validate array field lengths against `MAX_JOB_ARRAY_LENGTH` (200) in job mutation functions.
- Validate item counts against `MAX_ITEMS_PER_DOCUMENT` (100) in document generation functions.
- PubSub is lazy-loaded via `getPubSub()` — do not import `@google-cloud/pubsub` at top level.
- Busy-flag helpers (`clearCompanyBusyFlag`, `acquireCompanyBusyFlag`, `publishGenerateTaskHelper`) live in `shared.js` — do not duplicate them in domain modules.
- `updateProfileV1` syncs name/phone changes to the worker doc (looked up by `wid` from profile) inside a Firestore transaction. Preserve atomic profile+worker sync when modifying profile logic.
- `updateCacheV1` has an `ALLOWED_CACHE_FIELDS` whitelist. Do not accept arbitrary fields.
- `updateBusinessInfoV1` is restricted to manager roles only.
- `tax.js` token refresh uses a Firestore transaction to avoid race conditions when multiple concurrent requests attempt to refresh the same OAuth token.
- `auth.js` writes a marker document to `system/orphaned_users/pending/{uid}` when orphaned auth user cleanup fails, for later reconciliation.
- `shared.js` in-memory rate limiter has a size cap (`RATE_LIMIT_MAP_MAX_SIZE = 10_000`) and periodic cleanup to prevent unbounded memory growth.
- `shared.js` email validation (`isValidEmail`) requires a minimum 2-char TLD and max 254-char total length.
- `documentTasks` documents include an `expireAt` TTL field (30 days) for automatic cleanup.

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

### `cloudrun-archiver/`
- Batch Cloud Run Job that archives old Firestore data (finished jobs + documents) to Cloud Storage.
- Date fields (`finishedAt`, `createdAt`) are stored as ISO-8601 strings — queries must use string comparison, not Firestore Timestamps.
- Idempotent via per-company manifest files in Cloud Storage.
- Archives include SHA-256 checksums in Storage metadata; `verifyArchive()` validates both doc count and integrity.

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
- `p_`/`f_`/`d_` ID prefixes (use plain Base62 IDs)
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
