# GitHub Copilot Instructions - Smart-Job ERP Monorepo

These instructions apply to the full repository.

## 2026 Source of Truth Updates

- Mobile UI must follow the design system in `phone_app/theme.js` and shared components in `phone_app/components/`.
- Business registration is website-only (`website/src/app/register`, `website/src/app/onboarding`).
- Mobile route `phone_app/app/BusinessReg.js` was removed. Do not recreate it.

## Current Version Targets (2026-02-26)

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
- Never derive identifiers from email.

2. Inventory model:
- Inventory is a single document with a `parts` array and `nextId`.
- Do not model inventory as a subcollection.

3. Job model:
- Job IDs are server-generated from `jid`.
- `PendingJobs`: `p_{jid}`
- `finishedJobs`: `f_{jid}`
- Document IDs in `companies/{companyId}/documents/*` must use `d_` prefix for new writes.
- Valid statuses: `pending`, `waiting`, `finished`, `denied`

4. Writes:
- Protected mutations should go through Cloud Functions.
- Prefer callable/HTTP function flows over direct client writes for protected paths.

## Mobile Coding Rules (`phone_app/`)

- Keep screen logic in `modules/`.
- Keep `app/` files as thin wrappers and route entries.
- Use `withGate` for role/module-gated screens.
- Use shared primitives (`AppText`, `AppInput`, `AppButton`, `AppCard`, etc.) before custom one-off UI.
- Use `useAlert()` and never `Alert.alert()`.
- Keep `GlobalHeader` usage consistent with existing screen patterns.

## Website Coding Rules (`website/`)

- Registration/onboarding flows belong to website.
- Use existing form stack and validation patterns already used in the app.
- Keep API route and Cloud Function proxy patterns consistent with current code.

## Functions Rules (`functions/`)

- Keep role checks explicit.
- Preserve App Check and auth verification behavior where already enforced.
- Avoid schema drift: use canonical field names (`uid`, `companyId`, `workerId`, `he_name`, `en_name`, `vat_number`).

## Do Not Introduce

- `username`, `companyName`, or email-derived path keys
- Legacy job status names (`in_progress`, `completed`, `received`)
- A new mobile business-registration route
- Ad hoc UI styles that bypass the shared design system
