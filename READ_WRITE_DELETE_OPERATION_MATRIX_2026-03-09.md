# Firestore Operation Matrix (Reads / Writes / Deletes)

Date: 2026-03-09  
Scope audited: `functions/`, `phone_app/`, `website/`, `cloudrun-pdf/`, `cloudrun-archiver/`

## Counting Rules

- This matrix tracks **Firestore** document reads, writes, and deletes only.
- Firebase Auth, Storage, Pub/Sub, HTTP calls, and Tax Authority API calls are excluded.
- `getDoc` / `tx.get` = 1 read per document.
- `getDocs(query...)` = reads equal to documents returned by that query.
- `onSnapshot(docRef)` = 1 read on initial attach, then 1 read per changed doc event.
- `getCountFromServer` is counted as 1 aggregation read per call.
- `saveAuditLog(...)` = 1 Firestore write.
- `assertHttpCompanyAccess(...)` usually adds:
  - Business scope: 2 reads (`users/{uid}/data/profile` + `companies/{companyId}/workers/{wid}`)
  - Solo scope: 1 read (profile only)

### Variables Used

- `W` = worker docs returned
- `C` = client docs returned
- `J` = job docs returned/affected
- `D` = document docs returned/affected
- `K` = pending/waiting jobs assigned to a worker being deleted
- `U` = user-subcollection docs deleted in `deleteUserData(...)`

## 1) Cloud Functions Entry Points

| Operation | Entry | Reads | Writes | Deletes | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Register business | `registerBusinessV1` | 2 | 13 | 0 | Single transaction, manager and solo branches both write 13 docs |
| Add worker | `manageWorker` (`action=add`) | 2 | 5 | 0 | Includes `wnext` transaction + profile/cache/worker docs + audit log |
| Edit worker (normal path) | `manageWorker` (`action=edit`, wid provided) | 3 | 3 | 0 | manager profile + target profile + worker profile read |
| Edit worker (wid missing) | `manageWorker` (`action=edit`) | 4 to 5 | 3 | 0 | Extra reads for wid lookup fallback |
| Delete worker | `manageWorker` (`action=delete`) | `2 + K` | `1 + K (+1 if K>0)` | `1 + U` | 1 delete for worker doc + variable user-data deletes + optional pending-job cleanup |
| Create invite | `createInviteV1` | 2 | 1 | 0 | Auth via token + manager access check |
| Join company | `joinCompanyV1` | 4 | 5 | 0 | Invite queried once, then re-read in transaction |
| Add client (business manager) | `addClientV1` | 3 | 3 | 0 | Access check + `cnext` tx get |
| Add client (solo scope) | `addClientV1` | 2 | 3 | 0 | Solo bypasses membership read |
| Update client (business manager) | `updateClientV1` | 3 | 2 | 0 | Access check + existing client read |
| Delete client (business manager) | `deleteClientV1` | 3 | 1 | 1 | Access check + existing client read |
| Create job (business manager/dev) | `createJobV1` | 3 | 3 | 0 | + optional idempotency query reads (`+Q`) |
| Create job (solo user) | `createJobV1` | 2 | 3 | 0 | Solo bypasses membership read |
| Update job (manager/dev/user) | `updateJobV1` | 3 | 2 | 0 | Access + current job read |
| Update job (worker) | `updateJobV1` | 4 | 2 | 0 | Extra worker profile read to enforce ownership |
| Accept job (no parts deduction) | `acceptJobV1` | 4 | 2 | 0 | Includes worker doc read for wid->uid |
| Accept job (with parts deduction) | `acceptJobV1` | 5 | 4 | 0 | Adds worker inventory read/write + worker cache write |
| Delete job (manager/dev/user) | `deleteJobV1` | 3 | 1 | 1 | Access + existing job read |
| Delete job (worker own job) | `deleteJobV1` | 4 | 1 | 1 | Extra worker profile read |
| Inventory mutation (company scope add/remove/toggle/update/replace) | `updateInventoryV1` | 3 | 3 | 0 | Access + inventory tx read + company/user cache writes |
| Inventory mutation (user own inventory add/remove/toggle/update/replace) | `updateInventoryV1` | 3 | 2 | 0 | Business roles; solo usually 2 reads + 2 writes |
| Inventory mutation (manager edits another user) | `updateInventoryV1` | 7 | 2 | 0 | Two access checks + target-in-company checks are expensive |
| Pick parts from company | `updateInventoryV1` (`action=pickParts`, `scope=company`) | 4 | 4 | 0 | Reads company and user inventory inside tx |
| Publish preview task | `publishPreviewTask` | 3 | 3 | 0 | Includes lock transaction + task set/update |
| Publish preview task error after lock | `publishPreviewTask` | 3 | 3 | 1 | Busy lock cleared on failure |
| Publish generate task (non-tax docs) | `publishGenerateTask` | 4 | 4 | 0 | Business info read + document number tx + shared publish helper |
| Publish generate task (tax invoice docId path) | `publishGenerateTask` | 4 | 3 | 0 | Reads existing doc; no document number increment |
| Delete document (business manager/user/basic) | `deleteDocumentV1` | 3 | 1 | 1 | Access + document read + cache bump |
| Delete document (solo scope) | `deleteDocumentV1` | 2 | 1 | 1 | Solo bypasses membership read |
| Start Tax Authority OAuth | `startTaxAuthorityAuth` | 1 | 1 | 0 | Reads profile, writes pending auth session |
| Tax Authority callback (success, with company) | `taxAuthorityCallback` | 2 | 5 | 0 | Pending + callback reads, token save + callback updates + audit |
| Tax Authority callback (error path) | `taxAuthorityCallback` | 2 | 3 | 0 | Callback set + pending mark used + callback error update |
| Tax invoice approval base success | `getInvoiceApproval` | 4 | 6 | 0 | No token refresh, no linked job/proposal updates |
| Tax invoice approval + token refresh success | `getInvoiceApproval` | 4 | 8 | 0 | Adds token update + audit write |
| Tax invoice approval + linked jobs | `getInvoiceApproval` | 4 | `6 + J + 1(+1 proposal)` | 0 | Job updates + cache bump + optional proposal update |
| Update profile | `updateProfileV1` | 1 to 2 | 1 to 2 | 0 | Second read/write only when syncing worker doc |
| Update push token | `updatePushTokenV1` | 1 | 0 or 1 | 0 | Returns early if token unchanged |
| Update business info | `updateBusinessInfoV1` | 3 | 2 | 0 | Access check + business info existence read |
| Update cache (own user cache) | `updateCacheV1` | 0 | 1 | 0 | Direct set/merge |
| Update cache (company cache) | `updateCacheV1` | 2 | 1 | 0 | Access check required |
| Update cache (cross-user target) | `updateCacheV1` | 4 to 6 | 1 | 0 | Includes cross-user authorization checks |
| Clear push token | `clearPushTokenV1` | 1 | 0 or 1 | 0 | Writes only if profile exists |
| Request upgrade | `requestUpgradeV1` | 1 | 1 | 0 | Reads profile then writes request |
| Contact request | `contactRequestV1` | 0 | 1 | 0 | Public endpoint |

