# Jobs Module Data Structures

Source of truth: `functions/src/jobs.js`, `functions/src/shared.js`, `firestore.rules`.

## Firestore Documents

| Path | Purpose | Key Fields |
| --- | --- | --- |
| `companies/{companyId}/jobs/{jobId}` | Unified job model | `status`, `createdAt`, `updatedAt`, assignment fields (`wid`, `wname`, `mid`, `mname`), client fields (`cid`, `cname`, `cphone`), work output fields, `isCert` |
| `companies/{companyId}/counters/jnext` | Job ID counter | `next` |
| `companies/{companyId}/data/cache` | Company job cache versioning | `jobsVersion`, `updatedAt` |
| `users/{workerUid}/data/inventory` | Worker inventory impacted by accept flow | `parts`, `nextId`, `lastUpdated` |
| `users/{workerUid}/data/cache` | Worker inventory cache bump | `inventory`, `lastUpdated` |
| `notificationLog/{logId}` | Deduped push event log | `jobId`, `notificationType`, `workerUserId`, `managerUserId`, `sentAt`, `expireAt`, `messageId` |

## Job Fields (Current Write Contract)

| Group | Fields |
| --- | --- |
| Lifecycle | `status`, `createdAt`, `updatedAt`, `finishedAt`, `deniedAt`, `deniedBy`, `acceptedAt`, `acceptedBy` |
| Worker assignment | `wid` (worker sequential ID), `wname` (worker display name) |
| Manager assignment | `mid` (manager sequential ID), `mname` (manager display name) |
| Client metadata | `cid` (client sequential ID), `cname` (client name), `cphone` (client phone) |
| Job content | `title`, `description`, `notes`, `location`, `address`, `category`, `priority`, `dueDate`, `tags`, `images` |
| Field execution data | `parts`, `partsUsed`, `timeFrom`, `timeTo`, `travelDistance`, `signingPerson`, `photos`, `signature` |
| Document linkage | `isCert`, `documentId`, `documentCreatedAt` |
| Control field | `idempotencyKey` |

## API Contracts

| Function | Type | Main Inputs | Main Writes |
| --- | --- | --- | --- |
| `createJobV1` | Callable | `companyId`, `type`, whitelisted job payload, optional `idempotencyKey` | increments `companies/{companyId}/counters/jnext`, creates job doc, increments `cache.jobsVersion` |
| `updateJobV1` | Callable | `companyId`, `jobId`, whitelisted update payload | updates job doc and increments `cache.jobsVersion` |
| `acceptJobV1` | Callable | `companyId`, `jobId` | status transition to `finished`, adds `acceptedBy/acceptedAt`, optional worker inventory deduction, cache bumps |
| `deleteJobV1` | Callable | `companyId`, `jobId` | deletes job and increments `cache.jobsVersion` |
| `onJobAssignTrigger` | Firestore trigger | new job create event | sends push to assignee (looks up uid from `workers/{wid}`) and writes `notificationLog/{jobId}_assigned` |
| `onJobSubmitTrigger` | Firestore trigger | job update event (status to `waiting`) | sends push to manager (looks up uid from `managers/{mid}`) and writes `notificationLog/{jobId}_submitted` |

## Status Rules

| Rule | Description |
| --- | --- |
| Canonical statuses | `pending`, `waiting`, `finished`, `denied` |
| Worker restriction | Worker cannot set status directly to `finished` or `denied` in `updateJobV1` |
| Finish transition | `finished` transition is enforced through `acceptJobV1` |
| Reverse transition block | Finished jobs cannot move back to `pending`/`waiting` |

## Removed Fields (Migration)

These fields existed in the old schema and are **no longer written**:
`id`, `jid`, `createdBy`, `completedBy`, `MUser`, `MName`, `assignedTo`, `assignedBy`, `workerId`, `workerName`, `clientId`, `clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `name`
