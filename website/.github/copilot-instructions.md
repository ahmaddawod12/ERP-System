# GitHub Copilot Instructions — Smart-Job ERP Website

## Overview

Next.js App Router web dashboard for Smart-Job ERP. Shares the same Firebase project and Firestore database as the phone app.

See the root `.github/copilot-instructions.md` for the canonical Firestore schema, job ID formats, status flow, business info fields, and subscription model. This file covers website-specific patterns.

## Tech Stack

- **Next.js App Router** with TypeScript (strict mode)
- **Tailwind CSS** for all styling
- **Firebase Web SDK** (client-side auth + Firestore reads/writes)
- **Firebase Admin SDK** (server-side API routes for privileged operations)
- **React Hook Form + Zod** for form validation
- **EN/HE/AR** i18n with RTL support

## Key Architecture Patterns

### resolveCompanyScope

```typescript
// lib/services/firestore-service.ts
export function resolveCompanyScope(companyId: string | null | undefined, uid: string): string {
  return companyId ?? uid;
}
```

**Always use this** to get the scope ID for Firestore paths. Solo users (`companyId` is null) use their `uid` as the company ID, so all data goes under `companies/{uid}/*`.

### Inventory = Single Document

Inventory is a single Firestore document with a `parts` array. All mutations use **Firestore transactions** to prevent concurrent write conflicts.

```typescript
// Company inventory
getCompanyInventory(companyId)
addCompanyInventoryPart(companyId, partName)
toggleCompanyInventoryPart(companyId, partId)
removeCompanyInventoryPart(companyId, partId)

// User (personal) inventory
getUserInventory(uid)
addUserInventoryPart(uid, partName, quantity?, lowThreshold?)
updateUserInventoryPart(uid, partId, updates)
removeUserInventoryPart(uid, partId)

// Worker picks from company → personal
pickCompanyParts(companyId, uid, partsToPick)
```

### API Routes Proxy to Cloud Functions

Website API routes at `/api/*` proxy to Firebase Cloud Functions. This keeps sensitive logic server-side.

| API Route | Cloud Function |
|-----------|---------------|
| `POST /api/clients/create` | `createClientV1` |
| `POST /api/documents/generate` | `generateDocumentV1` (legacy — kept for backward compat) |
| `POST /api/invites/create` | `createInvite` |
| `POST /api/onboarding/join-company` | `joinCompanyWithInvite` |
| `POST /api/upgrades/request` | `submitUpgradeRequest` |
| `POST /api/contact/request` | `submitContactRequest` |

### Document Generation (Pub/Sub — matches phone app)

The website uses the same Pub/Sub-based document flow as the phone app:

1. **Preview**: `useDocumentTask.publishPreview()` → callable `publishPreviewTask` (us-central1) → Pub/Sub → Cloud Run PDF worker → `documentTasks/{taskId}` with `previewURL`
2. **Generate**: `useDocumentTask.publishGenerate()` → callable `publishGenerateTask` (us-central1) → Pub/Sub → Cloud Run PDF worker → `documentTasks/{taskId}` with `downloadURL`
3. **Tax Invoice (305)**: `useDocumentTask.getInvoiceApproval()` → callable `getInvoiceApproval` (me-west1) → Tax Authority API → approval → PDF task via Pub/Sub

Firebase Functions SDK is initialized with two regions in `lib/firebase/client.ts`:
- `functions` — us-central1 (publishPreviewTask, publishGenerateTask)
- `middleEastFunctions` — me-west1 (getInvoiceApproval)

The `useDocumentTask` hook (`hooks/use-document-task.ts`) manages the full lifecycle with `onSnapshot` listeners on `documentTasks/{taskId}`, matching the phone app’s hook.

### Auth Pattern

- Production: `Authorization: Bearer <Firebase ID token>` header on all API requests
- Development: `uid` field in request body accepted when `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
- Server-side token verification via Firebase Admin SDK in `request-auth.ts`

## File Organization

```
src/
├── app/
│   ├── app/                 # Protected dashboard pages
│   │   ├── page.tsx         # Overview / stats dashboard
│   │   ├── jobs/            # Job management
│   │   ├── clients/         # Client management
│   │   ├── inventory/       # Inventory (company + personal)
│   │   ├── inventory-picks/ # Worker picks from company stock
│   │   ├── documents/       # Certification history + generation
│   │   ├── workers/         # Worker management (manager only)
│   │   ├── settings/        # Profile + preferences
│   │   ├── upgrade/         # Subscription upgrade
│   │   └── admin/           # Admin panel
│   ├── api/                 # Server-side API routes
│   ├── register/            # Registration flow
│   └── login/               # Login page
├── components/              # Shared UI components
├── hooks/                   # React hooks (use-app-context, use-auth, use-document-task, etc.)
└── lib/
    ├── types.ts             # All TypeScript interfaces
    ├── firestore-paths.ts   # Firestore document/collection references
    ├── docs.ts              # Documentation entries
    ├── services/
    │   └── firestore-service.ts  # All Firestore CRUD operations
    ├── firebase/
    │   ├── client.ts        # Firebase Web SDK init
    │   └── server-access.ts # Firebase Admin SDK init
    └── api/                 # API client helpers
```

## Critical Rules

1. **Never use `users/{uid}/personal_inventory`** — use `users/{uid}/data/inventory` (single doc)
2. **Never use inventory subcollections** — inventory is a single doc with `parts` array
3. **Never use `in_progress` or `completed`** for job status — use `pending`, `waiting`, `finished`, `denied`
4. **Always use `resolveCompanyScope(companyId, uid)`** to get the scope ID — don't branch on `companyId` vs `uid` manually
5. **All client operations** go through `companies/{scopeId}/clients/*` — never `users/{uid}/clients`
6. **Business info fields**: `he_name`, `en_name`, `vat_number` — never `name`, `number`
7. **Job IDs**: `p_XXXXX` for pending, `f_XXXXX` for finished — never auto-generated IDs