## 2) Firestore Triggers and Async Backends

| Operation | Entry | Reads | Writes | Deletes | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Job assignment notification trigger | `onJobAssignTrigger` | 3 | 1 | 0 | Worker lookup + dedupe lookup + worker profile read |
| Job submission notification trigger | `onJobSubmitTrigger` | 3 | 1 | 0 | Manager lookup + dedupe lookup + manager profile read |
| Task completed trigger | `onTaskCompleted` | 0 | 0 | 1 | Clears company document lock |
| Cloud Run preview processor | `cloudrun-pdf /preview` | 1 | 1 | 0 | Requester profile read + task status update |
| Cloud Run generate processor | `cloudrun-pdf /generate` | 2 | 4 | 0 | CAS tx read/write + requester profile + document write + cache + task update |
| Cloud Run generate skip (already processed) | `cloudrun-pdf /generate` | 1 | 0 | 0 | CAS detects completed/failed/processing |
| Archiver list companies | `cloudrun-archiver main` | `N_companies` | 0 | 0 | Reads all `companies` docs |
| Archiver finished jobs per company-month | `cloudrun-archiver processCompany` | `2J` | 0 | `J` | Query once for archive, query again for delete batches |
| Archiver documents per company-month | `cloudrun-archiver processCompany` | `2D` | 0 | `D` | Same double-query pattern as jobs |

## 3) Client-Side Direct Firestore Operations

### 3.1 Website

| Operation | File | Reads | Writes | Deletes | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Auth bootstrap (`loadUserProfile`) | `website/src/components/providers/auth-provider.tsx` | 1 to 2 | 0 | 0 | Profile read + subscription read if company exists |
| Dashboard stats load | `website/src/app/app/page-client.tsx` | 3 | 0 | 0 | 2 aggregation reads (`jobs`,`clients`) + inventory doc read |
| List workers | `website/src/lib/services/firestore-service.ts` | `W` | 0 | 0 | Query workers collection |
| Update worker role (wrapper) | `website/src/lib/services/firestore-service.ts` | `1 + manageWorker(edit)` | `manageWorker(edit)` | 0 | Extra pre-read of worker doc email |
| List jobs (page) | `website/src/lib/services/firestore-service.ts` | `J_page` | 0 | 0 | Paged query |
| Get company inventory | `website/src/lib/services/firestore-service.ts` | 1 | 0 | 0 | Single doc |
| Get user inventory | `website/src/lib/services/firestore-service.ts` | 1 | 0 | 0 | Single doc |
| List clients | `website/src/lib/services/firestore-service.ts` | `C_page` | 0 | 0 | Paged query |
| List documents | `website/src/lib/services/firestore-service.ts` | `D` | 0 | 0 | Ordered query |
| Admin list upgrade requests | `website/src/app/app/admin/page-client.tsx` | `U` | 0 | 0 | Direct client query |
| Admin mark request status | `website/src/app/app/admin/page-client.tsx` | `U` | 1 | 0 | 1 update + full reload query |
| Track document task | `website/src/hooks/use-document-task.ts` | `1 + events` | 0 | 0 | `onSnapshot(documentTasks/{taskId})` |

