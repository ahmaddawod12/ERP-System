# Smart-Job ERP Website

Next.js App Router website for Smart-Job ERP (TypeScript + Tailwind + Firebase Web/Admin SDK).

## Stack

- Next.js App Router + TypeScript
- Firebase Web SDK (Auth + Firestore)
- Firebase Admin SDK (API routes + privileged proxy/auth checks)
- React Hook Form + Zod
- Tailwind CSS v4 with `tailwind-merge` (via `cn()` utility in `src/lib/utils.ts`)
- EN/HE/AR i18n with RTL
- Dark/light theme persistence

## Route Coverage

- Public: `/`, `/features`, `/solutions/hvac`, `/solutions/field-services`, `/pricing`, `/security`, `/docs`, `/docs/*`, `/contact`, `/privacy`, `/terms`
- Auth: `/register`, `/login`, `/forgot-password`
- Protected: `/app`, `/app/jobs`, `/app/workers`, `/app/inventory`, `/app/inventory-picks`, `/app/clients`, `/app/documents`, `/app/settings`, `/app/upgrade`, `/app/admin`

## Registration and Onboarding

- `/register` only creates Firebase Auth credentials.
- `/onboarding` writes profile/business data through backend functions:
  - Manager/solo provisioning: callable `registerBusinessV1`
  - Worker join flow: `/api/onboarding/join-company` -> HTTP `joinCompanyV1`
- Website keeps a UI-only Basic workspace choice, but backend writes stay canonical: `accountType: solo`, `role: basic`.
- `companyId` is backend-assigned from `system/data/comid` and never derived from `uid`.

## API Endpoints (Next.js -> Cloud Functions)

- `POST /api/invites/create` -> `createInviteV1`
- `POST /api/onboarding/join-company` -> `joinCompanyV1`
- `POST /api/upgrades/request` -> `requestUpgradeV1`
- `POST /api/upgrades/list` -> `listUpgradeRequestsV1`
- `POST /api/upgrades/moderate` -> `moderateUpgradeRequestV1`
- `POST /api/contact/request` -> `contactRequestV1` (no auth required)
- `POST /api/auth/session` -> verifies a Firebase ID token server-side and sets the HttpOnly `__session` middleware cookie

All endpoints return:

- Success: `{ ok: true, data }`
- Failure: `{ ok: false, error: { code, message, details? } }`

## Document Generation (Pub/Sub)

Current document flows:

1. Preview: `publishPreviewTask` callable -> Pub/Sub `document-preview` -> Cloud Run PDF -> `documentTasks/{taskId}.previewURL`
2. Generate: `publishGenerateTask` callable -> Pub/Sub `document-generate` -> Cloud Run PDF -> document record stores `storagePath`, while `documentTasks/{taskId}.downloadURL` carries a short-lived signed URL for immediate UX
3. Tax invoice (305): `getInvoiceApproval` callable (me-west1) with a required `idempotencyKey` -> Tax Authority API -> PDF task
4. Archive reads: backend callables such as `fetchArchiveMonthV1` load and filter archive JSON server-side before data is returned to clients

`useDocumentTask` (`src/hooks/use-document-task.ts`) manages task lifecycle via Firestore listeners on `documentTasks/{taskId}`.
Saved history downloads should resolve through `createDocumentDownloadUrlV1`, not persisted bearer URLs on the document doc.
Cloud Run PDF generation owns create-only non-tax document finalization and duplicate/stale task handling; website code must not write document records directly.

## Auth + Security Notes

- Production API calls require `Authorization: Bearer <Firebase ID token>`.
- Server routes validate request JSON with Zod before proxying.
- Firestore rules lock all writes to `clients`, `jobs`, `documents`, `invites`, and `workers` collections (`allow create, update, delete: if false`). Only Cloud Functions (Admin SDK) can mutate them.
- Manager membership docs at `companies/{companyId}/managers/{mid}` are readable to company members/admins but mutation-locked like workers.
- Support and moderation flows should go through server/API proxies or Functions, not direct browser writes.
- Server-side validation enforces `MAX_ITEMS_PER_DOCUMENT = 100` (tax invoices) and `MAX_JOB_ARRAY_LENGTH = 200` (job array fields).
- Firestore rules remain least-privilege and role-scoped (`manager`, `worker`, `user`, `basic`, `dev`).
- Storage access for company documents, company job files, and company archives is backend-controlled; browser code must use signed URLs or backend archive functions instead of direct bucket reads.
- `auth-provider.tsx` sends Firebase ID tokens to `/api/auth/session`; that route sets the `HttpOnly` `__session` cookie used by `middleware.ts`. Do not write Firebase ID tokens into JavaScript-readable cookies.
- Login redirect validation blocks `//` prefix URLs to prevent open redirects.
- `buildAuthedJsonHeaders()` calls `getIdToken(true)` to force-refresh the Firebase ID token.
- Invite, join-company, upgrade-request, and contact HTTP functions use Firestore-backed rate limiting in Functions; Next.js API routes are thin validation/proxy layers.
- CSP includes `base-uri 'self'` and `form-action 'self'` directives. `'unsafe-inline'` in `script-src` is required by Next.js hydration — migrate to nonce-based CSP when Next.js supports it.
- All page routes (dashboard and public auth pages) follow the server+client pattern: `page.tsx` (server, exports metadata) + `page-client.tsx` (client shell).

## Data Model

```
users/{uid}/data/profile                      -> user profile
users/{uid}/data/cache                        -> user cache versioning
users/{uid}/data/inventory                    -> { parts: [...], nextId, lastUpdated }

companies/{companyId}                         -> { companyId, createdBy, createdAt }
companies/{companyId}/data/subscription       -> { tier, status, enabledModules }
companies/{companyId}/data/business_info      -> business registration data
companies/{companyId}/data/inventory          -> { parts: [...], nextId, lastUpdated }
companies/{companyId}/data/cache              -> company cache versioning
companies/{companyId}/tax_invoice_reservations/{documentId} -> reserved/approved/rejected invoice states
companies/{companyId}/workers/{wid}           -> worker membership + role
companies/{companyId}/managers/{mid}          -> manager membership + role
companies/{companyId}/clients/{clientId}      -> client records
companies/{companyId}/jobs/{jobId}            -> all jobs (status determines lifecycle)
companies/{companyId}/documents/{docId}       -> generated documents (record + storagePath)
companies/{companyId}/invites/{inviteId}      -> onboarding invite codes

system/data/comid                             -> { comid: nextCompanyId, ... }
upgrade_requests/{id}                         -> upgrade request tickets
documentTasks/{taskId}                        -> preview/generate task state
```

Inventory is still stored as an array document today, but backend mutations enforce a Firestore document-size budget. Do not add browser-side direct writes or a website-only subcollection migration.

Canonical IDs:

- Company IDs: backend-assigned numeric string from `system/data/comid`
- Job IDs: server-generated sequential string IDs from `counters/jnext`
- Tax invoice IDs: reserved as `TI{documentNumber}-{companyId}` before approval finalization

## Environment Variables

Copy `.env.local.example` to `.env.local` and set:

- Public Firebase:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
- Admin SDK:
  - `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
  - or split vars: `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`
- Optional:
  - `CLOUDRUN_PDF_URL`

### Emulator Variables

- `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
- `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`

## Local Development

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

## Deployment (Vercel)

1. Set project root to `website/`
2. Add required env vars
3. Provide Firebase Admin credentials
4. Disable emulator vars in production
5. Deploy and verify API routes with real bearer tokens
