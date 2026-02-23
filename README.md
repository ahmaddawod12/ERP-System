# Smart-Job ERP — Monorepo

A cross-platform **ERP (Enterprise Resource Planning)** system for solo business owners and teams. Built for HVAC, field services, and similar industries.

Both the mobile app and website share **the same Firebase project, Firestore database, and Cloud Functions**.

## Repository Structure

```
ERP-System/
├── phone_app/            # React Native (Expo) — iOS & Android
├── website/              # Next.js App Router — Web dashboard
├── functions/            # Firebase Cloud Functions (Node 22)
├── cloudrun-pdf/         # Cloud Run service — PDF generation + email
├── cloudrun-archiver/    # Cloud Run Job — monthly Firestore → Storage archival
├── firebase.json         # Firebase project config (hosting, functions, rules)
├── firestore.rules       # Firestore security rules
├── firestore.indexes.json
└── storage.rules         # Storage security rules
```

## Shared Firestore Schema

Both apps connect to the same database. All paths below are canonical.

```
users/{uid}/
  data/profile                → { uid, role, email, companyId, accountType, name, phoneNumber, ... }
  data/cache                  → user cache version tracking
  data/inventory              → { parts: [...], nextId, lastUpdated }   (single doc)

companies/{companyId}/
  business_data/business_info → { he_name, en_name, vat_number, city, address, business_type, ... }
  business_data/subscription  → { tier, status, enabledModules: { team, solojob, documents, ... } }
  business_data/inventory     → { parts: [...], nextId, lastUpdated }   (single doc)
  business_data/cache         → company cache version tracking
  workers/{workerId}               → { workerId, uid, role, email, name, phoneNumber, createdAt }
  clients/{clientId}          → { numericId, name, email, phone, address, notes, ... }
  PendingJobs/{p_XXXXX}       → active jobs      (p_ prefix IDs)
  finishedJobs/{f_XXXXX}      → completed jobs   (f_ prefix IDs)
  certifications/{c_XXXXX}    → generated docs   (c_ prefix IDs)
  invites/{inviteId}          → onboarding invite codes

upgrade_requests/{id}         → upgrade request tickets
contact_requests/{id}         → public contact form submissions
```

### Key Data Model Rules

| Rule | Detail |
|------|--------|
| **Inventory** | Single document with `parts` array + `nextId` counter (NOT a subcollection) |
| **Job IDs** | Sequential `jid` counter on company doc. `p_{jid}` (pending), `f_{jid}` (finished), `c_XXXXX` (certification). Always server-generated via `createJobV1`. |
| **Job statuses** | `pending` → `waiting` → `finished` (or `denied`) |
| **Identity** | Firebase Auth UID everywhere — no email-derived usernames |
| **Business info** | Uses `he_name`, `en_name`, `vat_number` (NOT `name`, `number`) |

## Roles & Access

| Role | Scope | Access |
|------|-------|--------|
| **manager** | Team | Full control: workers, jobs, company inventory, clients, documents |
| **worker** | Team | Assigned jobs, inventory picks from company stock |
| **user** | Solo | Own jobs, personal inventory, clients, documents |
| **basic** | Solo | Clients + documents only (upgrade for jobs/inventory) |
| **dev** | Internal | Full access for development/support |

## Cloud Functions

All functions are in `functions/index.js` (Firebase Functions v7, Node 22). App Check is enforced globally (except `contactRequestV1`).

