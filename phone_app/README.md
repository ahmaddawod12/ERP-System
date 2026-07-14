# Smart-Job ERP Mobile App

`phone_app/` is the Expo 57 / React Native 0.86 client for post-login field operations.

React and React DOM remain on Expo 57's supported 19.2.3 pair so the JavaScript
runtime matches React Native's renderer. This client does not enable React
Server Components.

## Runtime Role

- Uses Supabase access tokens for backend transport.
- Stores Supabase access and refresh tokens in Expo SecureStore, not MMKV.
- Calls backend gateway endpoints for protected operations.
- Keeps registration and business onboarding on the website.
- Uses React Native Firebase Messaging for remote FCM delivery and
  `react-native-notify-kit` for local display, notification actions, channels,
  and badge state. NotifyKit is configured not to intercept iOS remote events.
- Publishes non-tax preview/generate work through the authenticated versioned
  document-task API and polls `/document-tasks/{taskId}` for completion. Tax
  invoice type 305 remains on the dedicated tax-authority workflow.
- Treats public sequential job IDs and member numbers as the client-facing job contract.
- Uses SQL-backed read-model pages for clients, jobs, documents, and inventory through backend gateway helpers.
- Edge function caller URLs use flattened dash names for nested paths (e.g., `contact-request`, `invites-create`) to match Supabase deploy names.

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
- The assigned-worker jobs screen calls the versioned Cloud Run jobs endpoint
  with a tenant-scoped TanStack infinite query. Query keys include `uid` and
  `companyId`, cursors stay opaque, and cached pages remain visible when a
  refresh fails.
- Client Book calls the versioned clients endpoint with bounded debounced
  search, active-only default paging, and opaque infinite cursors. Client
  create/edit/delete-or-archive also use the authenticated Cloud API with
  opaque entity versions, retry-stable idempotency keys, and tenant-scoped
  React Query invalidation; cache client actions contain no Edge callable or
  Firebase data write. Company inventory uses `/inventory` for manager/user/dev,
  while workers use only `/inventory/me`; query keys include `uid` and
  `companyId`, stale pages remain visible on refresh failures, and mapped rows
  preserve both part `entityVersion` and location `stockEntityVersion`.
  Manager/dev company create/update writes and worker self-stock adjustments
  now use the authenticated Cloud API with Expo Crypto UUID idempotency keys;
  user company inventory is read-only. Successful writes invalidate only the
  current tenant query prefix, and failures keep the last query data visible.
- Document History calls the versioned `/documents` endpoint with SQL-executed
  type, date, and client-search filters plus opaque infinite cursors. Query keys
  include `uid` and `companyId`, stale pages remain visible after refresh
  failures, and generated files are opened through the authenticated
  `/documents/{documentId}/download` signer instead of Firebase Storage or an
  Edge callable. Non-tax preview/generate publishers use the versioned Cloud API
  with strict shared-contract validation and retry-stable idempotency keys.
  Ungenerated documents can be deleted with their opaque entity version; a
  successful delete invalidates only the active tenant's document queries.
  Tax invoice preview/submission remains isolated on the tax workflow and type
  305 is rejected before either generic document publisher is called.
- Basic, module-disabled, and forged cross-member inventory routes issue no
  request. Canonical transfer/pick API helpers exist, but the worker company-
  catalog picker stays disabled until a scoped picker UI can supply a validated
  public member number and current stock versions; never restore its legacy
  full-company read.
- Team management calls the versioned workers and invitations endpoints with
  bounded opaque cursor pages. Managers invite workers to redeem access with
  their own verified Supabase account; edits and guarded disable/restore writes
  use opaque entity versions and retry-stable idempotency keys. The mobile app
  never creates Auth users or calls the legacy Firebase worker callable.
- Use `utils/logger.ts` for debug output so noisy logs are dev-only; keep warnings/errors visible.
- Native config files (`google-services.json`, `GoogleService-Info.plist`) and `.env` files must not be committed; they are listed in `phone_app/.gitignore`.
- Solo finished jobs use the per-user SQLCipher outbox for both online and
  offline submission. The durable operation is committed before foreground
  synchronization starts and keeps one stable idempotency key across retries.
- Photos and signatures are copied into per-user, app-owned AES-256-GCM chunks
  before enqueue. Image MIME is detected from file bytes, each file is limited
  to 10 MiB, the combined set is limited to 50 MiB, and base64 signatures are
  never written to a plaintext cache file.
- Outbox synchronization runs only on app start, foreground, and connectivity
  restoration. Pending work remains encrypted across logout and can resume only
  for the same Supabase user.
- Synchronization reports `reconciled`, `queued`, `retry`, `conflict`, or
  `terminal` per operation. Online submission shows success only for a confirmed
  reconciliation; Settings exposes Pending Work with manual retry and explicit
  discard for every retained operation.
- Opening the outbox fails closed unless the native SQLite build reports a
  non-empty SQLCipher version. Logout, auth loss, and workspace/user switches
  cancel and evict the old query scope and release its encrypted MMKV instance;
  durable snapshots and keys remain available only to that same user.
- Assigned-job completion uses the same per-user SQLCipher outbox as solo jobs.
  The jobs read model carries the opaque `entityVersion` into navigation, and
  photos/signatures are encrypted before `job.complete_assigned` is committed.
- Notification listeners and push-token registration should start only after auth + cache bootstrap succeeds for the active session; notification channel initialization must stay idempotent.
- Register and clear native FCM tokens through `/api/v1/me/push-token` with the
  active Supabase user identity plus one UUID-like installation ID stored only
  in SecureStore. Logout clears only that installation, attempts server cleanup
  before local session teardown, and still proceeds when cleanup is offline.
  Tokens are not cached in MMKV or written to logs.
- Notification data must contain the exact restored `uid` and current accessible
  `companyId` before foreground display or open navigation. Android local
  notifications use the private `smart_job_private_v2` channel; do not reuse the
  legacy public channel ID.
- Keep RNFirebase as the remote-message owner. Do not enable NotifyKit FCM mode
  or its Notification Service Extension plugin unless the push payload and
  background-handler architecture are migrated together.
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
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_BACKEND_API_BASE_URL`
- `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL` (optional)

The backend API URL may be local HTTP only in development (`localhost`,
`127.0.0.1`, `10.0.2.2`, or `::1`); release builds require HTTPS. The Edge URL
remains only for feature slices that have not yet moved to the Cloud Run API.

## Commands

```bash
npm install
npm start
npm run android
npm run ios
npm run web
npm run typecheck
npm run test
npm run doctor
```

## Native Requirements

- `google-services.json`
- `GoogleService-Info.plist`
- APNs / Firebase Cloud Messaging project configuration if push notifications are enabled for the environment
- `react-native-notify-kit` is a native, New-Architecture-only dependency.
  Expo Go is not supported; validate notifications in an EAS development or
  release build.
- After installing or upgrading NotifyKit, create a fresh Android and iOS
  native build. An Expo OTA update cannot install or replace its native code.
- The launch screen is configured through the `expo-splash-screen` config
  plugin; do not restore the removed top-level legacy `splash` field.

## Build

```bash
eas build --platform android
eas build --platform ios
```

## References

- `../SETUP.md`
- `../backend.md`
- `../architecture.md`
