# `@smart-job/api-contracts`

Runtime-validated HTTP contracts shared by Smart-Job ERP's API, tax service,
website, and mobile app. Canonical business values still come from
`@smart-job/contracts`; this package adds Zod schemas for API boundaries.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
```

Build `../contracts` first when consuming this package from another project.
Import schemas and inferred types from the package root:

```ts
import {
  ViewerSchema,
  createApiResponseSchema,
  type ApiResponse,
  type Viewer,
} from "@smart-job/api-contracts";
```

`JobListQuerySchema`, `JobSummarySchema`, and `JobListPageSchema` define the
bounded jobs-read surface. Job pages default to 50 rows and cap both `limit`
and `pageSize` at 200; clients must treat `afterCursor` and `entityVersion` as
opaque values.

`JobUpdateRequestSchema`, `JobAcceptRequestSchema`, and
`JobDeleteRequestSchema` define the remaining versioned job mutations. Update
payloads contain only bounded metadata plus public client/assignee references
and canonical non-finished statuses; legacy identity fields and direct
`finished` transitions are rejected. Update/accept return `JobSummary`, while
delete returns the canonical job UUID/number and an explicit `deleted: true`.

`ClientListQuerySchema`, `ClientSummarySchema`, and `ClientListPageSchema`
define the canonical clients-read surface. Client pages default to 50 rows,
cap `pageSize` at 200, default to active rows, accept `active`, `archived`, or
`all` SQL status filters, execute optional prefix search in SQL, and expose
only an opaque `(createdAt, id)` continuation cursor. Every client DTO carries
an opaque entity version. `ClientCreateRequestSchema`,
`ClientUpdateRequestSchema`, `ClientDeleteRequestSchema`, and
`ClientDeleteResultSchema` define normalized, idempotent mutation payloads and
the explicit `deleted`/`archived` removal disposition.

`WorkerListQuerySchema`, `WorkerSummarySchema`, and `WorkerListPageSchema`
define the manager/dev-only team directory. Pages default to 50 rows, cap
`pageSize` at 200, support SQL-backed search plus canonical role/status filters,
and expose an opaque `(createdAt, id)` continuation cursor. Worker DTOs expose
public member numbers and contact fields, but never internal membership or
authenticated-user identifiers.

`InventoryListQuerySchema`, `InventoryPartSummarySchema`, and
`InventoryListPageSchema` define company and authenticated-member inventory
reads. Pages default to 50 rows, cap `pageSize` at 200, accept SQL-backed
`active`, `inactive`, and `archived` status filters, and expose an opaque
`(createdAt, id)` continuation cursor. Omitting `status` preserves the legacy
non-archived inventory view.

Inventory mutation schemas define versioned part create/update/archive,
signed company or self-member stock adjustment, a single manager transfer, and
a manager batch pick capped at 100 unique parts. Part metadata uses
`entityVersion`; each location balance uses `stockEntityVersion`. Targets use
public `memberNo`, and no contract exposes internal tenant/location IDs or a
target user ID.

`PushTokenUpsertRequestSchema`, `PushTokenUpsertResultSchema`, and
`PushTokenClearResultSchema` define the authenticated viewer notification-token
mutations. The request accepts only `ios` or `android`; result schemas
intentionally cannot contain the write-only token value.

`InvitationCreateRequestSchema` and `InvitationRedeemRequestSchema` define the
idempotent invitation boundary. Creation accepts only canonical non-dev target
roles. Redemption requires both the public `companyId` and opaque
`inviteCode`; it deliberately rejects caller-supplied user IDs, emails, roles,
and internal tenant UUIDs. Successful redemption returns the SQL-owned
workspace and membership through `InvitationRedemptionResultSchema`.

Migration-only `LEGACY_*` exports live under the dedicated
`@smart-job/api-contracts/legacy-edge-characterization` subpath so website and
mobile bundles importing ordinary API schemas do not include the fixture
catalog. The fixtures freeze the current Edge gateway/read/function surface and include accepted
representative handler payloads, SQL-side read filters/cursors, direct endpoint
bodies, and explicit notes for known client/handler mismatches. An empty payload
is permitted only for `clearPushTokenV1`, whose handler intentionally ignores it;
`userSyncState` is the only kind whose request contains no input beyond `kind`.
These are not new API route contracts and should be removed after the resource
API cutover is verified.
