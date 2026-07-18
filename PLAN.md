# Smart-Job ERP Architecture Implementation Plan

## Summary

Implement a clean pre-launch migration with no production fallback:

- Managed Supabase for Postgres, Auth, and application files.
- One Node 22/Fastify modular API on Cloud Run, placed near the Supabase database.
- One stateless tax gateway on Cloud Run `me-west1` for Israeli tax-authority traffic.
- Existing PDF Cloud Run service retained; archiver remains a Cloud Run Job.
- Next.js 16 remains on Vercel and becomes server-rendered with a thin BFF.
- Expo 57 remains for iOS/Android; replace its custom auth/cache/offline infrastructure.
- Website sessions become opaque Postgres-backed sessions with a 12-hour absolute lifetime.
- Mobile offline v1 covers finished-job creation, assigned-job completion, and attachments.
- No background synchronization: process on app start, foreground, and connectivity restoration.
- Preserve encrypted pending work across logout for the same user.
- Require verified email before onboarding.
- Use current Supabase asymmetric JWT/JWKS and publishable/secret key conventions.
- Use the temporary Cloud Run URL in staging. A custom API domain is a production mobile-release gate.

Each package remains independently installed. New build order:

```text
packages/contracts
  ├── packages/api-contracts
  └── packages/db
        └── cloudrun-api

packages/api-contracts
  ├── website
  ├── phone_app
  ├── cloudrun-api
  └── cloudrun-tax
```

## Implementation Stages

### 0. Stabilize the current repository

- Fix the unterminated regex in `supabase/handlers/jobs.ts`, missing RPC execution grants, and make a fresh migration run succeed.
- Fix mobile typecheck: obsolete `StyleSheet.absoluteFillObject` usage, Node test types, and remaining strict errors.
- Replace the website React Hook Form `watch()` lint warning with `useWatch`.
- Upgrade React/React DOM from 19.2.3 to a patched 19.2.4+ release.
- Correct the Supabase Admin user-response parsing and login/session navigation race.
- Add characterization fixtures for all current read kinds and mutation operations before replacing them.
- Gate completion on Edge Deno check, existing tests, typechecks, lint, builds, and fresh-database migration.

### 1. Add shared API contracts and service foundations

- Create `packages/api-contracts` with Zod schemas for request bodies, responses, DTOs, cursor pages, errors, workspaces, uploads, and entity versions.
- Keep enums and canonical constants in `@smart-job/contracts`; do not duplicate statuses, roles, document types, or VAT.
- Create `cloudrun-api` as a strict Node 22/Fastify service with Zod/OpenAPI integration, structured logs, request IDs, configuration validation, `/healthz`, and `/readyz`.
- Create `cloudrun-tax` as a strict, stateless Fastify service in `me-west1`.
- Add root-context multi-stage Dockerfiles running as a non-root user.
- Add API, tax, integration-test, and image-build jobs to CI.
- Use GitHub OIDC/Workload Identity Federation, Artifact Registry, Secret Manager, and immutable image tags—never downloaded service-account keys.

### 2. Establish database security, sessions, and request context

After the required schema-migration approval checkpoint:

- Create a least-privileged `smart_job_api` runtime role distinct from the migration credential.
- Wrap every authenticated database operation in a transaction that sets `request.jwt.claim.sub`, statement timeout, lock timeout, and idle-transaction timeout locally.
- Keep SQL RPCs for counters, invite redemption, registration, inventory batches, job creation, rate limits, and sync-version bumps.
- Add `private.web_sessions` containing only a SHA-256 session-token hash, encrypted Supabase access/refresh credentials, user/session IDs, expiries, CSRF hash, last workspace preference, and revocation timestamps.
- Encrypt stored credentials with AES-256-GCM using a Secret Manager key. Refresh tokens under a row lock so concurrent requests perform one rotation.
- Add `private.api_idempotency` keyed by user, tenant, operation, and idempotency key, including request hash and completed response.
- Add `private.file_upload_sessions` with owner, tenant, purpose, target job, expected file manifest, expiry, and consumption state.
- Add an atomic `complete_job_with_details(...)` SQL function covering job state, attachments, parts, inventory consumption, and sync-version changes.
- Extend operational cleanup to expired sessions, idempotency rows, upload sessions, and abandoned temporary objects.

