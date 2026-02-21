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
  workers/{uid}               → { workerId, uid, role, email, name, phoneNumber, createdAt }
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
| **Solo users** | `companyId = uid` — all data stored under `companies/{uid}/*` |
| **Inventory** | Single document with `parts` array + `nextId` counter (NOT a subcollection) |
| **Job IDs** | Sequential `jid` counter on company doc. `p_{jid}` (pending), `f_{jid}` (finished), `c_XXXXX` (certification). Always server-generated via `createJobV1`. |
| **Job statuses** | `pending` → `waiting` → `finished` (or `denied`) |
| **Identity** | Firebase Auth UID everywhere — no email-derived usernames |
| **Business info** | Uses `he_name`, `en_name`, `vat_number` (NOT `name`, `number`) |

## Roles & Access

| Role | Scope | Access |
|------|-------|--------|
| **Manager** | Team | Full control: workers, jobs, company inventory, clients, documents |
| **Worker** | Team | Assigned jobs, inventory picks from company stock |
| **User** | Solo | Own jobs, personal inventory, clients, documents |
| **Basic** | Solo | Clients + documents only (upgrade for jobs/inventory) |
| **Dev** | Internal | Full access for development/support |

## Cloud Functions

All functions are in `functions/index.js` (Firebase Functions v7, Node 22).

| Function | Type | Region | Purpose |
|----------|------|--------|---------|
| `createClientV1` | onRequest | us-central1 | Idempotent client creation with auto-increment ID |
| `generateDocumentV1` | onRequest | us-central1 | **Deprecated** — legacy document generation (use Pub/Sub tasks) |
| `publishPreviewTask` | onCall | us-central1 | Pub/Sub preview PDF task |
| `publishGenerateTask` | onCall | us-central1 | Pub/Sub generate PDF task |
| `getInvoiceApproval` | onCall | me-west1 | Tax Authority invoice approval + PDF task |
| `createInvite` | onCall | us-central1 | Generate invite code for worker onboarding |
| `joinCompanyWithInvite` | onCall | us-central1 | Worker joins company using invite code |
| `onFinishedJobCreated` | Firestore trigger | us-central1 | Cleanup pending job on finish |
| `onJobAssignTrigger` | Firestore trigger | us-central1 | Push notification on job assignment |
| `sendNotification` | onCall | us-central1 | Push notifications via FCM |
| `submitUpgradeRequest` | onCall | us-central1 | Submit subscription upgrade request |
| `contactRequestV1` | onRequest | us-central1 | Public contact form (rate-limited) |
| `requestPermit` | onRequest | me-west1 | Israeli Tax Authority integration |
| `fetchPermit` | onRequest | me-west1 | Israeli Tax Authority permit fetch |
| `reportDocument` | onRequest | me-west1 | Report document to tax authority |
| `updateProfileV1` | onCall | us-central1 | Update name/phoneNumber on profile |
| `updatePushTokenV1` | onCall | us-central1 | Update FCM push token on profile |
| `updateBusinessInfoV1` | onCall | us-central1 | Update business_info (except vat_number/document_numbers) |
| `manageWorker` | onCall | us-central1 | Add/edit/remove workers (supports role changes) |
| `deleteJobV1` | onCall | us-central1 | Delete pending or finished job (role-checked) |
| `acceptJobV1` | onCall | us-central1 | Atomic: pending→finished + delete + deduct worker inventory |
| `registerBusinessV1` | onCall | us-central1 | Atomic onboarding: profile + company + subscription + counters + inventory |
| `createJobV1` | onCall | us-central1 | Create job with sequential jid (atomic counter) |

## Security Model

Firestore security rules enforce **read-only client access** for sensitive documents. All mutations go through Cloud Functions (Admin SDK bypasses rules).

| Document | Client Access | Mutation Method |
|----------|--------------|----------------|
| `users/{uid}/data/profile` | Read only | `registerBusinessV1`, `updateProfileV1`, `updatePushTokenV1` |
| `business_data/business_info` | Read only | `registerBusinessV1`, `updateBusinessInfoV1` |
| `business_data/subscription` | Read only | `registerBusinessV1` |
| `business_data/token` | No access | Cloud Functions only |
| `counters/*` | Read only | Cloud Functions only |
| `PendingJobs/*` | Manager: create/read/update. Worker: read/update own. | Delete via `deleteJobV1`/`acceptJobV1` |
| `finishedJobs/*` | Manager/User: create/read/update. | Delete via `deleteJobV1` |
| `certifications/*` | Read + manager delete | Create/update via Cloud Functions |
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
