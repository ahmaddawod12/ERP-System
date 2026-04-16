# Smart-Job ERP Monorepo

Smart-Job ERP is a cross-platform ERP system for field-service businesses (HVAC and similar teams). This repository contains mobile, web, and backend services that share the same Firebase project and Firestore schema.

## 2026 Design and Flow Updates

- Mobile UI is standardized around the design system in `phone_app/theme.js` and shared primitives in `phone_app/components/`.
- Business registration is now website-only (`website/src/app/register` and `website/src/app/onboarding`).
- Mobile no longer contains `app/BusinessReg.js`. Do not reintroduce that route.
- Canonical stored account types now live in `@smart-job/contracts` and are only `solo` or `business`.
- Website keeps a UI-only Basic workspace choice, but it resolves to canonical runtime values: `accountType: solo` and `role: basic`.
- Support chat state, upgrade moderation, and company file mutations are backend-controlled flows now, not direct client writes.
- `upgrade_requests` are read-only to Firestore clients after creation; moderation must go through `moderateUpgradeRequestV1`.
- Saved document records store `storagePath`; clients fetch short-lived download URLs from backend functions instead of relying on durable Firestore-stored bearer URLs.
- Job attachment records also store canonical `{ storagePath }` refs; clients must resolve short-lived signed URLs through backend functions instead of persisting durable Storage URLs.
- Solo finished jobs must be created first through `createJobV1`, then files are uploaded under the returned server job ID, then attached with `updateJobV1`. Never upload solo files under temporary job IDs.
- Tax invoice submissions require a caller-generated `idempotencyKey`; the backend records in-progress and approved results under `companies/{companyId}/tax_invoice_idempotency/{hash}`.
- Company Storage reads are backend-controlled: clients must not directly read `companies/{companyId}/documents/*`, `companies/{companyId}/jobs/*`, or `companies/{companyId}/archives/*`.
- Firestore transactions must perform all `tx.get()` calls before any `tx.set/update/delete()` calls. Regression tests pin this for profile sync, inventory picks, and job acceptance.
- Job notification triggers claim their `notificationLog/{jobId}_{type}` idempotency document before sending push notifications.
- Cloud Run PDF generation uses create-only writes for new PDFs/documents, cleans up generated PDFs on Firestore-finalize failure, and reclaims stale `documentTasks` stuck in `processing`.

## Repository Structure

```text
ERP-System/
|-- phone_app/           # Expo + React Native mobile app
|-- website/             # Next.js web app
|-- functions/           # Firebase Cloud Functions
|   |-- index.js         # Thin re-exporter (no logic)
|   `-- src/             # Domain modules
|       |-- shared.js    # Admin init plus thin wrapper exports for shared infra helpers
|       |-- shared-http.js # HTTP/CORS/auth-header helpers used by shared.js
|       |-- shared-access.js # profile/company access helpers used by shared.js
|       |-- auth.js      # manageWorker, registerBusinessV1
|       |-- jobs.js      # createJobV1, updateJobV1, deleteJobV1, triggers
|       |-- job-mutation-resolver.js # canonical worker/client resolution for job mutations
|       |-- clients.js   # addClientV1, deleteClientV1, updateClientV1
|       |-- documents.js # preview/generate publishing, deleteDocumentV1, signed document/archive access, onTaskCompleted
|       |-- tax.js       # Tax Authority OAuth + invoice approval (me-west1)
|       |-- tax-oauth.js # Tax Authority OAuth config and callback helper utilities
|       |-- invites.js   # createInviteV1, joinCompanyV1
|       |-- inventory.js # updateInventoryV1
|       |-- profile.js   # updateProfileV1 (syncs worker + manager docs), push tokens, business info, cache
|       |-- support.js   # support conversation/message mutation boundary
|       `-- misc.js      # requestUpgradeV1, upgrade moderation/list, contactRequestV1
|-- cloudrun-pdf/        # Cloud Run PDF service
|-- cloudrun-archiver/   # Cloud Run archival job
|-- packages/
|   `-- contracts/       # @smart-job/contracts — shared enums, canonical tier/account-type semantics, helpers, Firestore paths
|-- firebase.json
|-- firestore.rules
|-- firestore.indexes.json
`-- storage.rules
```