Authentication rules:

- Mobile sends Supabase bearer tokens.
- The API verifies asymmetric JWTs through JWKS with exact issuer, audience, expiry, and subject.
- Role and company authorization always come from SQL memberships, never JWT user metadata or incoming payloads.
- Next sends `Authorization: SmartJobSession <opaque-token>` server-to-server.
- Internal API/PDF/tax/maintenance calls use Cloud Run service identity.
- Migrate client keys to Supabase publishable keys and reserve secret keys for server-only Auth/Storage administration.

### 3. Implement the domain API directly against Postgres

Do not build an Edge proxy because there are no production clients. Use Edge fixtures only as behavioral references.

Implement modules in this order:

1. Workspaces, user/company sync state, document-task status.
2. Workers, clients, inventory, jobs, documents, and bootstrap reads.
3. Profile, push tokens, support, upgrade requests, and contact.
4. Client mutations, worker management, and invitations.
5. Inventory mutations and atomic picks.
6. Job creation, updates, completion, deletion, and attachment access.
7. Document tasks, archive retrieval, and PDF dispatch.
8. Business registration.
9. Tax approval/callback integration last.

Requirements:

- Every public `companyId` is normalized to an internal UUID before database access.
- All role, tier, tenant, creator, status, date, document-type, search, limit, page-size, and cursor filters execute in SQL.
- Composite cursors remain `(createdAt, id)`, opaque to clients.
- Default page size is 50, maximum 200; no endpoint drains entire collections.
- Mutations accept `Idempotency-Key`; updates/completion use an opaque entity version and reject stale writes with HTTP 409.
- Writes have one transaction owner and never use compensating “delete then restore” logic.
- Personalized responses use `Cache-Control: private, no-store`.
- API timeout is 12 seconds; longer work becomes an asynchronous task.

### 4. Unify files, PDF processing, and tax traffic

- Create one private Supabase Storage bucket for active company files.
- Issue short-lived signed upload sessions from the API. Mobile never receives a secret key or writes directly through Firebase Storage.
- Use paths owned by the upload session and authenticated user; finalization verifies size, MIME type, hash, tenant, target job, and object existence.
- Consume the upload session in the same database transaction as job creation/completion.
- Switch generated PDFs and previews from application-facing GCS paths to Supabase Storage.
- Preserve create-only uploads and guarded SQL finalization; never overwrite an existing generated PDF.
- Keep GCS only for internal monthly archives.
- Use `document_tasks` as a durable dispatch outbox: claim pending tasks with leases, publish to Pub/Sub, retry safely, and let the PDF consumer claim idempotently.
- Make `cloudrun-tax` stateless:
  - Main API remains the only database writer.
  - Main API invokes the Israel service through Cloud Run IAM.
  - Tax service performs OAuth/authority network calls and returns normalized results.
  - Public callbacks terminate in Israel, validate their signature/OIDC and idempotency, then call a protected internal main-API endpoint.
  - Never log tax credentials or invoice payloads.

Because the environment is empty, do not add a legacy Firebase/GCS file-backfill layer. Stop and revise the plan if real customer objects are discovered.

### 5. Refactor the Next.js website

Session and security:

