# GitHub Copilot Instructions - Smart-Job ERP Mobile (`phone_app`)

These instructions apply only to `phone_app/`.

Use the root `SETUP.md` for environment setup, native app registration, push configuration, and release prerequisites.

## Current Mobile Reality

- mobile auth transport uses Supabase access tokens
- protected operations are routed through Supabase Edge gateway endpoints
- SQL is the primary ERP persistence layer behind backend services
- business registration remains website-only

## Version Targets

From `phone_app/package.json`:

- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/app` `^24.0.0`
- `@react-native-firebase/app-check` `^24.0.0`
- `@react-native-firebase/firestore` `^24.0.0`
- `@react-native-firebase/messaging` `^24.0.0`
- `@react-native-firebase/storage` `^24.0.0`

Write code compatible with these versions.

## Structure Rules

- Keep screen logic in `modules/`.
- Keep `app/` files as thin route wrappers.
- Use shared components from `components/` first.
- Keep static feature copy and large config tables in feature-local helper files instead of large screen components.
- MMKV helpers live in `contexts/mmkv-storage.ts`.
- Preserve existing extracted cache hooks under `contexts/use-cache-*.ts`.

## Navigation And Gating

- Use Expo Router APIs.
- Use `withGate` for role or module-gated screens.
- Preserve the existing role and tier access model.
- Do not invent a separate clients module flag for screens that are role-driven.

## Design System Rules

- Follow tokens from `theme.ts`.
- Prefer shared primitives such as `AppText`, `AppInput`, `AppButton`, `AppCard`, `SearchInput`, and `GlobalHeader`.
- Avoid hardcoded visual constants when tokens already exist.
- Prefer `AppInput` over raw `TextInput` in module screens.

## Alerts And Persistence

- Use `useAlert()` from `contexts/AlertContext`.
- Never use `Alert.alert()` or `RNAlert.alert()`.
- Use MMKV-backed storage helpers for local persistence.
- Do not reintroduce `AsyncStorage` for MMKV-owned preference or cache surfaces.

## Data Rules

- Use `uid` for user identity and `companyId` for company scope.
- `companyId` is backend-provided and must never fall back to `uid`.
- Never derive identifiers from email.
- Keep mobile read-model `kind` requests aligned with backend-supported kinds.
- Saved documents and job attachments persist canonical `storagePath` refs.
- Resolve document PDFs and job-file access through backend-issued short-lived URLs.
- Valid job statuses remain `pending`, `waiting`, `finished`, and `denied`.
- All protected job, support, client, document, and inventory mutations go through backend endpoints.
- Closed support conversations are terminal.

## Registration Rule

- Do not add new mobile registration or onboarding routes.
- If registration UX changes are required, implement them in `website/`.

## Implementation Checklist

- works on iOS and Android
- keeps `app/` wrappers thin and `modules/` focused
- uses theme tokens and shared primitives
- preserves canonical `uid` and `companyId` naming
- avoids obsolete routes and stale dependency assumptions
- keeps company documents, job files, and archives off direct Storage reads