### 3.2 Phone App

| Operation | File | Reads | Writes | Deletes | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Login profile check | `phone_app/modules/auth/Login.js` | 1 | 0 | 0 | Reads `users/{uid}/data/profile` after sign-in |
| Auth state role load | `phone_app/hooks/index.js` | 1 | 0 | 0 | Reads profile once on auth change |
| Generic doc hook listener | `phone_app/hooks/index.js` | `1 + events` | 0 | 0 | `onSnapshot` on arbitrary doc path |
| Notification token registration (client pre-check) | `phone_app/utils/notifications.js` | 1 | 0 | 0 | Reads profile token before calling `updatePushTokenV1` |
| Support chat init open conversations | `phone_app/modules/support/SupportChat.js` | `R_open` | 0 | 0 | Query open conversations for current user |
| Support chat load one conversation | `phone_app/modules/support/SupportChat.js` | 1 | 0 | 0 | `getDoc(conversation)` |
| Support chat send message | `phone_app/modules/support/SupportChat.js` | 2 | 1 | 0 | Transaction read+write, then refresh read |
| Support chat history load | `phone_app/modules/support/SupportChat.js` | `R_closed + R_open` | 0 | 0 | Two queries |
| Support chat mark unread as read | `phone_app/modules/support/SupportChat.js` | 0 | 1 | 0 | `updateDoc(unreadForUser=0)` |
| Support chat start new conversation | `phone_app/modules/support/SupportChat.js` | 0 | 1 | 0 | `addDoc(conversations)` |
| Dev inbox load open unread | `phone_app/modules/support/DevInbox.js` | `R_open_unread` | 0 | 0 | Query with filters and ordering |
| Dev inbox open conversation | `phone_app/modules/support/DevInbox.js` | 1 | 1 | 0 | Load messages + mark unreadForDev=0 |
| Dev inbox send reply | `phone_app/modules/support/DevInbox.js` | 2 | 1 | 0 | Transaction read+write, then refresh read |
| Dev inbox close conversation | `phone_app/modules/support/DevInbox.js` | 0 | 1 | 0 | `status='closed'` update |
| Team create job worker fallback load | `phone_app/modules/team/CreateJob.js` | `W` | 0 | 0 | Reads workers if cache missing |
| Team worker job sync per pending item | `phone_app/modules/team/Workerjob.js` | 1 | 0 | 0 | Reads current job before calling `updateJobV1` |
| Fill job inventory fallback | `phone_app/modules/shared/FillJob.js` | 1 | 0 | 0 | Reads user inventory if cache empty |
| Edit job pre-check | `phone_app/modules/shared/EditJob.js` | 2 | 0 | 0 | Reads current job + worker inventory before CF calls |
| Workers list fallback | `phone_app/modules/team/WorkersUsers.js` | `W` | 0 | 0 | Query workers if cache missing |
| Workers monitor fallback | `phone_app/modules/team/WorkersMonitor.js` | `W` | 0 | 0 | Query workers if cache missing |
| Workers monitor inventory listener | `phone_app/modules/team/WorkersMonitor.js` | `1 + events` | 0 | 0 | Worker inventory doc listener |
| Worker inventory live listener | `phone_app/modules/inventory/WorkerInventory.js` | `1 + events` | 0 | 0 | `onSnapshot(users/{uid}/data/inventory)` |
| Worker inventory load company parts | `phone_app/modules/inventory/WorkerInventory.js` | 1 | 0 | 0 | Reads company inventory doc |
| Job monitor load worker inventory | `phone_app/modules/team/JobMonitor.js` | 1 | 0 | 0 | Reads user inventory doc |
| Create document screen inventory read | `phone_app/modules/documents/CreateDocument.js` | 1 | 0 | 0 | Reads company inventory for item picker |
| Generate tax invoice screen reads | `phone_app/modules/documents/GenerateTaxInvoice.js` | `1 + J` | 0 | 0 | 1 company inventory read + jobs query fallback |
| Document task listener | `phone_app/hooks/useDocumentTask.js` | `1 + events` | 0 | 0 | `onSnapshot(documentTasks/{taskId})` |

