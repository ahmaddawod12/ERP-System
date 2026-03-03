# Smart-Job ERP Data Structures Reference

Scanned from the repository on March 1, 2026.

Scope:
- Firestore documents and collections actively used by `functions/`, `website/`, `phone_app/`, `cloudrun-pdf/`, and `cloudrun-archiver/`
- Shared enums and value sets from `packages/contracts/`
- Request payloads for the main callable and HTTP endpoints
- Reserved or partially implemented paths that exist in rules but do not currently have a concrete writer in the repo

Split module docs:
- `DATA_STRUCTURES_AUTH.md`
- `DATA_STRUCTURES_JOBS.md`
- `DATA_STRUCTURES_DOCUMENTS.md`
- `DATA_STRUCTURES_INVENTORY.md`
- `API_DATABASE_TABLES.md`

Primary source files:
- `packages/contracts/index.js`
- `website/src/lib/types.ts`
- `website/src/lib/validation/schemas.ts`
- `functions/src/auth.js`
- `functions/src/profile.js`
- `functions/src/clients.js`
- `functions/src/inventory.js`
- `functions/src/invites.js`
- `functions/src/jobs.js`
- `functions/src/documents.js`
- `functions/src/tax.js`
- `functions/src/misc.js`
- `functions/src/shared.js`
- `cloudrun-pdf/index.js`
- `cloudrun-archiver/index.js`
- `firestore.rules`
- `website/scripts/seed-demo.mjs`

## Reading Notes

- `business_info` is snake_case. Most other documents are camelCase.
- Many timestamps are stored as ISO strings. Some writers use `FieldValue.serverTimestamp()`, so clients may temporarily see Firestore `Timestamp` values on some fields.
- `companyId` is allocated from `system/data/comid` and is a numeric string.
- Job IDs are plain Base62 strings from `companies/{companyId}/counters/jnext`.
- Generated document IDs are currently `${suffix}${documentNumber}-${companyId}` such as `TI12-42` or `PP3-42`.
- Support chat currently stores messages inline on the conversation document as `message1`, `message2`, ... even though rules also define a `messages` subcollection path.

## Shared Enums And Value Sets

### Roles
- `manager`
- `worker`
- `user`
- `basic`
- `dev`

### Job Statuses
- `pending`
- `waiting`
- `finished`
- `denied`

### Document Type Codes
- `10`: Price Proposal
- `200`: Delivery Note
- `210`: Return Certificate
- `305`: Tax Invoice
- `330`: Refund
- `400`: Receipt

### Subscription Tiers
- `Basic`
- `User` in contracts, marketed as `Solo` on the website
- `Team`
- `Dev` in contracts, marketed as `Enterprise` on the website

### Subscription Status Values
- `active`
- `trial`
- `expired`
- Website code also uses `inactive` and `pending` in UI types

## Reusable Nested Shapes

### `InventoryPart`
- `id: number`
- `name: string`
- `active?: boolean`
- `quantity?: number`
- `lowThreshold?: number`
- `dateAdded: string`
- `sourcePartId?: number`

Notes:
- `sourcePartId` appears when a worker picks a company part into personal inventory.

### `EnabledModules`
- `team: boolean`
- `solojob: boolean`
- `documents: boolean`
- `teaminventory: boolean`
- `companyinventory: boolean`
- `inventory: boolean`

### `SupportMessage`
- Stored inline as `message1`, `message2`, ...
- Shape:
  - `senderUid: string`
  - `text: string`

### `DocumentItem` (submitted/generation payload)
- `description: string`
- `quantity: number`
- `price: number`
- `partId?: number`
- `category?: number`

Notes:
- Non-tax documents written by `cloudrun-pdf` convert `partId` into stored field `id`.
- Tax invoice documents keep the raw submitted `items` array.

## Firestore Structures

### `system/data/comid`
Purpose: global company ID allocator.

Fields:
- `comid: number`
- `updatedAt?: string`
- `lastAllocatedCompanyId?: string`
- `lastAllocatedBy?: string`

### `users/{uid}/data/profile`
Purpose: canonical per-user profile.

Fields:
- `uid: string`
- `email: string`
- `role: "manager" | "worker" | "user" | "basic" | "dev"`
- `companyId: string | null`
- `name: string`
- `phoneNumber: string`
- `accountType: "solo" | "business"`
- `createdAt: string | Timestamp`
- `updatedAt?: string | Timestamp`
- `wid?: number` (workers only — sequential worker ID)
- `mid?: number` (managers only — sequential manager ID)
- `pushToken?: string`
- `pushTokenUpdatedAt?: string`
- `pushTokenPlatform?: string`
- `pushTokenType?: string`