| Function | Type | Region | Purpose |
|----------|------|--------|---------|
| `addClientV1` | onCall | us-central1 | Idempotent client creation with auto-increment ID |
| `deleteClientV1` | onCall | us-central1 | Delete a client record |
| `updateClientV1` | onCall | us-central1 | Update client fields + bump cache |
| `generateDocumentV1` | onRequest | us-central1 | **Deprecated** — legacy document generation (use Pub/Sub tasks) |
| `publishPreviewTask` | onCall | us-central1 | Pub/Sub preview PDF task |
| `publishGenerateTask` | onCall | us-central1 | Pub/Sub generate PDF task |
| `getInvoiceApproval` | onCall | me-west1 | Tax Authority invoice approval + PDF task |
| `createInviteV1` | onRequest | us-central1 | Generate invite code for worker onboarding |
| `joinCompanyV1` | onRequest | us-central1 | Worker joins company using invite code |
| `onJobAssignTrigger` | Firestore trigger | us-central1 | Push notification on job assignment |
| `onJobSubmitTrigger` | Firestore trigger | us-central1 | Push notification on job submission |
| `onTaskCompleted` | Firestore trigger | us-central1 | Cleanup on document task completion |
| `contactRequestV1` | onRequest | us-central1 | Public contact form (rate-limited, no App Check) |
| `requestUpgradeV1` | onRequest | us-central1 | Submit subscription upgrade request |
| `startTaxAuthorityAuth` | onCall | us-central1 | Start Israeli Tax Authority OAuth flow |
| `taxAuthorityCallback` | onRequest | us-central1 | Tax Authority OAuth callback |
| `updateProfileV1` | onCall | us-central1 | Update name/phoneNumber on profile |
| `updatePushTokenV1` | onCall | us-central1 | Update FCM push token on profile |
| `clearPushTokenV1` | onCall | us-central1 | Clear push token on logout |
| `updateBusinessInfoV1` | onCall | us-central1 | Update business_info (except vat_number/document_numbers) |
| `manageWorker` | onCall | us-central1 | Add/edit/remove workers (role whitelist: worker/user/basic) |
| `deleteJobV1` | onCall | us-central1 | Delete pending or finished job (role-checked) |
| `acceptJobV1` | onCall | us-central1 | Atomic: pending→finished + delete + deduct worker inventory |
| `registerBusinessV1` | onCall | us-central1 | Atomic onboarding: profile + company + subscription + counters + inventory |
| `createJobV1` | onCall | us-central1 | Create job with sequential jid (atomic counter) |
| `updateJobV1` | onCall | us-central1 | Update job fields (status/assignment/details) |
| `updateInventoryV1` | onCall | us-central1 | Transactional inventory mutations (add/remove/toggle/update/pick) |
| `updateCacheV1` | onCall | us-central1 | Bump cache version for a given key |

## Security Model

Firestore security rules enforce **read-only client access** for sensitive documents. All mutations go through Cloud Functions (Admin SDK bypasses rules). App Check is enforced on all callable/HTTP functions except `contactRequestV1`. Token revocation is checked server-side.

| Document | Client Access | Mutation Method |
|----------|--------------|----------------|
| `users/{uid}/data/profile` | Read only | `registerBusinessV1`, `updateProfileV1`, `updatePushTokenV1`, `clearPushTokenV1` |
| `users/{uid}/data/cache` | Read only | `updateCacheV1` |
| `users/{uid}/data/inventory` | Read only | `updateInventoryV1` |
| `business_data/business_info` | Read only | `registerBusinessV1`, `updateBusinessInfoV1` |
| `business_data/subscription` | Read only | `registerBusinessV1` |
| `business_data/inventory` | Read only | `updateInventoryV1` |
| `business_data/cache` | Read only | `updateCacheV1` |
| `business_data/token` | No access | Cloud Functions only |
| `counters/*` | No access | Cloud Functions only |
| `workers/*` | Read only | `manageWorker` |
| `invites/*` | Read only | `createInviteV1` |
| `PendingJobs/*` | Read only (role-scoped) | Create: `createJobV1`. Update: `updateJobV1`. Delete: `deleteJobV1`/`acceptJobV1` |
| `finishedJobs/*` | Read + update (manager/user) | Create/delete via Cloud Functions |
| `clients/*` | Read + update (manager/user/basic) | Create: `addClientV1`. Delete: `deleteClientV1` |
| `certifications/*` | Read only | Create/update/delete via Cloud Functions |
| `documentTasks/*` | Read own | Cloud Functions only |

## Tech Stack Comparison

| Layer | Phone App | Website |
|-------|-----------|---------|
| Framework | React Native + Expo SDK ~54 | Next.js App Router + TypeScript |
| Styling | StyleSheet + theme.js | Tailwind CSS |
| Firebase SDK | `@react-native-firebase/*` (native) | Firebase Web SDK + Admin SDK |
| State | React Context + MMKV cache | React Context + Firestore reads |
| API calls | `httpsCallable` (direct) | API routes → Cloud Functions (proxy pattern) |
| Forms | Manual state | React Hook Form + Zod |
| i18n | Custom LanguageContext | Custom locale hook (EN/HE/AR) |
| Auth | Native Firebase Auth | Firebase Web Auth + server-side token verification |

## Getting Started

### Phone App

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

### Demo Seed (Website)

```bash
cd website
npm run seed:demo
```

## Environment Variables

### Website (`.env.local`)

```env
# Firebase Web SDK (public)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin SDK (server-side)
FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=   # OR use individual vars:
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

# Optional
CLOUDRUN_PDF_URL=                      # Cloud Run PDF service URL
```

### Phone App

Uses `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) for Firebase config.

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Phone App | EAS Build → App Store / Play Store | `eas build --platform ios/android` |
| Website | Vercel | Set root to `website/`, add env vars |
| Functions | Firebase CLI | `firebase deploy --only functions` |
| Cloud Run PDF | Google Cloud Run | Docker image from `cloudrun-pdf/` |
| Cloud Run Archiver | Google Cloud Run Jobs | Scheduled monthly via Cloud Scheduler |