Structural note:
- `functions/src/shared.js` delegates HTTP/auth-access logic to focused helper modules instead of keeping all infra logic inline.
- `phone_app/modules/support/support-copy.ts` holds support translations and template/category metadata.
- `phone_app/modules/documents/document-config.ts` and `phone_app/modules/documents/document-copy.ts` hold static document config and localized copy.

## Version Snapshot (2026-04-13)

### Phone app (`phone_app/package.json`)
- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- React Native Firebase `^23.8.8`
- `@smart-job/contracts` (local workspace package)

### Website (`website/package.json`)
- Next.js `16.2.3`
- React / React DOM `19.2.3`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`
- Tailwind CSS v4 with `tailwind-merge ^3.5.0`

### Functions (`functions/package.json`)
- Node engine `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`
- Axios `^1.15.0`
- `@smart-job/contracts` (local workspace package)

## Shared Data Model Rules

- Identity:
  - Always use Firebase Auth `uid` for user identity.
  - Always use `companyId` for company-scoped paths.
  - `companyId` is assigned by backend registration from `system/data/comid` and is never derived from `uid`.
  - Canonical stored account types are only `solo` and `business`.
  - Canonical stored tiers are `Basic`, `Solo`, `Team`, `Enterprise` from `packages/contracts`.
- Inventory:
  - Inventory currently remains a single document with a `parts` array and `nextId` counter.
  - Backend mutations enforce a Firestore document-size budget before writing inventory arrays.
  - Long-term scale target: migrate high-cardinality inventories to `inventoryParts/{partId}` subcollections plus aggregate counters.
- Jobs:
  - All jobs live in a single `jobs` collection; status determines lifecycle phase.
  - Job IDs are server-generated sequential string IDs from `companies/{companyId}/counters/jnext`.
  - Non-tax document IDs are canonical backend-generated strings of the form `{DOC_SUFFIX}{documentNumber}-{companyId}`.
  - Valid statuses: `pending`, `waiting`, `finished`, `denied`.
  - Job assignee/client denormalized fields are resolved server-side from canonical worker/client docs.
- Mutations:
  - All writes to `clients`, `jobs`, `documents`, `invites`, and `workers` are locked in Firestore rules (`allow create, update, delete: if false`). Only Cloud Functions (Admin SDK) can mutate these collections.
  - Protected writes must go through the corresponding Cloud Function (`createJobV1`, `updateJobV1`, `updateClientV1`, `updateInventoryV1`, etc.).
- Support conversation metadata and messages are mutated through `functions/src/support.js`.
- Support mutation callables are Firestore-rate-limited per authenticated user to reduce abuse.
- Company document PDFs are backend-generated and stored under company-controlled Storage paths.
- User job attachments may upload only to owner paths (`{uid}/jobs/{jobId}/*`), must persist canonical `storagePath` refs, and must be read cross-user only through backend-issued signed URLs (`createJobFileDownloadUrlV1`).
- Mobile upload flows should clean up newly uploaded owner-path attachments if the follow-up job mutation fails before persistence.
  - Archived jobs/documents must be fetched through `fetchArchiveMonthV1`; archive Storage objects are not a public client API.
  - Server-side validation enforces `MAX_ITEMS_PER_DOCUMENT = 100` (tax invoices) and `MAX_JOB_ARRAY_LENGTH = 200` (job array fields).
- TTL:
  - `documentTasks` documents include an `expireAt` field (30-day TTL) with Firestore TTL policy for automatic cleanup.
  - `rate_limits`, `contact_requests`, Tax OAuth pending/callback records, and tax invoice idempotency records also use `expireAt` TTL fields.
- Transactions:
  - All transaction reads must happen before writes.
  - `updateProfileV1` uses a Firestore transaction for atomic profile + worker/manager membership sync.
  - `tax.js` token refresh uses a Firestore transaction to prevent concurrent refresh race conditions.
  - Tax invoice approval reserves a number up front in `companies/{companyId}/tax_invoice_reservations/{documentId}` and never decrements counters on failure.
  - Tax invoice approval validates linked jobs and price proposals before external submission; `isCert` is server-managed and cannot be changed through `updateJobV1`.
  - Archival deletes use exact document IDs captured in the verified archive, not a second date-range query.

## Registration and Onboarding Flow

- Website registration creates Firebase Auth credentials (`/register`).
- Website onboarding completes profile/business setup:
  - Manager or solo: callable `registerBusinessV1`
  - Worker join: HTTP `joinCompanyV1` via `/api/onboarding/join-company`
  - Basic workspace: website-only choice that resolves to `accountType: solo` and `role: basic`
- `registerBusinessV1` only accepts canonical provisioning tuples:
  - `manager + business`
  - `user + solo`
  - `basic + solo`
- `registerBusinessV1` allocates `companyId` from `system/data/comid` in a transaction and increments `comid` by 1.

## Website Architecture

- **All page routes** use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps a `<Suspense>` boundary around the client component.
  - `page-client.tsx` — `"use client"` shell containing hooks and interactivity.
  - This applies to dashboard pages (`/app/*`) and auth pages (`/login`, `/register`, `/forgot-password`, `/onboarding`).
- **Static marketing pages** (`/`, `/features`, `/pricing`, `/security`, `/contact`, `/terms`, `/privacy`, `/solutions/*`) export `revalidate = 3600` for 1-hour ISR caching.
- **`middleware.ts`** handles auth redirect for all `/app/*` routes and verifies Firebase ID token signatures before allowing access.
- **`loading.tsx`** provides instant loading UI during dashboard route transitions.
- **Auth session cookie** (`__session`) is set only by `/api/auth/session` as `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Client code must not write Firebase ID tokens into `document.cookie`.
- **Login redirect** validates against `//` prefix to prevent open redirects.
- **HTTP / support rate limiting**: invite, join-company, upgrade-request, and contact endpoints use Firestore-backed rate limiting in `functions/src/shared.js`; support mutation callables apply the same shared limiter with per-action thresholds.
- **CSP** includes `base-uri 'self'` and `form-action 'self'` directives.
- Server-proxied HTTP onboarding, invite, and upgrade flows rely on verified bearer tokens and intentionally opt out of App Check enforcement at the HTTP Function layer.

## Canonical Firestore Paths

```text
users/{uid}/
  data/profile
  data/cache
  data/inventory

companies/{companyId}/
  data/business_info
  data/subscription
  data/cache
  data/inventory
  workers/{wid}
  managers/{mid}
  clients/{clientId}
  jobs/{jobId}
  documents/{docId}
  invites/{inviteId}
```

## Getting Started

### Phone app
```bash
cd phone_app
npm install
npx expo start
```

### Website
```bash
cd website
npm install
npm run dev
```

### Cloud Functions
```bash
cd functions
npm install
npm test
firebase deploy --only functions
```

### Verification
```bash
node scripts/check-no-ts-nocheck.mjs
cd website && npm test && npm run typecheck && npm run lint && npm run build
cd ../phone_app && npm test && npm run typecheck
cd ../functions && npm test
cd ../cloudrun-pdf && npm test
cd ../cloudrun-archiver && npm test
```

## Deployment

- Mobile: EAS Build (`eas build --platform ios` / `android`)
- Website: Vercel (root `website/`)
- Functions: Firebase CLI
- Cloud Run services: `cloudrun-pdf/`, `cloudrun-archiver/`

## Documentation Pointers

- Full empty-project setup and deployment guide: `SETUP.md`
- Architectural audit (2026-02-28): `AUDIT_2026-02-28.md`
- Mobile design and architecture: `phone_app/README.md`
- Monorepo coding rules for Copilot: `.github/copilot-instructions.md`
- Mobile-specific Copilot rules: `phone_app/.github/copilot-instructions.md`
- Website-specific Copilot rules: `website/.github/copilot-instructions.md`