- Login goes through a same-origin Next Route Handler, which creates an API web session and sets one production cookie named `__Host-sj_web_session`.
- Cookie properties: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no Domain, 12-hour absolute expiry.
- Add a readable `sj_csrf` cookie; require matching `X-SJ-CSRF` and exact `WEBSITE_ORIGIN` on mutations.
- `proxy.ts` only checks cookie presence/format and redirects optimistically. Definitive session and authorization checks remain in the DAL/API.
- Require verified email before onboarding.
- Handle confirmation and password recovery server-side so recovery/access tokens never enter browser JavaScript.
- Remove the signed metadata cookie, raw access-token cookie, browser token memory, sessionStorage user reconstruction, and Firebase-named auth helpers.

Rendering and data flow:

- Add a server-only session/workspace DAL and runtime-validating backend transport.
- Use explicit tenant routes:

```text
/app/select-company
/app/c/{companyId}
/app/c/{companyId}/jobs
/app/c/{companyId}/clients
/app/c/{companyId}/inventory
/app/c/{companyId}/documents
```

- Zero memberships route to onboarding, one auto-selects, and multiple require selection.
- Fetch initial ERP data in Server Components and pass safe DTOs into small Client Components.
- Use TanStack Query only for refresh, polling, optimistic mutations, and infinite cursors after server-rendered initial data.
- Convert vertical slices in this order: overview, clients, workers/settings/admin, jobs, inventory, documents.
- Split oversized pages and add feature-level loading, empty, disabled, and error states.
- Remove `firebase` and `firebase-admin` after the final auth/data path is gone.
- Deploy through Vercel using server-only `BACKEND_API_BASE_URL`; browsers never call Cloud Run directly.

### 6. Refactor the Expo mobile app

Application shell:

```text
SessionProvider
  TenantProvider
    QueryClientProvider
      OutboxProvider
        NotificationProvider
          Expo Router
```

- Move bootstrap from `app/index.tsx` into the root layout.
- Create `(auth)` and `(protected)` route groups; protected routes cannot mount before session and tenant restoration.
- Use `@supabase/supabase-js` with a SecureStore adapter, single-flight refresh, and AppState-driven refresh lifecycle.
- Add an explicit workspace selector and atomic tenant switching.
- Cancel old-tenant requests before switching; every query key includes `uid` and `companyId`.
- Use TanStack Query and `useInfiniteQuery`; retain stale data on failures instead of replacing it with empty results.
- Use AES-256 encrypted MMKV only for preferences and bounded query snapshots.
- Keep Firebase App, Messaging, and Notifee for push notifications.
- Remove Firebase Firestore, Storage, and App Check after migration.

Offline field-job outbox:

- Add Expo SQLite with SQLCipher, one encrypted database per user, with its key stored in SecureStore.
- Support only:
  - `job.create_finished`
  - `job.complete_assigned`
  - associated photos/signatures
- Store operation identity, tenant, payload, idempotency key, entity version, attempts, retry time, lease, status, and error.
- Copy attachments into app-owned storage before enqueueing; encrypt staged files in chunks with AES-256-GCM and record SHA-256 hashes.
- Retry network errors, timeouts, 408/425/429, and 5xx using jittered backoff.
- Pause on 401; expose 403/404 as terminal errors and 409 as a user-visible conflict or idempotent replay.
- Synchronize only on app start, foreground, and connectivity restoration.
- Preserve pending work on logout, close its database, remove keys from memory, and allow only the same authenticated user to resume it.
- Delete staged files only after confirmed server reconciliation or explicit user discard.

### 7. Deployment, cutover, and cleanup

- Use local Supabase CLI/Docker plus local API containers for development.
- Deploy main API near the Supabase region selected by measured latency; use `me-west1` for tax.
- Initial production defaults:
  - Main API: min instance 1, concurrency 8, DB pool 5.
  - Staging/tax: min instance 0.
  - Cap instances so `maxInstances × poolSize` consumes at most 60% of available database connections.
