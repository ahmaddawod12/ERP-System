# Smart-Job ERP Monorepo

Smart-Job ERP is a cross-platform ERP system for field-service businesses (HVAC and similar teams). This repository contains mobile, web, and backend services that share the same Firebase project and Firestore schema.

## 2026 Design and Flow Updates

- Mobile UI is standardized around the design system in `phone_app/theme.js` and shared primitives in `phone_app/components/`.
- Business registration is now website-only (`website/src/app/register` and `website/src/app/onboarding`).
- Mobile no longer contains `app/BusinessReg.js`. Do not reintroduce that route.

## Repository Structure

```text
ERP-System/
|-- phone_app/           # Expo + React Native mobile app
|-- website/             # Next.js web app
|-- functions/           # Firebase Cloud Functions
|   |-- index.js         # Thin re-exporter (no logic)
|   `-- src/             # Domain modules
|       |-- shared.js    # Admin init, constants, helpers, auth
|       |-- auth.js      # manageWorker, registerBusinessV1
|       |-- jobs.js      # createJobV1, updateJobV1, deleteJobV1, triggers
|       |-- clients.js   # addClientV1, deleteClientV1, updateClientV1
|       |-- documents.js # generateDocumentV1, publishing, onTaskCompleted
|       |-- tax.js       # Tax Authority OAuth + invoice approval (me-west1)
|       |-- invites.js   # createInviteV1, joinCompanyV1
|       |-- inventory.js # updateInventoryV1
|       |-- profile.js   # updateProfileV1, push tokens, business info, cache
|       `-- misc.js      # requestUpgradeV1, contactRequestV1
|-- cloudrun-pdf/        # Cloud Run PDF service
|-- cloudrun-archiver/   # Cloud Run archival job
|-- firebase.json
|-- firestore.rules
|-- firestore.indexes.json
`-- storage.rules
```

## Version Snapshot (2026-02-27)

### Phone app (`phone_app/package.json`)
- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- React Native Firebase `^23.8.6`

### Website (`website/package.json`)
- Next.js `16.1.6`
- React / React DOM `19.2.3`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`

### Functions (`functions/package.json`)
- Node engine `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`

## Shared Data Model Rules

- Identity:
  - Always use Firebase Auth `uid` for user identity.
  - Always use `companyId` for company-scoped paths.
  - `companyId` is assigned by backend registration from `system/data/comid` and is never derived from `uid`.
- Inventory:
  - Inventory is a single document with a `parts` array and `nextId` counter.
  - Do not model inventory as a Firestore subcollection.
- Jobs:
  - All jobs live in a single `jobs` collection; status determines lifecycle phase.
  - Job IDs are server-generated plain Base62 from a sequential `jid` counter.
  - Document IDs are plain Base62 (no prefix).
  - Valid statuses: `pending`, `waiting`, `finished`, `denied`.
- Mutations:
  - All writes to `clients`, `jobs`, `documents`, `invites`, and `workers` are locked in Firestore rules (`allow create, update, delete: if false`). Only Cloud Functions (Admin SDK) can mutate these collections.
  - Protected writes must go through the corresponding Cloud Function (`createJobV1`, `updateJobV1`, `updateClientV1`, `updateInventoryV1`, etc.).
  - Server-side validation enforces `MAX_ITEMS_PER_DOCUMENT = 100` (tax invoices) and `MAX_JOB_ARRAY_LENGTH = 200` (job array fields).

## Registration and Onboarding Flow

- Website registration creates Firebase Auth credentials (`/register`).
- Website onboarding completes profile/business setup:
  - Manager or solo: callable `registerBusinessV1`
  - Worker join: HTTP `joinCompanyV1` via `/api/onboarding/join-company`
- `registerBusinessV1` allocates `companyId` from `system/data/comid` in a transaction and increments `comid` by 1.

## Website Architecture

- **Dashboard pages** (`/app/*`) use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps a `<Suspense>` boundary around the client component.
  - `page-client.tsx` — `"use client"` shell containing hooks and interactivity.
- **Static marketing pages** (`/`, `/features`, `/pricing`, `/security`, `/contact`, `/terms`, `/privacy`, `/solutions/*`) export `revalidate = 3600` for 1-hour ISR caching.
- **`middleware.ts`** handles auth redirect for all `/app/*` routes.
- **`loading.tsx`** provides instant loading UI during dashboard route transitions.

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
  workers/{workerId}
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
firebase deploy --only functions
```

## Deployment

- Mobile: EAS Build (`eas build --platform ios` / `android`)
- Website: Vercel (root `website/`)
- Functions: Firebase CLI
- Cloud Run services: `cloudrun-pdf/`, `cloudrun-archiver/`

## Documentation Pointers

- Architectural audit (2026-02-28): `AUDIT_2026-02-28.md`
- Mobile design and architecture: `phone_app/README.md`
- Monorepo coding rules for Copilot: `.github/copilot-instructions.md`
- Mobile-specific Copilot rules: `phone_app/.github/copilot-instructions.md`
- Website-specific Copilot rules: `website/.github/copilot-instructions.md`
