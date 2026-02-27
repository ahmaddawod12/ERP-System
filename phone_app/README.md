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

## Version Snapshot (2026-02-26)

From `phone_app/package.json`:

- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- `@react-native-firebase/*` `^23.8.6`
- MMKV `^4.1.1`

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
app/                 # Route files (mostly thin wrappers)
modules/             # Feature implementations
  team/
  solojob/
  documents/
  inventory/
  shared/
components/          # Shared UI components
contexts/            # Theme, language, cache, alert providers
hooks/               # Custom hooks
utils/               # Utilities
```

## Design Rules for New Screens

1. Use `getColors(isDarkMode)` from `theme.js` instead of hardcoded colors.
2. Prefer shared components first: `AppText`, `AppButton`, `AppInput`, `SearchInput`, `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`.
3. Keep route files in `app/` minimal; business logic belongs in `modules/`.
4. Use `withGate` for gated screens.
5. Use `useAlert()` instead of `Alert.alert()`.

## Data and API Rules

- Identity is `uid` (Firebase Auth UID), never email-derived usernames.
- Company scope is always `companyId` (backend-assigned; never fallback to `uid`).
- Document paths use `companies/{companyId}/documents/{d_XXXXX}`.
- Use `d_` as the canonical document ID prefix for new writes.
- Use Cloud Functions for protected writes (`createJobV1`, `updateJobV1`, `updateInventoryV1`, etc.).
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
