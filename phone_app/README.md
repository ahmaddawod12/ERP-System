# Smart-Job ERP Mobile App

`phone_app/` is the Expo + React Native client for post-login field operations.

## Runtime Role

- Uses Supabase access tokens for backend transport.
- Stores Supabase access and refresh tokens in Expo SecureStore, not MMKV.
- Calls backend gateway endpoints for protected operations.
- Keeps registration and business onboarding on the website.
- Tracks preview/generate work through backend `document_tasks` polling.
- Treats public sequential job IDs and member numbers as the client-facing job contract.

## Architecture Rules

- Keep route wrappers in `app/`.
- Keep screen logic in `modules/`.
- Prefer shared components in `components/`.
- Use `useAlert()` instead of `Alert.alert()`.
- Use MMKV helpers in `contexts/mmkv-storage.ts`.
- Scope MMKV draft, pending-job, and support UI state by active `uid` / `companyId`; avoid raw global keys.
- Keep bearer and refresh tokens out of MMKV; token transport belongs in SecureStore-backed helpers.
- Archived month retrieval uses backend `fetchArchiveMonthV1`; the app does not read protected archive objects directly.
- Cache refresh logic must drain paginated jobs/documents read-model pages for the active 90-day cache window: open jobs, recently updated closed jobs, and recent documents.
- Cache refresh must preserve the current role-scoped jobs cache when only document versions bump.
- Read-model array helpers unwrap `{ items, nextCursor }` for legacy callers; use explicit page helpers when a screen needs cursor-aware pagination.
- Use `utils/logger.ts` for debug output so noisy logs are dev-only; keep warnings/errors visible.
- Offline queued solo jobs should be replaced by the server-created public job after sync succeeds; do not leave temp local duplicates behind.
- Solo finished jobs must upload photos/signatures before `createJobV1` so the created record already contains canonical attachment refs.
- Attachment uploads should use canonical company-scoped storage paths and may carry a temporary `attachmentUploadId` until the server allocates the final public job number.
- Notification listeners and push-token registration should start only after auth + cache bootstrap succeeds for the active session; notification channel initialization must stay idempotent.
- Keep protected writes backend-only.
- Treat tax invoice approval as an async backend flow that creates the draft document and schedules PDF generation.

## Core Structure

```text
app/            Expo Router route wrappers only
modules/        Feature logic grouped by domain
  root/         App bootstrap entry used by app/index.tsx
  home/         Role home dashboards
  jobs/         Job list, edit, fill, and job file helpers
  workers/      Worker/team screens
  documents/    Document screens, components, hooks, and static config/copy
components/     Shared UI grouped as primitives, layout, forms, feedback, and domain
navigation/     Stable route constants used by screens and notification handling
contexts/       Theme, alert, cache, auth, storage
hooks/          Shared hooks
utils/          Request helpers and utilities
tests/          Mobile tests
theme.ts        Design tokens
firebase.ts     Auth wrappers and gateway helpers
```

## Environment Variables

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL` (optional)

If edge base URL is unset, the app defaults to `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1`.

## Commands

```bash
npm install
npm start
npm run android
npm run ios
npm run web
npm run typecheck
npm run test
```

## Native Requirements

- `google-services.json`
- `GoogleService-Info.plist`
- APNs / Firebase Cloud Messaging project configuration if push notifications are enabled for the environment

## Build

```bash
eas build --platform android
eas build --platform ios
```

## References

- `../SETUP.md`
- `../backend.md`
- `../architecture.md`