Notes:
- Worker profiles include `wid` (sequential worker ID). Manager profiles include `mid` (sequential manager ID).
- `pushToken*` fields are only written by the push-token Cloud Functions.

### `users/{uid}/data/cache`
Purpose: user-scoped cache versioning.

Fields:
- `profile?: number`
- `inventory?: number`
- `subscription?: number`
- `lastUpdated?: string | Timestamp`
- Dynamic document markers written by `cloudrun-pdf`:
  - `TI12-42?: 1`
  - `PP3-42?: 1`
  - any other generated `documentId` may appear as a flat field name with value `1`

Notes:
- Only these fields are allowed by rules and `updateCacheV1`.
- Managers may also bump a worker's cache through the backend.
- Admin-side PDF generation currently merges document-ID marker fields into user cache docs after final generation.

### `users/{uid}/data/inventory`
Purpose: personal inventory document.

Fields:
- `parts: InventoryPart[]`
- `nextId: number`
- `lastUpdated: string`

Notes:
- User-picked parts may include `sourcePartId`.

### `companies/{companyId}`
Purpose: company root document.

Fields:
- `companyId: string`
- `createdBy: string`
- `createdAt: string`

Notes:
- Counters have moved to the `companies/{companyId}/counters/` subcollection. See `counters/{wnext|mnext|cnext|jnext}` below.

### `companies/{companyId}/data/business_info`
Purpose: business registration and document numbering.

Fields:
- `he_name: string`
- `en_name: string`
- `city: string`
- `address: string`
- `vat_number: string`
- `business_type: string`
- `document_numbers: Record<string, number>`
- `business_email?: string`
- `business_phone?: string`
- `business_fax?: string`
- `accountant_name?: string`
- `accountant_email?: string`
- `accountant_phone?: string`
- `registered_at?: string`
- `registered_by?: string`
- `registered_by_role?: string`
- `last_updated?: string`

Notes:
- `vat_number` and `document_numbers` are immutable from `updateBusinessInfoV1`.
- The backend initializes document counters for `305`, `400`, `330`, `210`, `10`, and `200`.

### `companies/{companyId}/data/subscription`
Purpose: current company subscription.

Fields:
- `tier: string`
- `status: string`
- `enabledModules: EnabledModules`
- `expiresAt?: string`
- `updatedAt: string`

### `companies/{companyId}/data/inventory`
Purpose: shared company inventory document.

Fields:
- `parts: InventoryPart[]`
- `nextId: number`
- `lastUpdated: string`

Notes:
- Company parts usually have `active`; worker inventories usually care more about `quantity`.

### `companies/{companyId}/data/cache`
Purpose: company-scoped summary cache.

Fields:
- `jobsVersion?: number`
- `documentsVersion?: number`
- `clientsVersion?: number`
- `workersVersion?: number`
- `updatedAt?: string | Timestamp`
- `lastUpdated?: string`
- Dynamic document markers written by `cloudrun-pdf` when the generator chooses the company cache path:
  - `TI12-42?: 1`
  - `PP3-42?: 1`
  - any other generated `documentId` may appear as a flat field name with value `1`

Notes:
- This is the summary doc watched by the mobile cache layer.
- The document may exist before all version fields are populated.
- Although the intended shape is version counters only, admin-side PDF generation currently also writes per-document marker fields.

### `companies/{companyId}/data/token`
Purpose: Israeli Tax Authority OAuth tokens.

Fields:
- `accessToken?: string`
- `refreshToken?: string`
- `accessTokenExpiresAt?: number`
- `refreshTokenExpiresAt?: number`
- `authorizedAt?: Timestamp`
- `callbackId?: string`
- `lastRefreshedBy?: string`
- `lastUpdated?: Timestamp`
- `autoRefreshedDuringInvoiceSubmission?: boolean`
- `tokenInvalidatedAt?: Timestamp`
- `tokenInvalidatedReason?: string`

### `companies/{companyId}/workers/{wid}`
Purpose: company membership record for a manager, worker, user, or basic user.

Fields:
- `uid: string`
- `wid: number`
- `role: "manager" | "worker" | "user" | "basic" | "dev"`
- `email: string`
- `name: string`
- `phoneNumber: string`
- `createdAt: string | Timestamp`
- `updatedAt?: string | Timestamp`