- Deploy staging on generated `run.app` URLs and point Vercel preview/mobile development builds at them.
- Run complete staging acceptance before changing production configuration.
- Before the first public mobile release, configure a stable custom API domain, managed TLS, and final EAS/Vercel environment variables.
- After successful cutover, remove Edge callers, Deno deployment workflow, Firebase Storage/Firestore/App Check, and compatibility abstractions. Obtain explicit approval before deleting the major Edge directories.
- Update existing documentation—`AGENTS.md`, project summary, architecture/backend/setup guides, and package READMEs—rather than creating parallel setup documents.

## Public Interfaces

Common response envelope:

```ts
type ApiResponse<T> =
  | { ok: true; data: T; meta: { requestId: string; nextCursor?: string | null } }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
        fieldErrors?: Record<string, string[]>;
      };
      meta: { requestId: string };
    };
```

Primary route groups:

```text
/api/v1/auth/*
/api/v1/workspaces
/api/v1/me
/api/v1/companies/{companyId}/bootstrap
/api/v1/companies/{companyId}/jobs/*
/api/v1/companies/{companyId}/clients/*
/api/v1/companies/{companyId}/workers/*
/api/v1/companies/{companyId}/inventory/*
/api/v1/companies/{companyId}/document-tasks/*
/api/v1/companies/{companyId}/documents/*
/api/v1/support/conversations/*
/api/v1/upgrade-requests/*
/api/v1/contact-requests
/api/v1/uploads/job-attachments/*
```

Important shared types:

- `WorkspaceSummary`
- `Viewer`
- `CursorPage<T>`
- `EntityVersion`
- `ApiError`
- `JobAttachmentUploadSession`
- `JobCreateRequest`
- `JobCompletionRequest`
- `DocumentTask`
- Canonical request/response schemas for every route

## Test and Acceptance Plan

Backend:

- Fastify unit/contract tests for every route and malformed response.
- Integration tests against local Supabase with manager, worker, user, basic, and dev users across two tenants.
- Cross-tenant denial, wrong role, missing membership, forged company ID, expired/wrong JWT, and revoked web-session tests.
- Concurrent counters, invite redemption, inventory picks, job creation/completion, upload consumption, and idempotency tests.
- Stable pagination during concurrent inserts.
- Storage ownership, expired upload session, mismatched hash, duplicate finalize, and signed-download tests.
- Tax callback authentication/idempotency and document dispatch retry tests.

Website:

- Existing tests plus Playwright coverage for login, verification, refresh, hard reload, logout, recovery, workspace selection, forged tenant URLs, role navigation, pagination, jobs, inventory, and documents.
- Assert no Supabase token exists in HTML, browser storage, readable cookies, or JSON responses.
- Assert initial overview/table content exists before hydration and does not refetch immediately.

Mobile:

- Existing tests plus session-refresh race, cold deep link, notification launch, tenant switch, stale cache, and cursor tests.
- Offline create/complete test: enqueue, terminate app, restart, reconnect, and produce exactly one server mutation.
- Crash-after-upload and crash-after-server-commit reconciliation.
- Logout with pending work and same-user recovery.
- Typecheck, lint, Expo Doctor, Android/iOS development builds, and representative Maestro flows.

Release gates:

- All package tests, typechecks, lint, builds, Deno checks during transition, Docker builds, fresh migrations, and security guards pass.
- Staging smoke tests cover browser → API → database/storage/PDF and mobile → API → outbox/upload flows.
- No full-collection drains, browser-readable tokens, service-role client exposure, direct Firebase data writes, or non-atomic field-job completion remain.

## Assumptions and Approval Gates

- The environment has no production users, legacy clients, or customer files; therefore no runtime fallback, compatibility window, or file backfill is planned.
- Website hosting is Vercel; API/PDF/tax/jobs use Cloud Run; Supabase remains managed.
- Mobile production targets iOS and Android; Expo web is not a release gate because the Next.js website serves web users.
- No MFA or remember-me is included initially.
- Custom API DNS will be added later; production mobile release is blocked until it exists.
- Database migrations, deployment configuration changes, and final deletion of Edge/Firebase infrastructure require their explicit implementation-time approval checkpoints.