### 3.3 CacheContext (Major Cost Center)

| Operation | File | Reads | Writes | Deletes | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| First login fresh fetch (manager) | `phone_app/contexts/CacheContext.js` | `9 + W + J + D + C` | 0 | 0 | Includes 3 initial listener reads |
| First login fresh fetch (worker) | `phone_app/contexts/CacheContext.js` | `8 + J + C` | 0 | 0 | Includes 3 initial listener reads |
| First login fresh fetch (user solo/business) | `phone_app/contexts/CacheContext.js` | `10 + J + D + C` | 0 | 0 | Includes business-info existence check |
| First login fresh fetch (basic) | `phone_app/contexts/CacheContext.js` | `8 + D + C` | 0 | 0 | Includes 3 initial listener reads |
| User cache listener event | `phone_app/contexts/CacheContext.js` | `1 + optional field fetch reads` | 0 | 0 | Always reads cache doc; may trigger additional reads |
| Company cache listener event | `phone_app/contexts/CacheContext.js` | `1 + optional sync query reads` | 0 | 0 | May fetch jobs/docs/clients/workers collections |
| Company inventory listener event | `phone_app/contexts/CacheContext.js` | `1 + events` | 0 | 0 | Dedicated doc listener |
| Increment user cache version | `phone_app/contexts/CacheContext.js` | 0 | 1 | 0 | `updateDoc(users/{uid}/data/cache)` |
| Month/date-range historical fetch | `phone_app/contexts/CacheContext.js` | `query result size` | 0 | 0 | Variable by range; can hit Firestore and archives |

## 4) End-to-End Action Reference (Typical)

| User Action | Reads | Writes | Deletes | Typical Path |
| --- | ---: | ---: | ---: | --- |
| Register manager business (onboarding submit) | 2 | 13 | 0 | `registerBusinessV1` |
| Register worker via invite | 4 | 5 | 0 | `joinCompanyV1` |
| Create client (manager) | 3 | 3 | 0 | `addClientV1` |
| Update client (manager) | 3 | 2 | 0 | `updateClientV1` |
| Delete client (manager) | 3 | 1 | 1 | `deleteClientV1` |
| Add company inventory part | 3 | 3 | 0 | `updateInventoryV1(action=addPart, scope=company)` |
| Update own user inventory part | 3 | 2 | 0 | `updateInventoryV1(action=updatePart, scope=user)` |
| Manager edits worker inventory (replace) | 7 | 2 | 0 | `updateInventoryV1(action=replaceParts, targetUid!=uid)` |
| Create pending job (manager) | 3 | 3 | 0 | `createJobV1(type=pending)` |
| Create finished job (solo user) | 2 | 3 | 0 | `createJobV1(type=finished)` |
| Update job (manager) | 3 | 2 | 0 | `updateJobV1` |
| Worker submits/updates own job | 4 | 2 | 0 | `updateJobV1` worker path |
| Accept job without parts | 4 | 2 | 0 | `acceptJobV1` |
| Accept job with parts deduction | 5 | 4 | 0 | `acceptJobV1` with inventory mutation |
| Delete job (manager) | 3 | 1 | 1 | `deleteJobV1` |
| Publish preview PDF task | 3 | 3 | 0 | `publishPreviewTask` |
| Publish non-tax document generation | 4 | 4 | 0 | `publishGenerateTask` (non-305) |
| Tax invoice approval (minimum success path) | 4 | 6 | 0 | `getInvoiceApproval` + async PDF task publish |
| Delete document | 3 | 1 | 1 | `deleteDocumentV1` |
| Update profile | 1 to 2 | 1 to 2 | 0 | `updateProfileV1` |
| Save push token (changed token) | 1 | 1 | 0 | `updatePushTokenV1` |
| Logout clear push token | 1 | 0 to 1 | 0 | `clearPushTokenV1` |
| Send support message (existing conversation) | 2 | 1 | 0 | Support chat transaction + refresh read |

## 5) Highest-Impact Read Optimization Targets

1. CacheContext first-login and version-sync paths are the biggest read drivers (`jobs`, `documents`, `clients`, `workers` full pulls). Move more flows to delta-sync by timestamp/index and avoid unnecessary full reloads.
2. Manager cross-user inventory mutations are expensive (`~7 reads` each call). You can reduce by passing trusted preloaded membership/profile data from server-side context or combining checks.
3. Support chat/dev inbox do an extra `getDoc` after each send transaction. Optimistic local append can remove one read per sent message.
4. Web admin status change does `updateDoc` then full `getDocs` reload. Update local table state directly to avoid rereading all upgrade requests each click.
5. Worker onboarding (`joinCompanyV1`) reads invite twice (query + tx). Using a deterministic invite doc ID lookup (or passing invite doc ID) can drop one read.
