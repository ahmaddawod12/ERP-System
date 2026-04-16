# GitHub Copilot Instructions - Smart-Job ERP Mobile (`phone_app`)

These instructions are specific to the mobile app.

For environment setup, Firebase native app registration, FCM/APNs, EAS build prerequisites, and end-to-end release checks, use the root `SETUP.md` guide instead of adding mobile-specific setup docs.

## 2026 Design and Flow Updates

- UI must follow `theme.js` tokens and shared components in `components/`.
- Business registration is website-only.
- `app/BusinessReg.js` was removed and must not be reintroduced.
- Stored account types remain canonical (`solo` or `business`) through `@smart-job/contracts`; Basic is a role, not a stored account type.

## Version Targets (2026-04-13)

From `phone_app/package.json`:

- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/app` `^23.8.8`
- `@react-native-firebase/auth` `^23.8.8`
- `@react-native-firebase/firestore` `^23.8.8`
- `@react-native-firebase/functions` `^23.8.8`
- `@react-native-firebase/messaging` `^23.8.8`
- `@react-native-firebase/storage` `^23.8.8`

Write code that is compatible with these versions.

## Architecture Rules

1. File structure:
- `modules/`: business logic screens by feature (auth, homepage, settings, team, solojob, documents, inventory, support, clients, shared)
- `app/`: route entries (thin wrappers only — `import Screen from '../modules/X/Y'; export default Screen;`)
- `components/`: reusable design-system primitives
- Keep static feature copy/config in feature-local helper files (`modules/support/support-copy.ts`, `modules/documents/document-config.ts`, `modules/documents/document-copy.ts`) instead of growing screen files with giant literal tables.
- `contexts/mmkv-storage.js`: zero-React-dependency MMKV utilities (storage, getStorage, CACHE_KEYS, scope helpers)
- `contexts/CacheContext.js`: React cache provider, re-exports mmkv-storage for backward compat
- `contexts/use-cache-*.ts`: extracted cache action hooks for version, jobs, workers, and clients

2. Gating:
- Use `withGate` for gated routes.
- Preserve existing role/module gate behavior.
- Do not gate clients screens behind a fictional `enabledModules.clients` flag; clients access is role/tier-driven.

3. Navigation:
- Use Expo Router APIs (`useRouter`, `router.push`, `router.replace`, `router.back`).

## Design System Rules

1. Theme:
- Use `getColors(isDarkMode)` from `theme.js`.
- Prefer spacing/radius/shadow/typography tokens from `theme.js`.
- Avoid hardcoded visual constants when tokens exist.

2. Shared primitives first:
- Text: `AppText`
- Inputs: `AppInput`, `SearchInput`
- Buttons: `AppButton`, `PrimaryButton`, `SecondaryButton`, `DangerButton`
- Surfaces: `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`
- Layout/shell: `ScrollableContainer`, `GlobalHeader`

3. Inputs:
- Prefer `AppInput` over raw `TextInput` from `react-native` in module screens.
- Component-level wrappers (e.g. `SearchInput`, `ClientSelector`) may use raw `TextInput` internally.

4. Alerts:
- Never use `Alert.alert()` or `RNAlert.alert()`. All such calls were eliminated from the codebase on 2026-02-28.
- Always use `useAlert()` from `contexts/AlertContext`.

## Data Rules

1. Identity:
- Use Firebase Auth `uid` for user identity.
- Use `companyId` for company scope.
- `companyId` is backend-provided; never fallback to `uid`.
- Never use email-derived usernames.

2. Documents:
- Canonical Firestore path is `companies/{companyId}/documents/{docId}`.
- Non-tax document IDs are canonical string IDs built by the backend as `{DOC_SUFFIX}{documentNumber}-{companyId}`.
- Saved document records persist `storagePath`; mobile must request short-lived PDF URLs through backend functions instead of trusting durable stored download URLs.
- Job photos/signatures also persist canonical `{ storagePath }` refs; mobile must resolve signed URLs through backend functions and must never persist durable `getDownloadURL()` bearer URLs.
- Solo finished jobs must call `createJobV1` before uploading attachments, use the returned server job ID in Storage paths, then attach the uploaded refs with `updateJobV1`.
- Do not deduct solo finished-job inventory from mobile after save; `createJobV1` performs that server-side in the job transaction.
- Tax invoice submissions must pass a fresh `idempotencyKey` to `getInvoiceApproval`.
- Company archives must be fetched through `fetchArchiveMonthV1`; do not read archive JSON directly from Storage in mobile code.

3. Job rules:
- Valid statuses: `pending`, `waiting`, `finished`, `denied`.
- All job mutations must use Cloud Functions (`createJobV1`, `updateJobV1`, `deleteJobV1`, `acceptJobV1`).
- Firestore rules lock `jobs`, `clients`, `documents`, `invites`, and `workers` collections. Direct client writes are blocked.
- Support chat state and message writes must use support callables (`createSupportConversationV1`, `appendSupportMessageV1`, `markSupportConversationReadV1`, `closeSupportConversationV1`).
- Closed support conversations are terminal; do not append to a closed thread from mobile.
- Server-side limits: `MAX_JOB_ARRAY_LENGTH = 200` for array fields.

4. Inventory rules:
- Inventory is a single document with `parts` + `nextId`.
- Backend writes enforce a Firestore document-size budget.
- Do not refactor inventory into subcollections from mobile alone; that must be a backend-led migration with rules, readers, backfill, and rollback.

## Registration Rule (Hard Requirement)

- Do not create new mobile registration or onboarding routes.
- Mobile starts at login/auth and post-registration app flows only.
- If registration UX changes are needed, implement them in `website/`.

## Implementation Checklist for Generated Changes

- Works on iOS and Android.
- Uses design-system primitives and theme tokens.
- Keeps `app/` routes lightweight and `modules/` focused.
- Keeps uid/companyId naming and path conventions.
- Avoids stale dependencies and obsolete route references.
- Uses MMKV via `storage` from `CacheContext` for local persistence (not `AsyncStorage`).
- Uses `AppText` from `components/` in context providers (not raw `Text` from `react-native`).
- Keeps company document PDFs and archives off direct Storage client APIs and never stores durable Storage URLs for job attachments.