Notes:
- The worker document ID is the member's sequential `wid` (not their Firebase Auth `uid`).

### `companies/{companyId}/clients/{clientId}`
Purpose: client record.

Fields:
- `cid: number`
- `cname: string`
- `createdAt: string`
- `email?: string`
- `cphone?: string`
- `address?: string`
- `city?: string`
- `vatNumber?: string`
- `notes?: string`
- `updatedAt?: string`

Notes:
- `clientId` is `String(cid)` from the `companies/{companyId}/counters/cnext` counter.

### `companies/{companyId}/jobs/{jobId}`
Purpose: unified jobs collection for both pending and finished work.

Core fields always expected from current backend:
- `status: "pending" | "waiting" | "finished" | "denied"`
- `createdAt: string`
- `updatedAt: string`

Assignment and client fields (canonical short names):
- `wid?: number` (worker sequential ID)
- `wname?: string` (worker name)
- `mid?: number` (manager sequential ID)
- `mname?: string` (manager name)
- `cid?: string` (client ID)
- `cname?: string` (client name)
- `cphone?: string` (client phone)

Whitelisted job content fields:
- `title?: string`
- `description?: string`
- `parts?: unknown[]`
- `partsUsed?: unknown[]`
- `notes?: string`
- `priority?: string`
- `dueDate?: string`
- `location?: string`
- `address?: string`
- `category?: string`
- `tags?: unknown[]`
- `images?: unknown[]`
- `timeFrom?: string`
- `timeTo?: string`
- `travelDistance?: number | null`
- `signingPerson?: string`
- `photos?: string[]`
- `signature?: string`
- `finishedAt?: string`
- `isCert?: boolean`
- `deniedAt?: string`
- `deniedBy?: string`

Backend-added lifecycle and bookkeeping fields:
- `acceptedBy?: string`
- `acceptedAt?: string`
- `documentId?: string`
- `documentCreatedAt?: string`
- `idempotencyKey?: string`

Notes:
- Finished jobs created directly by solo users are still stored in this same collection.
- `parts` and `partsUsed` are intentionally loose arrays in current code; the common shape is usually `{ id, name, quantity }`.

### `companies/{companyId}/documents/{docId}`
Purpose: generated business documents.

Shared fields seen across current writers:
- `type: number`
- `cname?: string`
- `cphone?: string | null`
- `clientId?: string | null`
- `items?: unknown[]`
- `notes?: string | null`
- `createdBy?: string`
- `createdAt?: string`
- `totalBeforeVat?: number`
- `vatAmount?: number`
- `totalWithVat?: number`
- `downloadURL?: string`
- `storagePath?: string`

Tax-invoice-specific fields written by `getInvoiceApproval`:
- `documentNumber: number`
- `clientVatNumber?: string | null`
- `date?: string`
- `language?: string`
- `jobsData?: unknown[] | null`
- `priceProposalId?: string | null`
- `itemCount?: number`
- `taxAuthoritySubmittedAt?: string`
- `taxAuthorityResponseData?: Record<string, unknown>`

Price-proposal consumption fields written later when an invoice uses a proposal:
- `isUsed?: boolean`
- `usedByDocumentId?: string`
- `usedAt?: string`

Post-generation fields written by Cloud Run:
- `downloadURL?: string`
- `storagePath?: string`

Important mismatch:
- The current tax-invoice writer does not store a top-level `confirmationNumber`; it is returned in the callable response and included in `taxAuthorityResponseData`.
- The current non-tax Cloud Run writer stores a smaller record than older readers expect. Fields like `documentType`, `paymentMethod`, `paymentInfo`, `documentData`, `confirmationNumber`, and `createdByUid` are still referenced by some UI code but are not written by the current backend path.

### `companies/{companyId}/invites/{inviteId}`
Purpose: onboarding invite record.

Fields:
- `inviteId: string`
- `code: string`
- `companyId: string`
- `targetRole: "worker" | "user" | "basic"`
- `status: "active" | "used"`
- `createdBy: string`
- `createdAt: string`
- `expiresAt: string`
- `usedBy: string | null`
- `usedAt: string | null`

### `companies/{companyId}/auditLogs/{logId}`
Purpose: audit trail for company actions.

Fields:
- `action: string`
- `performedBy: string`
- `timestamp: Timestamp`
- `documentId: string | null`
- `documentType: number | null`

### `companies/{companyId}/documentLocks/{lockType}`
Purpose: short-lived document generation lock.

Fields:
- `lockedBy: string`
- `taskId: string`
- `lockedAt: Timestamp`

