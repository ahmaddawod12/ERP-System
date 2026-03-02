# API / Database Handoff Tables

This file is a compact tabular handoff view.  
Canonical long-form reference remains: `DATA_STRUCTURES.md`.

## Core Database Paths

| Path | Domain | Core Fields |
| --- | --- | --- |
| `users/{uid}/data/profile` | Auth | `uid`, `email`, `role`, `companyId`, `name`, `phoneNumber`, `accountType`, `pushToken*` |
| `users/{uid}/data/cache` | Cache | `profile`, `inventory`, `subscription`, `lastUpdated` |
| `users/{uid}/data/inventory` | Inventory | `parts[]`, `nextId`, `lastUpdated` |
| `companies/{companyId}` | Company | `companyId`, `createdBy`, `cid`, `wid`, `jid` |
| `companies/{companyId}/workers/{uid}` | Auth | `workerId`, `uid`, `role`, `email`, `name`, `phoneNumber`, `wid` |
| `companies/{companyId}/clients/{clientId}` | Clients | `name`, contact fields, `vatNumber`, `notes`, `createdAt`, `updatedAt` |
| `companies/{companyId}/jobs/{jobId}` | Jobs | `id`, `jid`, `status`, assignment fields, client fields, execution fields, `isCert` |
| `companies/{companyId}/documents/{docId}` | Documents | `type`, client fields, `items`, totals, tax metadata, `downloadURL`, `storagePath` |
| `companies/{companyId}/invites/{inviteId}` | Auth | `code`, `targetRole`, `status`, `expiresAt`, `usedBy`, `usedAt` |
| `companies/{companyId}/data/business_info` | Auth/Documents | `vat_number`, `document_numbers`, business contact fields |
| `companies/{companyId}/data/subscription` | Billing/Auth | `tier`, `status`, `enabledModules`, `expiresAt`, `updatedAt` |
| `companies/{companyId}/data/inventory` | Inventory | `parts[]`, `nextId`, `lastUpdated` |
| `companies/{companyId}/data/cache` | Cache | `jobsVersion`, `documentsVersion`, `clientsVersion`, `workersVersion`, `updatedAt` |
| `companies/{companyId}/data/token` | Tax | access/refresh token fields and expiry metadata |
| `documentTasks/{taskId}` | Documents | task lifecycle fields, URLs, errors, processing metadata |
| `upgrade_requests/{id}` | Misc | requester info, tier change fields, `status` |
| `contact_requests/{id}` | Misc | `name`, `email`, `company`, `message`, `status` |
| `notificationLog/{id}` | Jobs | dedupe and push delivery metadata |
| `taxAuthPending/{id}` | Tax | pending OAuth state and expiry |
| `taxAuthCallbacks/{id}` | Tax | callback payload and token-exchange status |
| `conversations/{id}` | Support | `userId`, `status`, `category`, unread counters, inline `messageN` fields |

## Function/API Surface

| Function/Route | Type | Main Inputs | Main Writes |
| --- | --- | --- | --- |
| `registerBusinessV1` | Callable | role/account type/profile/business data | profile, company root, workers, business info, subscription, inventories, caches, global company counter |
| `manageWorker` | Callable | add/edit/delete + companyId + email/password payload | auth user and worker/profile/cache docs |
| `createInviteV1` | HTTP `POST` | `companyId`, `targetRole` | invite doc |
| `joinCompanyV1` | HTTP `POST` | `companyId`, `inviteCode`, `email`, optional role/name/phone | invite status + worker/profile/cache updates |
| `updateProfileV1` | Callable | `name?`, `phoneNumber?` | profile + worker mirror fields |
| `updateBusinessInfoV1` | Callable | `companyId` + allowed business fields | business info update + company cache touch |
| `updateCacheV1` | Callable | cache field/action and scope | user or company cache doc |
| `addClientV1` / `updateClientV1` / `deleteClientV1` | Callable | company/client payload | clients docs + company cache client version |
| `createJobV1` / `updateJobV1` / `acceptJobV1` / `deleteJobV1` | Callable | company/job payload | jobs docs + cache version increments + optional inventory side effects |
| `updateInventoryV1` | Callable | companyId, scope, action payload | company/user inventory docs + cache bumps |
| `publishPreviewTask` | Callable | documentType + documentData | `documentTasks/{taskId}` |
| `publishGenerateTask` | Callable | documentType + documentData or documentId | `documentTasks/{taskId}`, doc counters (non-tax) |
| `getInvoiceApproval` | Callable (me-west1) | type=305, company/client/items payload | document record, linked job/proposal updates, cache updates, audit log, generate task publish |
| `deleteDocumentV1` | Callable | `companyId`, `documentId` | document delete + company documents version increment |
| `startTaxAuthorityAuth` | Callable | manager context | pending OAuth session doc |
| `taxAuthorityCallback` | HTTP | OAuth callback params | callback doc + token storage |
| `requestUpgradeV1` | HTTP `POST` | tier request payload | upgrade request doc |
| `contactRequestV1` | HTTP `POST` | public contact payload | contact request doc |

## Cloud Run Data Outputs

| Service | Storage Output | Firestore Output |
| --- | --- | --- |
| `cloudrun-pdf` preview | `previews/{uid}/{fileName}.pdf` | `documentTasks/{taskId}` completion fields (`previewURL`, `storagePath`, `pdfSize`) |
| `cloudrun-pdf` generate | `companies/{companyId}/{YYYY-MM}/{documentId}/{documentId}.pdf` | `documents/{docId}` URL/path + task completion metadata |
| `cloudrun-archiver` | `companies/{companyId}/archives/{YYYY}-{M}-{j|d}.json` + `manifest.json` | No new Firestore docs; deletes archived source docs after verification |
