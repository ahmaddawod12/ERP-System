# Smart-Job ERP Mobile App (`phone_app`)

Smart-Job ERP mobile is a React Native + Expo Router app for field-service businesses. It supports solo operators and team-based companies on iOS and Android.

## New Design Baseline (2026)

The app now follows one design system so every screen stays visually consistent.

- Theme tokens are centralized in `theme.js` (`getColors`, spacing, radius, shadows, typography, motion).
- Shared primitives in `components/` are the default UI building blocks.
- `GlobalHeader` is the standard top shell for in-app screens.
- Screen implementations live in `modules/`, while `app/` files are thin route wrappers.

## Registration Flow (Important)

- Business registration and onboarding happen on the website only.
- Mobile app no longer has `app/BusinessReg.js`.
- Do not add mobile registration screens or routes unless product requirements change.

## Version Snapshot (2026-04-13)

From `phone_app/package.json`:

- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/*` `^23.8.8`
- MMKV `^4.1.1`
- `@smart-job/contracts` (local workspace package)

## Core Features

- Role-based access: `manager`, `worker`, `user`, `basic`, `dev`
- Job lifecycle: create, assign, fill, submit, approve/deny, finish
- Inventory: personal, worker, and company inventory workflows
- Client book with shared company records
- Document generation and history
- MMKV + Firestore cache versioning
- Multi-language support (EN/HE/AR)
- Light and dark themes

## Architecture

```text
app/                 # Route files (thin wrappers only)
modules/             # Feature implementations
  auth/              # Login screen logic
  homepage/          # ManagerHomepage, WorkerHomepage, UserHomepage, BasicHomepage
  settings/          # Settings screen logic
  team/
  solojob/
  documents/
  inventory/
  shared/            # withGate, shared utilities
  support/           # SupportChat screen logic
  clients/           # ClientBook screen logic
components/          # Shared UI components
contexts/            # Theme, language (MMKV), cache, alert providers
  mmkv-storage.js    # Zero-React-dependency MMKV utilities (storage, getStorage, CACHE_KEYS, scope helpers)
  CacheContext.js    # React cache provider, composes extracted cache hooks/services
  use-cache-*.ts     # Domain cache actions (version, jobs, workers, clients)
hooks/               # Custom hooks
utils/               # Utilities
```

Structural note:
- `modules/support/support-copy.ts` holds support translations, template questions, and category metadata.
- `modules/documents/document-config.ts` and `modules/documents/document-copy.ts` hold document creation config and localized copy.
- Keep large screen modules focused on orchestration/state and extract static tables or pure helper logic before adding more branches.

## Design Rules for New Screens

1. Use `getColors(isDarkMode)` from `theme.js` instead of hardcoded colors.
2. Prefer shared components first: `AppText`, `AppButton`, `AppInput`, `SearchInput`, `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`.
3. Keep route files in `app/` minimal; business logic belongs in `modules/`.
4. Use `withGate` for gated screens.
   Client screens are role/tier-gated; do not introduce a fake `enabledModules.clients` gate.
5. Use `useAlert()` instead of `Alert.alert()`. All `Alert.alert()` / `RNAlert.alert()` calls have been eliminated from the codebase as of 2026-02-28.
6. Prefer `AppInput` over raw `TextInput` from `react-native` in module screens. All module screens now use `AppInput` (migrated 2026-02-28). Component-level wrappers (e.g. `SearchInput`, `ClientSelector`) may use raw `TextInput` internally.
7. For MMKV storage utilities in non-React code, import from `contexts/mmkv-storage.js`. `CacheContext` re-exports them for backward compatibility.
8. Import shared constants (`DOC_TYPE`, `DOC_SUFFIX`, `VAT_RATE`, etc.) from `@smart-job/contracts` — do not define local duplicates.
9. `ThemeContext` uses the shared MMKV store from `mmkv-storage.js` (not a separate MMKV instance).
10. `AlertContext` values are memoized (`useCallback` / `useMemo`) to prevent unnecessary re-renders.
11. Use `safeJsonParse()` from `utils/helpers` instead of raw `JSON.parse()` for route params and cached data. Never use unguarded `JSON.parse()` in screen modules.

## Data and API Rules

- Identity is `uid` (Firebase Auth UID), never email-derived usernames.
- Company scope is always `companyId` (backend-assigned; never fallback to `uid`).
- All jobs live in `companies/{companyId}/jobs/{jobId}` (status determines lifecycle).
- Document paths use `companies/{companyId}/documents/{docId}`.
- Saved document records store `storagePath`; mobile resolves short-lived PDF URLs through backend functions when opening history items.
- Historical archives are fetched through `fetchArchiveMonthV1`; the app must not read archive JSON directly from Storage.
- Job attachments also persist canonical `{ storagePath }` refs; mobile resolves signed preview/download URLs through backend functions instead of persisting `getDownloadURL()` bearer URLs.
- Job IDs are backend-generated sequential string IDs.
- Non-tax document IDs are canonical backend-generated strings of the form `{DOC_SUFFIX}{documentNumber}-{companyId}`.
- Firestore rules lock all writes to `clients`, `jobs`, `documents`, `invites`, and `workers` collections. Only Cloud Functions (Admin SDK) can mutate them.
- Manager membership docs are readable through rules but writes remain backend-only.
- Use Cloud Functions for all writes (`createJobV1`, `updateJobV1`, `updateClientV1`, `updateInventoryV1`, etc.).
- Support chat state changes also go through callable Functions (`createSupportConversationV1`, `appendSupportMessageV1`, `markSupportConversationReadV1`, `closeSupportConversationV1`).
- Closed support conversations cannot be appended to; start a new thread or use an explicit reopen flow if one is added later.
- Company document PDFs are backend-controlled.
- User job attachments may upload only to the signed-in user's own `uid/jobs/{jobId}` path, must persist canonical `storagePath` refs, and must never persist durable Storage download URLs.
- Solo finished jobs must call `createJobV1` first, upload files under the returned server job ID, then attach `photos`/`signature` through `updateJobV1`. Do not upload solo files with temporary job IDs.
- Solo finished-job inventory deduction is server-side and atomic in `createJobV1`; mobile must not apply a second local inventory write after save.
- Tax invoice calls to `getInvoiceApproval` must include a fresh `idempotencyKey` so retries cannot duplicate external submissions.
- Managers do not set worker passwords. New workers claim access through password reset from the login screen.
- Server-side validation limits: `MAX_ITEMS_PER_DOCUMENT = 100`, `MAX_JOB_ARRAY_LENGTH = 200`.
- Inventory is still an array-backed document today; backend writes enforce a Firestore document-size budget. Do not add direct client writes or a mobile-only subcollection migration.
- Valid job statuses: `pending`, `waiting`, `finished`, `denied`.

## Run Locally

```bash
npm install
npx expo start
npm test
npm run typecheck
```

## Build

```bash
eas build --platform ios
eas build --platform android
```

## Quick QA Checklist

- Test iOS and Android.
- Test light and dark mode.
- Test EN/HE/AR text direction and layout.
- Verify all updated screens still use shared primitives and theme tokens.
