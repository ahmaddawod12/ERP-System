# Documents Module Data Structures

Source of truth: `functions/src/documents.js`, `functions/src/tax.js`, `functions/src/shared.js`, `cloudrun-pdf/index.js`, `firestore.rules`.

## Firestore Documents

| Path | Purpose | Key Fields |
| --- | --- | --- |
| `companies/{companyId}/documents/{docId}` | Final document record | `type`, client fields, `items`, totals, `createdBy`, `createdAt`, `downloadURL`, `storagePath`; tax docs also include tax metadata |
| `documentTasks/{taskId}` | Async document task state | `taskId`, `status`, `type/taskType`, `documentType`, `documentId`, `uid`, `companyId`, `documentData`, `pubsubMessageId`, queue/completion metadata |
| `companies/{companyId}/documentLocks/{lockType}` | Generation lock | `lockedBy`, `taskId`, `lockedAt` |
| `companies/{companyId}/auditLogs/{logId}` | Audit trail | `action`, `performedBy`, `timestamp`, `documentId`, `documentType` |
| `companies/{companyId}/data/token` | Tax OAuth credentials | `accessToken`, `refreshToken`, expiry fields, refresh metadata |
| `taxAuthPending/{authId}` | Pending OAuth state | `state`, `stateNonce`, `status`, `expiresAt`, `companyId`, `uid` |
| `taxAuthCallbacks/{authId}` | OAuth callback tracking | `code`, `used`, token exchange result fields |
| `companies/{companyId}/data/cache` | Document cache invalidation | `documentsVersion`, `updatedAt` plus legacy dynamic doc marker fields from PDF worker |

## Document Types

| Code | Type |
| --- | --- |
| `10` | Price Proposal |
| `200` | Delivery Note |
| `210` | Return Certificate |
| `305` | Tax Invoice |
| `330` | Refund |
| `400` | Receipt |

## API Contracts

| Function | Type | Main Inputs | Main Writes |
| --- | --- | --- | --- |
| `publishPreviewTask` | Callable | `documentType`, `companyId`, `documentData` | creates `documentTasks/{taskId}` (pending -> queued) |
| `publishGenerateTask` | Callable | `documentType`, `companyId`, `documentData` (or `documentId` for 305) | task creation, and for non-305 increments `business_info.document_numbers` |
| `getInvoiceApproval` | Callable (me-west1) | `type=305`, `companyId`, `client`, `items`, optional `language/date/notes/jobsData/priceProposalId` | saves approved tax document, updates linked jobs/proposal/cache, writes audit log, publishes generate task |
| `deleteDocumentV1` | Callable | `companyId`, `documentId` | deletes document + increments company `documentsVersion` |
| `startTaxAuthorityAuth` | Callable | authenticated manager context | creates `taxAuthPending/{authId}` and returns OAuth URL |
| `taxAuthorityCallback` | HTTP | OAuth callback params (`code`, `state`) | updates callback docs, exchanges token, writes `companies/{companyId}/data/token` |

## Cloud Run Output Contracts

| Flow | Storage Path | Firestore Updates |
| --- | --- | --- |
| Preview PDF | `previews/{uid}/{fileName}.pdf` | `documentTasks/{taskId}` gets `previewURL`, `storagePath`, `pdfSize`, `status=completed` (or failed) |
| Final PDF | `companies/{companyId}/{YYYY-MM}/{documentId}/{documentId}.pdf` | `documents/{docId}` gets `downloadURL` + `storagePath`; task gets completion metadata; cache doc may get dynamic field keyed by `documentId` |

## Important Compatibility Notes

| Topic | Current Behavior |
| --- | --- |
| `confirmationNumber` field | Returned by tax callable and passed in task payload, but not currently persisted as top-level `documents/{docId}.confirmationNumber` |
| Non-tax document shape | Cloud Run writes a compact document shape; some UI readers still expect older optional fields (`documentType`, `paymentMethod`, `documentData`, `createdByUid`) |
