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

Always use **Firestore transactions** when modifying parts arrays to prevent concurrent write conflicts.

### 3. Job ID Format & Status Flow

| Prefix | Collection | Meaning |
|--------|------------|---------|
| `p_XXXXX` | `PendingJobs` | Active/pending job |
| `f_XXXXX` | `finishedJobs` | Completed/denied job |
| `c_XXXXX` | `certifications` | Generated document |

**Status values**: `pending` → `waiting` → `finished` (or `denied`)

NEVER use `in_progress` or `completed` — those are legacy values.

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

Worker documents at `companies/{companyId}/workers/{uid}` must include both `workerId` and `uid` fields (both set to the worker's Firebase UID).

## Canonical Firestore Schema

```
users/{uid}/
  data/profile                → user profile document
  data/cache                  → cache version tracking
  data/inventory              → { parts: [...], nextId, lastUpdated }

companies/{companyId}/
  business_data/business_info → rich business profile
  business_data/subscription  → { tier, status, enabledModules }
  business_data/inventory     → { parts: [...], nextId, lastUpdated }
  business_data/cache         → company cache version tracking
  workers/{uid}               → worker membership + role
  clients/{clientId}          → client records
  counters/clients            → { lastNumber } auto-increment
  PendingJobs/{p_XXXXX}       → active jobs
  finishedJobs/{f_XXXXX}      → completed/denied jobs
  certifications/{c_XXXXX}    → generated documents
  invites/{inviteId}          → onboarding invite codes

upgrade_requests/{id}         → upgrade tickets
contact_requests/{id}         → contact form submissions
```

## Cloud Functions (functions/index.js)

All exported from a single file. Firebase Functions v7, Node 22.

| Function | Type | Description |
|----------|------|-------------|
| `createClientV1` | onRequest | Idempotent client creation |
| `generateDocumentV1` | onRequest | Document generation queue |
| `createInvite` | onCall | Invite code generation |
| `joinCompanyWithInvite` | onCall | Worker onboarding |
| `onFinishedJobCreated` | Firestore trigger | Cleanup pending job |
| `sendNotification` | onCall | FCM push notifications |
| `submitUpgradeRequest` | onCall | Subscription upgrade request |
| `submitContactRequest` | onCall | Public contact form |
| `requestPermit` | onRequest (me-west1) | Tax authority integration |
| `fetchPermit` | onRequest (me-west1) | Tax authority permit |
| `reportDocument` | onRequest (me-west1) | Tax authority reporting |

## Platform-Specific Notes

### Phone App (`phone_app/`)
- Uses `@react-native-firebase/*` native SDKs with **modular API** (`doc(db, ...)`, NOT `db.collection(...)`)
- MMKV for local caching with version-based invalidation
- `withGate` HOC for subscription-based feature gating
- Screens in `modules/`, thin wrappers in `app/`
- NEVER use `Alert.alert()` — use custom `useAlert()` hook

### Website (`website/`)
- Firebase Web SDK (client) + Firebase Admin SDK (server API routes)
- API routes proxy to Cloud Functions (e.g., `/api/clients/create` → `createClientV1`)
- TypeScript with strict types in `lib/types.ts`
- Tailwind CSS for styling, React Hook Form + Zod for forms
- `resolveCompanyScope(companyId, uid)` helper returns `companyId ?? uid` for unified solo/team paths
- All inventory operations use Firestore transactions via `firestore-service.ts`

## Roles

| Role | Access Level |
|------|-------------|
| Manager | Full company control |
| Worker | Assigned jobs + inventory picks |
| User | Solo: own jobs, inventory, clients, docs |
| Basic | Clients + documents only |
| Dev | Full internal access |
