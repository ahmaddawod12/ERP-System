# Smart-Job ERP Mobile App

`phone_app/` is the Expo + React Native mobile client for Smart-Job ERP. It is used after sign-in by managers, workers, solo users, and basic users for day-to-day product workflows.

## Current Product Role

The mobile app is not the onboarding surface.

- Registration happens on the website.
- Business onboarding happens on the website.
- Company join/onboarding flows happen on the website.
- The mobile app is for login, jobs, inventory, clients, documents, support, settings, and notifications.

Do not add mobile registration/business-onboarding routes back into this app.

## Current Stack

- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/*` `^24.0.0`
- `react-native-mmkv` `^4.3.1`
- `@smart-job/contracts` local package

## Main Responsibilities

- Role-based homepages for managers, workers, users, and basic users
- Job creation, assignment, fill, submit, approve/deny, finish flows
- Company and personal inventory workflows
- Shared client book flows
- Document preview/history/access flows
- Support conversations
- Profile/settings/preferences
- Push-token registration and notification-driven entry points

## App Structure

```text
app/                 Route wrappers and Expo Router entry files
modules/             Feature modules and screen logic
components/          Shared UI primitives
contexts/            Theme, language, cache, alert, storage contexts
hooks/               Shared React hooks
utils/               App utilities and backend helpers
tests/               Mobile tests
theme.ts             Design tokens and palette helpers
firebase.ts          Firebase app/bootstrap wiring
```

## Key Modules

### `modules/auth/`

- Login flow and auth entry.

### `modules/homepage/`

- Manager, Worker, User, and Basic home screens.

### `modules/team/`

- Team and worker-management related screens.

### `modules/solojob/`

- Solo-user job flows.

### `modules/documents/`

- Document generation, previews, history, and access.

### `modules/inventory/`

- Personal and company inventory flows.

### `modules/clients/`

- Client book features.

### `modules/support/`

- Support chat and support-related UX.

### `modules/settings/`

- Preferences, profile-related screens, and app settings.

## Architecture Notes

### Screen organization

- `app/` files are thin route wrappers.
- Business logic belongs in `modules/`.
- Shared UI should come from `components/` before creating one-off widgets.
- Theme/design tokens live in `theme.ts`.

### Local state and cache

- MMKV is the local persistence layer for preferences and app cache surfaces.
- Cache/version coordination flows are still used so the app can refresh data predictably.

### Backend access model

The mobile app does not talk directly to SQL.

- Firebase Auth is still the identity layer.
- Protected writes go through Cloud Functions.
- Read-model/backend endpoints can be backed by SQL when the backend is running in SQL mode.
- Some compatibility and realtime surfaces still rely on Firebase services.

### Persistence context

- The overall project now has a SQL-backed domain layer available through the backend.
- The app still integrates with Firebase services for auth, functions, storage, and selected client data flows.
- The mobile client should treat backend APIs as the source of truth for protected business actions.

## Important Data Rules

- Identity is `uid`.
- Company scope is `companyId`.
- Protected collections such as jobs, clients, documents, invites, and workers are not direct-write client surfaces.
- Job/document attachment records persist canonical `storagePath` references.
- Signed URLs are requested from the backend when a file needs to be opened or downloaded.
- Solo finished jobs must create the backend job first, then upload files under the returned server job ID, then attach those refs through the backend mutation flow.

## Design System Notes

- Use `getColors(isDarkMode)` from `theme.ts`.
- Prefer shared primitives such as `AppText`, `AppInput`, `AppButton`, `AppCard`, and related shared components.
- Keep route wrappers thin and place logic in modules.
- Use `withGate` for role/module gating.
- Use `useAlert()` instead of raw React Native alert APIs.
- Use `safeJsonParse()` instead of unguarded `JSON.parse()` in screen modules.

## Current Firebase Dependencies

- Auth
- Firestore
- Functions
- Messaging
- Storage
- App Check

These are client integration layers. The backend still owns protected business rules and persistence decisions.

## Local Development

```bash
npm install
npm start
```

## Scripts

```bash
npm start
npm run android
npm run ios
npm run web
npm run test
npm run typecheck
```

## Native Configuration

- Android package: `erpsystem.app`
- iOS bundle identifier: `erpsystem.app`
- Firebase native config files live in this folder:
  - `google-services.json`
  - `GoogleService-Info.plist`

## Build

```bash
eas build --platform ios
eas build --platform android
```

## QA Checklist

- Test iOS and Android flows.
- Test manager, worker, user, and basic roles.
- Test light/dark theme behavior.
- Test EN/HE/AR layout and direction handling.
- Verify document and attachment flows still use backend-issued access URLs.

For environment/bootstrap setup, use the root `SETUP.md`.