### `companies/{companyId}/counters/{wnext|mnext|cnext|jnext}`
Purpose: sequential ID allocators for workers, managers, clients, and jobs.

Each document has:
- `next: number`

Documents:
- `counters/wnext` — next worker ID
- `counters/mnext` — next manager ID
- `counters/cnext` — next client ID
- `counters/jnext` — next job ID

Notes:
- All create flows allocate IDs by reading and incrementing `next` inside a transaction.
- These replace the former `cid`, `wid`, and `jid` fields on the company root document.

### `documentTasks/{taskId}`
Purpose: preview/generate task tracking for document workflows.

Common base fields:
- `taskId: string`
- `status: "pending" | "queued" | "completed" | "failed"`
- `documentType: number`
- `uid: string`
- `companyId: string`
- `createdBy: string`
- `createdAt: Timestamp`
- `documentData: Record<string, unknown>`

Preview task fields:
- `type: "preview"`
- `pubsubMessageId?: string`
- `queuedAt?: Timestamp`
- `previewURL?: string`
- `storagePath?: string`
- `pdfSize?: number`
- `completedAt?: string | Timestamp`
- `processingTimeMs?: number`
- `expiresAt?: string`
- `error?: string`

Generate task fields:
- `type: "generate"`
- `taskType?: "generate"`
- `documentId?: string`
- `documentNumber?: number`
- `pubsubMessageId?: string`
- `queuedAt?: Timestamp`
- `downloadURL?: string`
- `storagePath?: string`
- `pdfSize?: number`
- `completedAt?: string | Timestamp`
- `processingTimeMs?: number`
- `isNewDocument?: boolean`
- `emailSent?: boolean`
- `emailMessageId?: string | null`
- `emailError?: string | null`
- `emailRecipient?: string | null`
- `error?: string`

Notes:
- Preview completion currently uses `serverTimestamp()` for `completedAt`.
- Generate completion currently writes `completedAt` as an ISO string.

### `conversations/{conversationId}`
Purpose: support-chat conversation.

Fields:
- `userId: string`
- `userName?: string`
- `status: "open" | "closed"`
- `category: string`
- `lastMessage: string`
- `lastMessageAt: Timestamp`
- `createdAt: Timestamp`
- `unreadForUser: number`
- `unreadForDev: number`
- Dynamic inline messages:
  - `message1?: SupportMessage`
  - `message2?: SupportMessage`
  - `messageN?: SupportMessage`

Notes:
- The app does not currently use a `messages` subcollection even though rules define one.

### `upgrade_requests/{requestId}`
Purpose: upgrade ticket submitted by an authenticated user.

Fields:
- `uid: string`
- `email: string | null`
- `companyId: string | null`
- `role: string`
- `currentTier: string`
- `requestedTier: string`
- `message: string`
- `createdAt: string`
- `updatedAt: string`
- `status: string`

Notes:
- Current statuses observed: `new`, `approved`, `rejected`.

### `contact_requests/{requestId}`
Purpose: public contact form submission.

Fields:
- `name: string`
- `email: string`
- `company: string`
- `message: string`
- `status: string`
- `createdAt: string`
- `updatedAt: string`

### `notificationLog/{logId}`
Purpose: push-notification deduplication log.

Assignment notification fields:
- `jobId: string`
- `notificationType: "assigned"`
- `workerUserId: string`
- `workerEmail: string`
- `managerUserId?: string`
- `managerName?: string`
- `jobTitle?: string`
- `companyId: string`
- `sentAt: Timestamp`
- `expireAt: Date`
- `messageId?: string | null`
- `duration?: number`

Submission notification fields:
- `jobId: string`
- `notificationType: "submitted"`
- `workerUserId: string`
- `workerName?: string`
- `managerUserId: string`
- `managerEmail: string`
- `jobTitle?: string`
- `companyId: string`
- `sentAt: Timestamp`
- `expireAt: Date`
- `messageId?: string | null`
- `duration?: number`

### `taxAuthPending/{authId}`
Purpose: pending Israeli Tax Authority OAuth session.

Fields:
- `authId: string`
- `companyId: string`
- `uid: string`
- `email?: string`
- `state: string`
- `stateNonce: string`
- `createdAt: Timestamp`
- `createdAtMillis: number`
- `status: string`
- `expiresAt: number`
- `usedAt?: Timestamp`

### `taxAuthCallbacks/{authId}`
Purpose: callback capture and token-exchange result for Tax Authority OAuth.

