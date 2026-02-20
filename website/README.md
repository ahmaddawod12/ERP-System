# Smart-Job ERP Website

Next.js App Router website for Smart-Job ERP (TypeScript + Tailwind + Firebase Web/Admin SDK).

## Stack

- Next.js App Router + TypeScript
- Firebase Web SDK (Auth + Firestore)
- Firebase Admin SDK (API routes + privileged writes)
- React Hook Form + Zod
- EN/HE/AR i18n with RTL
- Dark/light theme persistence

## Route Coverage

- Public: `/`, `/features`, `/solutions/hvac`, `/solutions/field-services`, `/pricing`, `/security`, `/docs`, `/docs/*`, `/contact`, `/privacy`, `/terms`
- Auth: `/register`, `/login`, `/forgot-password`
- Protected: `/app`, `/app/jobs`, `/app/workers`, `/app/inventory`, `/app/inventory-picks`, `/app/clients`, `/app/documents`, `/app/settings`, `/app/upgrade`, `/app/admin`

## API Endpoints

- `POST /api/documents/generate` (legacy — kept for backward compatibility)
- `POST /api/invites/create`
- `POST /api/onboarding/join-company`
- `POST /api/clients/create`
- `POST /api/upgrades/request`
- `POST /api/contact/request`

## Document Generation (Pub/Sub)

The website uses the same Pub/Sub document generation flow as the phone app:

1. **Preview**: `publishPreviewTask` callable Cloud Function (us-central1) → Pub/Sub `document-preview` → Cloud Run PDF worker → `documentTasks/{taskId}` updated with `previewURL`
2. **Generate**: `publishGenerateTask` callable Cloud Function (us-central1) → Pub/Sub `document-generate` → Cloud Run PDF worker → `documentTasks/{taskId}` updated with `downloadURL`
3. **Tax Invoice (305)**: `getInvoiceApproval` callable Cloud Function (me-west1) → Tax Authority API → approval → PDF task via Pub/Sub

The `useDocumentTask` hook (`hooks/use-document-task.ts`) manages the full lifecycle with `onSnapshot` listeners on `documentTasks/{taskId}`.

Firebase Functions SDK is initialized with two regions in `lib/firebase/client.ts`:
- `functions` — us-central1 (default)
- `middleEastFunctions` — me-west1 (Tax Authority)

All endpoints return:

- Success: `{ ok: true, data }`
- Failure: `{ ok: false, error: { code, message, details? } }`

## Auth + Security Notes

- Production API calls require `Authorization: Bearer <Firebase ID token>`.
- `uid` request-body fallback is accepted only in local development when emulator mode is enabled.
- Server routes validate request JSON with Zod before processing.
- Firestore security rules are least-privilege and role-scoped (`Manager`, `Worker`, `User`, `Basic`, `Dev`, plus admin custom claim).

## Data Model

All paths are shared with the phone app — both apps connect to the same Firestore database.

```
users/{uid}/data/profile                              → user profile
users/{uid}/data/cache                                → user cache versioning
users/{uid}/data/inventory                            → { parts: [...], nextId, lastUpdated } (single doc)

companies/{companyId}/business_data/subscription      → { tier, status, enabledModules }
companies/{companyId}/business_data/business_info     → { he_name, en_name, vat_number, city, ... }
companies/{companyId}/business_data/inventory         → { parts: [...], nextId, lastUpdated } (single doc)
companies/{companyId}/business_data/cache             → company cache versioning
companies/{companyId}/workers/{uid}                   → worker membership + role
companies/{companyId}/clients/{clientId}              → client records
companies/{companyId}/counters/clients                → auto-increment counter
companies/{companyId}/PendingJobs/{p_XXXXX}           → active jobs (p_ prefix IDs)
companies/{companyId}/finishedJobs/{f_XXXXX}          → completed/denied jobs (f_ prefix IDs)
companies/{companyId}/certifications/{c_XXXXX}        → generated documents (c_ prefix IDs)
companies/{companyId}/invites/{inviteId}              → onboarding invite codes

upgrade_requests/{id}                                 → upgrade request tickets
documentTasks/{taskId}                                → Pub/Sub task tracking (preview/generate)
```

**Solo users**: `companyId = uid` — all data under `companies/{uid}/*`.

### Job Status Flow

`pending` → `waiting` → `finished` (or `denied`)

## Environment Variables

Copy `.env.local.example` to `.env.local` and set:

- Public Firebase Web SDK:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
- Admin SDK:
  - Either `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
  - Or `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`
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
```

## Demo Seed

```bash
npm run seed:demo
```

Optional seed vars:

- `SEED_COMPANY_ID`
- `SEED_MANAGER_UID`
- `SEED_WORKER_UID`

## Path Migration (Legacy)

If your project still has old user paths from before the alignment, run migration scripts. These are one-time operations.

```bash
npm run migrate:user-paths
```

Copies legacy data:
- `users/{uid}/profile/data` → `users/{uid}/data/profile`
- `users/{uid}/subscription/data` → `companies/{companyId}/business_data/subscription`
- legacy top-level `{uid}/{profile|cache|inventory}` → `users/{uid}/data/{profile|cache|inventory}`

```bash
npm run migrate:company-schema -- --dry-run
npm run migrate:company-schema
```

Optional cleanup pass (after verification):

```bash
npm run migrate:company-schema -- --cleanup-legacy
```

## Deployment (Vercel)

1. Set project root to `website/`.
2. Add all required env vars from `.env.local.example`.
3. Provide Firebase Admin credentials (JSON or split vars).
4. Keep emulator vars disabled in production.
5. Deploy and verify API routes with real bearer tokens.
