# GitHub Copilot Instructions - Smart-Job ERP Mobile (`phone_app`)

These instructions are specific to the mobile app.

## 2026 Design and Flow Updates

- UI must follow `theme.js` tokens and shared components in `components/`.
- Business registration is website-only.
- `app/BusinessReg.js` was removed and must not be reintroduced.

## Version Targets (2026-02-26)

From `phone_app/package.json`:

- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- `@react-native-firebase/app` `^23.8.6`
- `@react-native-firebase/auth` `^23.8.6`
- `@react-native-firebase/firestore` `^23.8.6`
- `@react-native-firebase/functions` `^23.8.6`
- `@react-native-firebase/messaging` `^23.8.6`
- `@react-native-firebase/storage` `^23.8.6`

Write code that is compatible with these versions.

## Architecture Rules

1. File structure:
- `modules/`: business logic screens by feature
- `app/`: route entries (prefer thin wrappers)
- `components/`: reusable design-system primitives

2. Gating:
- Use `withGate` for gated routes.
- Preserve existing role/module gate behavior.

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

3. Alerts:
- Never use `Alert.alert()`.
- Always use `useAlert()` from `contexts/AlertContext`.

## Data Rules

1. Identity:
- Use Firebase Auth `uid` for user identity.
- Use `companyId` for company scope.
- Never use email-derived usernames.

2. Job rules:
- Valid statuses: `pending`, `waiting`, `finished`, `denied`.
- Job mutations should use Cloud Functions.

3. Inventory rules:
- Inventory is a single document with `parts` + `nextId`.
- Do not refactor inventory into subcollections.

## Registration Rule (Hard Requirement)

- Do not create new mobile registration or onboarding routes.
- Mobile starts at login/auth and post-registration app flows only.
- If registration UX changes are needed, implement them in `website/`.

## Implementation Checklist for Generated Changes

- Works on iOS and Android.
- Uses design-system primitives and theme tokens.
- Keeps `app/` routes lightweight and `modules/` focused.
- Keeps uid/companyId naming and path conventions.
- Avoids stale dependencies and legacy route references.
