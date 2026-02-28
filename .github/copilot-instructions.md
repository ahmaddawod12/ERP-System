# GitHub Copilot Instructions - Smart-Job ERP Monorepo

These instructions apply to the full repository.

## 2026 Source of Truth Updates

- Mobile UI must follow the design system in `phone_app/theme.js` and shared components in `phone_app/components/`.
- Business registration is website-only (`website/src/app/register`, `website/src/app/onboarding`).
- Mobile route `phone_app/app/BusinessReg.js` was removed. Do not recreate it.

## Current Version Targets (2026-02-27)

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
- Job IDs are server-generated plain Base62 from `jid` (no prefix).
- Document IDs are plain Base62 (no prefix).
- Valid statuses: `pending`, `waiting`, `finished`, `denied`

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
- Use `useAlert()` and never `Alert.alert()`.
- Keep `GlobalHeader` usage consistent with existing screen patterns.

## Website Coding Rules (`website/`)

- Registration/onboarding flows belong to website.
- `/register` creates Firebase Auth user only.
- `/onboarding` performs provisioning:
  - manager/solo -> `registerBusinessV1`
  - worker -> `/api/onboarding/join-company` -> `joinCompanyV1`
- Use existing form stack and validation patterns already used in the app.
- Keep API route and Cloud Function proxy patterns consistent with current code.
- Dashboard pages (`/app/*`) use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps client in `<Suspense>`.
  - `page-client.tsx` — `"use client"` shell with all hooks and interactivity.
  - Do not add `"use client"` directly to `page.tsx` files.
- Static marketing pages (`/`, `/features`, `/pricing`, `/security`, `/contact`, `/terms`, `/privacy`, `/solutions/*`) use `export const revalidate = 3600` for ISR.
- `middleware.ts` handles auth redirect for `/app/*` routes.

## Functions Rules (`functions/`)

- Cloud Functions are split into domain modules under `functions/src/`:
  - `shared.js` — Firebase Admin init, constants, helpers, auth utilities
  - `auth.js` — manageWorker, registerBusinessV1
  - `jobs.js` — createJobV1, updateJobV1, deleteJobV1, acceptJobV1, triggers
  - `clients.js` — addClientV1, deleteClientV1, updateClientV1
  - `documents.js` — generateDocumentV1, publishPreviewTask, publishGenerateTask, deleteDocumentV1, onTaskCompleted
  - `tax.js` — startTaxAuthorityAuth, taxAuthorityCallback, getInvoiceApproval (me-west1)
  - `invites.js` — createInviteV1, joinCompanyV1
  - `inventory.js` — updateInventoryV1
  - `profile.js` — updateProfileV1, updatePushTokenV1, updateBusinessInfoV1, updateCacheV1, clearPushTokenV1
  - `misc.js` — requestUpgradeV1, contactRequestV1
- `functions/index.js` is a thin re-exporter — do not add logic there.
- All shared utilities must be imported from `./shared.js`.
- Keep role checks explicit.
- Preserve App Check and auth verification behavior where already enforced.
- Avoid schema drift: use canonical field names (`uid`, `companyId`, `workerId`, `he_name`, `en_name`, `vat_number`).
- Node 22 runtime provides native `fetch()` — do not add `node-fetch` or similar polyfills.
- Validate array field lengths against `MAX_JOB_ARRAY_LENGTH` (200) in job mutation functions.
- Validate item counts against `MAX_ITEMS_PER_DOCUMENT` (100) in document generation functions.
- PubSub is lazy-loaded via `getPubSub()` — do not import `@google-cloud/pubsub` at top level.

## Do Not Introduce

- `username`, `companyName`, or email-derived path keys
- Legacy job status names (`in_progress`, `completed`, `received`)
- Separate `PendingJobs`/`finishedJobs` collections (use unified `jobs` collection)
- `p_`/`f_`/`d_` ID prefixes (use plain Base62 IDs)
- A new mobile business-registration route
- Ad hoc UI styles that bypass the shared design system
- `node-fetch` or similar polyfills (Node 22 has native `fetch()`)
- Direct Firestore client writes to locked collections (`clients`, `jobs`, `documents`, `invites`, `workers`)
- `Alert.alert()` or `RNAlert.alert()` in mobile code (use `useAlert()` only)