Fields:
- `authId: string`
- `companyId?: string | null`
- `uid?: string | null`
- `state: string`
- `code: string`
- `receivedAt: Timestamp`
- `receivedAtMillis: number`
- `used: boolean`
- `codeLength: number`
- `usedAt?: Timestamp`
- `tokenExchangeSuccess?: boolean`
- `tokenExchangeError?: string`
- `tokenExchangeAttemptedAt?: Timestamp`
- `expiresIn?: number`
- `accessTokenExpiresAt?: number`
- `refreshTokenExpiresAt?: number`

## Reserved Or Partially Implemented Firestore Paths

### `companies/{companyId}/inventory_picks/{pickId}`
- Exists in `firestore.rules`
- No concrete writer or reader was found in the repo
- Current worker inventory-pick flow mutates company and user inventory directly through `updateInventoryV1`

### `companies/{companyId}/client_create_requests/{requestId}`
- Exists in `firestore.rules`
- No concrete writer or reader was found in the repo

### `conversations/{conversationId}/messages/{messageId}`
- Exists in `firestore.rules`
- Current mobile support chat does not use it
- Real message storage is inline on the parent conversation doc as `message1`, `message2`, ...

## Cloud Storage Structures

### Preview PDF object
Path pattern:
- `previews/{uid}/{fileName}.pdf`

Custom metadata:
- `documentType`
- `createdBy`
- `createdAt`
- `isPreview`
- `taskId`
- `expiresAt`
- `firebaseStorageDownloadTokens`

### Final PDF object
Path pattern:
- `companies/{companyId}/{YYYY-MM}/{documentId}/{documentId}.pdf`

Custom metadata:
- `documentId`
- `documentType`
- `companyId`
- `createdBy`
- `generatedAt`
- `pdfSize`
- `firebaseStorageDownloadTokens`

### Company archives
Manifest path:
- `companies/{companyId}/archives/manifest.json`

Manifest shape:
- `Record<string, { archivedAt: string; docCount: number }>`

Archive file path:
- `companies/{companyId}/archives/{YYYY}-{M}-j.json`
- `companies/{companyId}/archives/{YYYY}-{M}-d.json`

Archive file contents:
- JSON array of full Firestore job or document objects copied from live collections

Archive metadata:
- `docCount`
- `archiveKey`
- `companyId`
- `archivedAt`

## Main Mutation Payloads

### `registerBusinessV1`
Fields:
- `role: "manager" | "user" | "basic"`
- `accountType: "solo" | "business"`
- `name: string`
- `phoneNumber: string`
- `he_name?: string`
- `en_name?: string`
- `vat_number?: string`
- `business_type?: string`
- `city?: string`
- `address?: string`
- `business_email?: string`
- `business_phone?: string`
- `business_fax?: string`
- `accountant_name?: string`
- `accountant_email?: string`
- `accountant_phone?: string`

### `manageWorker`
Fields:
- `action: "add" | "edit" | "delete"`
- `companyId: string`
- `email: string`
- `password?: string`
- `newPassword?: string`
- `name?: string`
- `phoneNumber?: string`
- `workerUid?: string`
- `wid?: number`
- `role?: "worker" | "user" | "basic"`

Notes:
- `add` always creates a `worker` profile in current code.

### `updateProfileV1`
Fields:
- `name?: string`
- `phoneNumber?: string`

### `updatePushTokenV1`
Fields:
- `pushToken: string`
- `pushTokenPlatform?: string`
- `pushTokenType?: string`

### `updateBusinessInfoV1`
Fields:
- `companyId: string`
- Optional editable fields:
  - `he_name`
  - `en_name`
  - `city`
  - `address`
  - `business_type`
  - `business_phone`
  - `business_email`
  - `business_fax`
  - `accountant_name`
  - `accountant_email`
  - `accountant_phone`

Blocked fields:
- `vat_number`
- `document_numbers`

### `updateCacheV1`
Fields:
- `companyId?: string`
- `isCompanyCache?: boolean`
- `field: "profile" | "inventory" | "subscription" | "lastUpdated" | "jobsVersion" | "documentsVersion" | "clientsVersion" | "workersVersion" | "updatedAt"`
- `action?: "increment" | "delete"`
- `targetUid?: string`

### `createInviteV1`
Fields:
- `companyId: string`
- `targetRole?: "worker" | "user" | "basic"`

### `joinCompanyV1`
Fields:
- `companyId: string`
- `inviteCode: string`
- `email: string`
- `name?: string`
- `phoneNumber?: string`
- `role?: "worker" | "user" | "basic"`

