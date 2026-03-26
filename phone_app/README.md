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

## Version Snapshot (2026-02-28)

From `phone_app/package.json`:

- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- `@react-native-firebase/*` `^23.8.6`
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
  CacheContext.js    # React cache provider, re-exports mmkv-storage for backward compat
hooks/               # Custom hooks
utils/               # Utilities
```

## Design Rules for New Screens

1. Use `getColors(isDarkMode)` from `theme.js` instead of hardcoded colors.
2. Prefer shared components first: `AppText`, `AppButton`, `AppInput`, `SearchInput`, `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`.
3. Keep route files in `app/` minimal; business logic belongs in `modules/`.
4. Use `withGate` for gated screens.
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
- Job and document IDs are plain Base62 (no prefix).
- Firestore rules lock all writes to `clients`, `jobs`, `documents`, `invites`, and `workers` collections. Only Cloud Functions (Admin SDK) can mutate them.
- Use Cloud Functions for all writes (`createJobV1`, `updateJobV1`, `updateClientV1`, `updateInventoryV1`, etc.).
- Server-side validation limits: `MAX_ITEMS_PER_DOCUMENT = 100`, `MAX_JOB_ARRAY_LENGTH = 200`.
- Valid job statuses: `pending`, `waiting`, `finished`, `denied`.

## Run Locally

```bash
npm install
npx expo start
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
