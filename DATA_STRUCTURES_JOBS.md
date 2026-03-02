# Jobs Module Data Structures

Source of truth: `functions/src/jobs.js`, `functions/src/shared.js`, `firestore.rules`.

## Firestore Documents

| Path | Purpose | Key Fields |
| --- | --- | --- |
| `companies/{companyId}/jobs/{jobId}` | Unified job model | `id`, `jid`, `status`, `createdBy`, `createdAt`, `updatedAt`, assignment fields (`workerId`, `completedBy`), client fields, work output fields, `isCert` |
| `companies/{companyId}/data/cache` | Company job cache versioning | `jobsVersion`, `updatedAt` |
| `users/{workerUid}/data/inventory` | Worker inventory impacted by accept flow | `parts`, `nextId`, `lastUpdated` |
| `users/{workerUid}/data/cache` | Worker inventory cache bump | `inventory`, `lastUpdated` |
| `notificationLog/{logId}` | Deduped push event log | `jobId`, `notificationType`, `workerUserId`, `managerUserId`, `sentAt`, `expireAt`, `messageId` |

## Job Fields (Current Write Contract)

| Group | Fields |
| --- | --- |
| Identity and lifecycle | `id`, `jid`, `status`, `createdBy`, `createdAt`, `updatedAt`, `finishedAt`, `deniedAt`, `deniedBy`, `acceptedAt`, `acceptedBy` |
| Assignment | `workerId`, `completedBy`, `MUser`, `MName`, `assignedTo`, `assignedBy`, `workerName` |
| Client metadata | `clientId`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name` |
| Job content | `title`, `description`, `notes`, `location`, `address`, `category`, `priority`, `dueDate`, `tags`, `images` |
| Field execution data | `parts`, `partsUsed`, `timeFrom`, `timeTo`, `travelDistance`, `signingPerson`, `photos`, `signature` |
| Document linkage | `isCert`, `documentId`, `documentCreatedAt` |
| Control field | `idempotencyKey` |

## API Contracts

| Function | Type | Main Inputs | Main Writes |
| --- | --- | --- | --- |
| `createJobV1` | Callable | `companyId`, `type`, whitelisted job payload, optional `idempotencyKey` | increments `companies/{companyId}.jid`, creates job doc, increments `cache.jobsVersion` |
| `updateJobV1` | Callable | `companyId`, `jobId`, whitelisted update payload | updates job doc and increments `cache.jobsVersion` |
| `acceptJobV1` | Callable | `companyId`, `jobId` | status transition to `finished`, adds `acceptedBy/acceptedAt`, optional worker inventory deduction, cache bumps |
| `deleteJobV1` | Callable | `companyId`, `jobId` | deletes job and increments `cache.jobsVersion` |
| `onJobAssignTrigger` | Firestore trigger | new job create event | sends push to assignee and writes `notificationLog/{jobId}_assigned` |
| `onJobSubmitTrigger` | Firestore trigger | job update event (status to `waiting`) | sends push to manager and writes `notificationLog/{jobId}_submitted` |

## Status Rules

| Rule | Description |
| --- | --- |
| Canonical statuses | `pending`, `waiting`, `finished`, `denied` |
| Worker restriction | Worker cannot set status directly to `finished` or `denied` in `updateJobV1` |
| Finish transition | `finished` transition is enforced through `acceptJobV1` |
| Reverse transition block | Finished jobs cannot move back to `pending`/`waiting` |