### `addClientV1`
Fields:
- `companyId: string`
- `cname: string`
- `email?: string`
- `cphone?: string`
- `address?: string`
- `city?: string`
- `vatNumber?: string`
- `notes?: string`

### `updateClientV1`
Fields:
- `companyId: string`
- `clientId: string`
- `cname?: string`
- `email?: string`
- `cphone?: string`
- `address?: string`
- `city?: string`
- `vatNumber?: string`
- `notes?: string`

### `deleteClientV1`
Fields:
- `companyId: string`
- `clientId: string`

### `createJobV1`
Fields:
- `companyId: string`
- `type: "pending" | "finished"`
- `idempotencyKey?: string`
- Allowed job payload fields:
  - `title`
  - `description`
  - `wid`
  - `wname`
  - `mid`
  - `mname`
  - `cid`
  - `cname`
  - `cphone`
  - `parts`
  - `partsUsed`
  - `notes`
  - `priority`
  - `dueDate`
  - `location`
  - `address`
  - `category`
  - `tags`
  - `images`
  - `timeFrom`
  - `timeTo`
  - `travelDistance`
  - `signingPerson`
  - `photos`
  - `signature`
  - `finishedAt`

### `updateJobV1`
Fields:
- `companyId: string`
- `jobId: string`
- Allowed update fields:
  - all `createJobV1` job fields, plus
  - `status`
  - `isCert`
  - `deniedAt`
  - `deniedBy`

### `acceptJobV1`
Fields:
- `companyId: string`
- `jobId: string`

### `deleteJobV1`
Fields:
- `companyId: string`
- `jobId: string`

### `updateInventoryV1`
Common fields:
- `companyId: string`
- `action: "addPart" | "removePart" | "togglePart" | "updatePart" | "pickParts" | "replaceParts"`
- `scope: "company" | "user"`
- `targetUid?: string`

Action-specific fields:
- `addPart`
  - `partName: string`
  - `active?: boolean`
  - `quantity?: number`
  - `lowThreshold?: number`
- `removePart`
  - `partId: number`
- `togglePart`
  - `partId: number`
- `updatePart`
  - `partId: number`
  - `partName?: string`
  - `quantity?: number`
  - `lowThreshold?: number`
  - `active?: boolean`
- `pickParts`
  - `partsToPick: Array<{ id: number; name: string; quantity: number }>`
- `replaceParts`
  - `parts: InventoryPart[]`

### `publishPreviewTask`
Fields:
- `documentType: number`
- `companyId: string`
- `documentData:`
  - `client: { name: string; email?: string; phone?: string; address?: string; city?: string; clientVatNumber?: string }`
  - `items: DocumentItem[]`
  - `language?: string`
  - `date?: string`
  - `notes?: string`
  - other frontend-calculated fields are allowed through as opaque values

### `publishGenerateTask`
Fields:
- `documentType: number`
- `companyId: string`
- For tax invoices:
  - `documentId: string`
- For non-tax documents:
  - `documentData` with the same structure as preview data

### `getInvoiceApproval`
Fields:
- `companyId: string`
- `type: 305`
- `client:`
  - `name: string`
  - `email?: string`
  - `phone?: string`
  - `address?: string`
  - `id?: string`
  - `clientVatNumber?: string`
  - `customerName?: string`
- `items: DocumentItem[]`
- `company?: Record<string, unknown>`
- `language?: string`
- `date?: string`
- `notes?: string`
- `jobsData?: Array<Record<string, unknown>>`
- `priceProposalId?: string`

### `deleteDocumentV1`
Fields:
- `companyId: string`
- `documentId: string`

### `requestUpgradeV1`
Fields:
- `currentTier?: "Basic" | "Solo" | "Team" | "Enterprise"`
- `requestedTier: "Solo" | "Team" | "Enterprise"`
- `message: string`

### `contactRequestV1`
Fields:
- `name: string`
- `email: string`
- `company: string`
- `message: string`

## Coverage Summary

Actively documented current structures:
- user profile, cache, inventory
- company root, business info, subscription, company inventory, company cache, token
- workers, clients, jobs, documents, invites
- document tasks, audit logs, notification logs, support conversations
- upgrade requests, contact requests
- tax auth pending/callback documents
- storage archives and preview/final PDF metadata

Reserved or inconsistent structures called out explicitly:
- `inventory_picks`
- `client_create_requests`
- support `messages` subcollection versus actual inline `messageN` fields
