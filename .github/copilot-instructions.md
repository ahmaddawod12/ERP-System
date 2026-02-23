# GitHub Copilot Instructions — Smart-Job ERP Monorepo

## Project Overview

Smart-Job ERP is a **cross-platform business management system** with two frontends:
- **phone_app/** — React Native (Expo) mobile app for iOS & Android
- **website/** — Next.js App Router web dashboard

Both apps share the **same Firebase project and Firestore database**. All data paths, structures, and Cloud Functions are identical between the two.

## Critical Rules

### 1. Identity — Always Use `uid`

- **`uid`**: Firebase Auth UID — used for ALL Firestore paths and field references
- **`companyId`**: Company identifier — used for ALL company-scoped paths
- **NEVER** use email-derived usernames, `getUsernameFromEmail`, or `username` fields
- **Solo users**: `companyId = uid` — use `companies/{uid}/*` for all their data

### 2. Inventory Is a Single Document

Inventory is stored as a **single Firestore document** with a `parts` array — NOT a subcollection.

```
companies/{companyId}/business_data/inventory → { parts: [...], nextId, lastUpdated }
users/{uid}/data/inventory                    → { parts: [...], nextId, lastUpdated }
```

Each part object: `{ id: number, name: string, active?: boolean, quantity?: number, lowThreshold?: number, dateAdded: string }`

All inventory mutations go through `updateInventoryV1` Cloud Function (addPart, removePart, togglePart, updatePart, pickParts, replaceParts). NEVER write directly to inventory documents from the client.

### 3. Job ID Format & Status Flow

Job IDs use a **sequential `jid` counter** stored atomically on the company document (`companies/{companyId}.jid`). IDs are always generated **server-side** via the `createJobV1` Cloud Function.

| Prefix | Collection | Meaning |
|--------|------------|---------|
| `p_{jid}` | `PendingJobs` | Active/pending job |
| `f_{jid}` | `finishedJobs` | Completed/denied job |
| `c_XXXXX` | `certifications` | Generated document |

**Status values**: `pending` → `waiting` → `finished` (or `denied`)

NEVER use `in_progress`, `completed`, or `received` — those are legacy values.
NEVER generate job IDs client-side — always use `createJobV1`.
Job updates go through `updateJobV1` — NEVER use direct `updateDoc` on job documents.

### 4. Business Info Fields

Use the canonical field names from the phone app:

| Correct | Wrong (legacy) |
|---------|----------------|
| `he_name` | `name` |
| `en_name` | — |
| `vat_number` | `number` |
| `business_phone` | `phone` |
| `business_email` | — |
| `city` | — |
| `business_type` | — |
| `document_numbers` | — |

### 5. Subscription Model

```typescript
{
  tier: "Basic" | "User" | "Team" | "Dev",
  status: "active" | "trial" | "expired",
  enabledModules: {
    team: boolean,
    solojob: boolean,
    documents: boolean,
    teaminventory: boolean,
    companyinventory: boolean,
    inventory: boolean
  }
}
```

### 6. Worker Fields

Worker documents at `companies/{companyId}/workers/{uid}` must include both `workerId` and `uid` fields (both set to the worker's Firebase UID). Worker lookup uses `workerUid` (UID), never email-based lookups.

### 7. All Mutations Through Cloud Functions

**ALL writes to protected documents go through Cloud Functions.** The client SDK is read-only for most paths. Never use `setDoc`, `updateDoc`, or `deleteDoc` directly from the client for:
- Profile, cache, inventory, subscription, business_info, counters, workers, invites, certifications, documentTasks
- PendingJobs (use `createJobV1` / `updateJobV1` / `deleteJobV1` / `acceptJobV1`)
- Clients (use `addClientV1` / `updateClientV1` / `deleteClientV1`)

Client-side update is allowed only for:
- `finishedJobs/*` — manager/user can update
- `clients/*` — manager/user/basic can update

## Canonical Firestore Schema

```
users/{uid}/
  data/profile                → user profile document (READ-ONLY from client)
  data/cache                  → cache version tracking (READ-ONLY from client)
  data/inventory              → { parts: [...], nextId, lastUpdated } (READ-ONLY from client)

companies/{companyId}/
  business_data/business_info → rich business profile (READ-ONLY from client)
  business_data/subscription  → { tier, status, enabledModules } (READ-ONLY from client)
  business_data/inventory     → { parts: [...], nextId, lastUpdated } (READ-ONLY from client)
  business_data/cache         → company cache version tracking (READ-ONLY from client)
  workers/{uid}               → worker membership + role (READ-ONLY from client)
  clients/{clientId}          → client records (read + update from client)
  counters/clients            → { lastNumber } auto-increment (CF only)
  PendingJobs/{p_XXXXX}       → active jobs (READ-ONLY from client)
  finishedJobs/{f_XXXXX}      → completed/denied jobs (read + update from client)
  certifications/{c_XXXXX}    → generated documents (READ-ONLY from client)
  invites/{inviteId}          → onboarding invite codes (READ-ONLY from client)

upgrade_requests/{id}         → upgrade tickets
contact_requests/{id}         → contact form submissions
documentTasks/{taskId}        → Pub/Sub task tracking (preview/generate)
```

## Cloud Functions (functions/index.js)

All exported from a single file. Firebase Functions v7, Node 22. App Check enforced globally (except `contactRequestV1`). Token revocation checked server-side.

| Function | Type | Description |
|----------|------|-------------|
| `addClientV1` | onCall | Idempotent client creation with auto-increment ID |
| `deleteClientV1` | onCall | Delete a client record |
| `updateClientV1` | onCall | Update client fields + bump cache |
| `generateDocumentV1` | onRequest | **Deprecated** — legacy document generation (use Pub/Sub) |
| `publishPreviewTask` | onCall (us-central1) | Pub/Sub preview PDF task |
| `publishGenerateTask` | onCall (us-central1) | Pub/Sub generate PDF task |
| `getInvoiceApproval` | onCall (me-west1) | Tax Authority invoice approval + PDF task |
| `createInviteV1` | onRequest | Invite code generation (rate-limited) |
| `joinCompanyV1` | onRequest | Worker onboarding via invite (rate-limited) |
| `onJobAssignTrigger` | Firestore trigger | Push notification on job assignment |
| `onJobSubmitTrigger` | Firestore trigger | Push notification on job submission |
| `onTaskCompleted` | Firestore trigger | Cleanup on document task completion |
| `contactRequestV1` | onRequest | Public contact form (rate-limited, no App Check) |
| `requestUpgradeV1` | onRequest | Submit subscription upgrade request |
| `startTaxAuthorityAuth` | onCall | Start Israeli Tax Authority OAuth flow |
| `taxAuthorityCallback` | onRequest | Tax Authority OAuth callback |
| `updateProfileV1` | onCall | Update name/phoneNumber on profile |
| `updatePushTokenV1` | onCall | Update FCM push token on profile |
| `clearPushTokenV1` | onCall | Clear push token on logout |
| `updateBusinessInfoV1` | onCall | Update business_info (except vat_number/document_numbers) |
| `manageWorker` | onCall | Add/edit/remove workers (role whitelist: worker/user/basic only) |
| `deleteJobV1` | onCall | Delete pending or finished job (role-checked) |
| `acceptJobV1` | onCall | Atomic: pending→finished + delete + deduct worker inventory |
| `registerBusinessV1` | onCall | Atomic onboarding: profile + company + subscription + counters + inventory (transactional) |
| `createJobV1` | onCall | Create job with sequential jid (atomic counter) |
| `updateJobV1` | onCall | Update job fields (status/assignment/details) |
| `updateInventoryV1` | onCall | Transactional inventory mutations (add/remove/toggle/update/pick/replace) |
| `updateCacheV1` | onCall | Bump cache version for a given key |

## Security Model

Firestore security rules enforce **read-only client access** for most documents. All mutations go through Cloud Functions (Admin SDK bypasses rules). App Check is enforced on all callable/HTTP functions except `contactRequestV1`.

### Read-Only from Client (create/update/delete: false)
- `users/{uid}/data/profile` — use `registerBusinessV1`, `updateProfileV1`, `updatePushTokenV1`, `clearPushTokenV1`
- `users/{uid}/data/cache` — use `updateCacheV1`
- `users/{uid}/data/inventory` — use `updateInventoryV1`
- `companies/{companyId}/business_data/business_info` — use `registerBusinessV1`, `updateBusinessInfoV1`
- `companies/{companyId}/business_data/subscription` — use `registerBusinessV1`
- `companies/{companyId}/business_data/inventory` — use `updateInventoryV1`
- `companies/{companyId}/business_data/cache` — use `updateCacheV1`
- `companies/{companyId}/business_data/token` — Cloud Functions only
- `companies/{companyId}/counters/*` — Cloud Functions only
- `companies/{companyId}/workers/*` — use `manageWorker`
- `companies/{companyId}/invites/*` — use `createInviteV1`
- `companies/{companyId}/certifications/*` — Cloud Functions only
- `companies/{companyId}/PendingJobs/*` — use `createJobV1`, `updateJobV1`, `deleteJobV1`, `acceptJobV1`
- `documentTasks/{taskId}` — Cloud Functions only

### Client-Writable (within role-based rules)
- `companies/{companyId}/finishedJobs/*` — manager/user can update (create/delete via CF)
- `companies/{companyId}/clients/*` — manager/user/basic can update (create/delete via CF)

### Legacy Paths (denied)
- `users/{uid}/jobs`, `users/{uid}/personal_inventory`, `users/{uid}/clients` — all access denied

## Platform-Specific Notes

### Phone App (`phone_app/`)
- Uses `@react-native-firebase/*` native SDKs with **modular API** (`doc(db, ...)`, NOT `db.collection(...)`)
- MMKV for local caching with version-based invalidation, **keys scoped by `uid:companyId:` prefix**
- `withGate` HOC for subscription-based feature gating
- Screens in `modules/`, thin wrappers in `app/`
- NEVER use `Alert.alert()` — use custom `useAlert()` hook
- NEVER use direct `updateDoc`/`setDoc` for protected paths — use Cloud Functions via `httpsCallable`
- Token refresh auto-saves via `updatePushTokenV1`; logout calls `clearPushTokenV1`

### Website (`website/`)
- Firebase Web SDK (client) + Firebase Admin SDK (server API routes)
- API routes proxy to Cloud Functions with **server-side auth verification** before forwarding
- **Document generation uses Pub/Sub** via `useDocumentTask` hook → `publishPreviewTask` / `publishGenerateTask` callable Cloud Functions → listens on `documentTasks/{taskId}` for completion (same as phone app)
- Tax Invoices (type 305) use `getInvoiceApproval` on `me-west1` region (same as phone app)
- Firebase Functions SDK initialized with two regions: `functions` (us-central1) and `middleEastFunctions` (me-west1) in `lib/firebase/client.ts`
- TypeScript with strict types in `lib/types.ts`
- Tailwind CSS for styling, React Hook Form + Zod for forms (all forms should use RHF + Zod)
- `resolveCompanyScope(companyId, uid)` helper returns `companyId ?? uid` for unified solo/team paths
- All inventory and job mutations route through Cloud Functions via `firestore-service.ts`
- Client creation uses `addClientV1` Cloud Function via `/api/clients/create` proxy (same as phone app)

## Roles

| Role | Access Level |
|------|-------------|
| Manager | Full company control |
| Worker | Assigned jobs + inventory picks |
| User | Solo: own jobs, inventory, clients, docs |
| Basic | Clients + documents only |
| Dev | Full internal access |

**Role assignment is restricted**: `manageWorker` only allows assigning `worker`, `user`, or `basic` roles — never `manager` or `dev`.
