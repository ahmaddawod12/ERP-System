# Smart-Job Cloud Run API

Node 22/Fastify service for the versioned Smart-Job ERP API. In addition to
the common HTTP foundation, it now includes the least-privileged Postgres
runtime adapter, Supabase JWKS verification, opaque website sessions, and the
workspace/viewer/bootstrap/client/inventory/worker/job/document routes,
durable PDF/email dispatch, and authoritative tax creation/submission. It
remains a staged migration service and does not receive production traffic yet;
tax submission is disabled for the initial platform launch.

## Build prerequisites

Packages are installed independently; there is no root npm workspace. Build the local dependencies first:

```bash
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run build
npm --prefix packages/db run build
npm --prefix cloudrun-api install
```

## Commands

```bash
npm --prefix cloudrun-api run typecheck
npm --prefix cloudrun-api run build
npm --prefix cloudrun-api run test
npm --prefix cloudrun-api start
```

## Configuration

| Variable | Default | Validation |
|---|---:|---|
| `HOST` | `0.0.0.0` | Non-empty host string |
| `PORT` | `8080` | Integer from 1 through 65535 |
| `LOG_LEVEL` | `info` | `silent`, `fatal`, `error`, `warn`, `info`, `debug`, or `trace` |
| `REQUEST_TIMEOUT_MS` | `12000` | Positive integer capped at 12 seconds; applies to request receipt and handler execution |
| `DATABASE_URL` | required | Must authenticate as `smart_job_api`; the password is provisioned out of band |
| `DATABASE_SSL_MODE` | `require` | `disable` is accepted only for a loopback database |
| `DATABASE_MAX_CONNECTIONS` | `5` | Positive integer capped at five |
| `SUPABASE_URL` | required | HTTPS, except for local loopback development |
| `SUPABASE_PUBLISHABLE_KEY` | required | Current `sb_publishable_...` server-side Auth key |
| `SUPABASE_SECRET_KEY` | required | Current `sb_secret_...`; trusted Storage administration only |
| `SUPABASE_STORAGE_BUCKET` | `smart-job-company-files` | Exact canonical private bucket |
| `SUPABASE_JWT_ISSUER` | `${SUPABASE_URL}/auth/v1` | Exact Supabase Auth issuer |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | One to five comma-separated exact audiences |
| `WEB_SESSION_ENCRYPTION_KEY_BASE64` | required | Canonical base64 for exactly 32 random bytes |
| `WEB_SESSION_ENCRYPTION_KEY_VERSION` | required | Non-secret key-version label |
| `DOCUMENT_PUBSUB_PROJECT_ID` | production required | Pub/Sub project used by document/email topics |
| `DOCUMENT_PREVIEW_TOPIC` | production required | Opaque preview task topic |
| `DOCUMENT_GENERATE_TOPIC` | production required | Opaque generate task topic |
| `EMAIL_DELIVERY_TOPIC` | production required | Opaque email delivery topic |
| `INTERNAL_API_AUDIENCE` | paired | Exact API service origin for Google identity verification |
| `INTERNAL_CALLER_SERVICE_ACCOUNTS` | paired | One to ten allowed Google service accounts |
| `TAX_SUBMISSION_MODE` | `disabled` | `disabled`, `sandbox`, or `production`; launch stays disabled |
| `TAX_GATEWAY_URL` | enabled tax required | Exact tax service origin; API adds the approval path |
| `TAX_GATEWAY_AUDIENCE` | enabled tax required | Exact tax Cloud Run audience |
| `TAX_GATEWAY_TIMEOUT_MS` | `8000` | 1–10 second outbound deadline |

Configuration is validated before the server starts. Invalid values fail closed.

## HTTP foundation

- `GET /healthz` is the process liveness check.
- `GET /readyz` runs the injected dependency-readiness check.
- Domain routes accept exactly one strict credential: Supabase
  `Authorization: Bearer <JWT>` for mobile or
  `Authorization: SmartJobSession <opaque-token>` for the website. Combined,
  duplicate, and comma-joined credentials are rejected.
- Opaque-session lookup refreshes and verifies rotating Supabase credentials
  under a row lock, then returns only the user ID and absolute session expiry
  to domain authorization. `/api/v1/me` additionally performs the authoritative
  Auth-user lookup needed for email/verification state. Supabase access/refresh
  tokens never leave the web-session service.
- `GET /api/v1/me`, `GET /api/v1/workspaces`, and
  `GET /api/v1/companies/{companyId}/bootstrap` are implemented.
- `POST /api/v1/auth/business-registration` creates only the authenticated
  user's first workspace. It requires verified email plus a global
  idempotency key; migration `0010_hardened_api_business_registration` derives
  the Auth subject, public company counter, owner role, tier, and modules in
  one transaction and serializes concurrent attempts by user.
- `POST /api/v1/me/push-token` registers an `ios` or `android` device token,
  and `DELETE /api/v1/me/push-token` clears it idempotently. Both mutations
  require a verified identity and call the self-scoped private RPCs from
  migration `0011_api_push_tokens`; token values are write-only and are never
  returned or included in structured logs.
- `POST /api/v1/companies/{companyId}/invitations` creates a manager-owned,
  team-entitled invitation. `POST /api/v1/auth/invitations/redeem` binds the
  public company ID and code to the verified Supabase Auth subject. Both
  require `Idempotency-Key`. Migration `0012_hardened_api_invitations` keeps
  role and tenant authority in SQL, locks the exact invite during atomic
  consumption, permits memberships in other workspaces, and makes a
  same-user retry deterministic without accepting identity fields from the
  request. A private, context-derived SQL limiter preserves the fail-closed
  limit of 10 create or redeem attempts per user per minute without exposing
  the legacy generic rate-limit RPC.
- `GET /api/v1/companies/{companyId}/jobs` applies role, entitlement, status,
  creation-date, creator, and text filters in Postgres. It returns at most 200
  safe DTOs with opaque entity versions and descending `(createdAt, id)`
  cursors; workers and business-account users see only assigned jobs, while
  basic users receive an empty page.
- `GET /api/v1/companies/{companyId}/clients` preserves the legacy
  case-insensitive name/email/city and phone/VAT-prefix search behavior while replacing
  its `(clientNo, id)` cursor with an opaque descending `(createdAt, id)`
  keyset. It defaults to active clients and 50 rows, caps `pageSize` at 200,
  accepts explicit `active`, `archived`, or `all` status filters, and remains
  available to every active workspace role when the clients module is enabled.
  Client DTOs include an opaque entity version.
- `POST /api/v1/companies/{companyId}/clients`, `PATCH
  /api/v1/companies/{companyId}/clients/{clientId}`, and `DELETE` on that
  resource require verified identity plus `Idempotency-Key`. Migration
  `0018_api_client_mutations` derives module, tenant, tier, and role authority
  in SQL, permits manager/user/basic maintenance while denying workers,
  allocates `client_no` through the locked company counter, rejects stale
  entity versions, and bumps `clients_version` atomically. DELETE hard-deletes
  only an unreferenced client; a client referenced by a job or document is
  archived and the response explicitly reports the disposition.
- `GET /api/v1/companies/{companyId}/workers` is a manager/dev-only Team
  directory. It requires an active subscription and Team entitlement for
  managers, keeps tenant, role, status, prefix search, and keyset pagination in
  Postgres, defaults to 50 rows, and caps `pageSize` at 200. Results include
  only worker/user/basic memberships, expose public member numbers rather than
  internal membership UUIDs, and use an opaque descending `(createdAt, id)`
  cursor. Contact email remains nullable because the API does not broaden the
  existing `app_users` RLS policy to expose Auth profiles.
- `PATCH` and `DELETE /api/v1/companies/{companyId}/workers/{memberNo}`
  require verified identity, `Idempotency-Key`, and an opaque entity version.
  Migration `0020_api_worker_mutations` derives manager/dev and Team-module
  authority in SQL. DELETE disables the membership instead of erasing
  history, and is rejected until active jobs are reassigned/finished and the
  member's remaining inventory is transferred.
- `GET /api/v1/companies/{companyId}/inventory` returns the company location
  only to managers, business users, and dev users.
  `GET /api/v1/companies/{companyId}/inventory/me` binds the location to the
  authenticated user's own active membership and permits managers, users, and
  workers while denying basic users. Neither route accepts a target user ID.
  Both routes require the inventory entitlement, preserve the legacy
  non-archived default, support SQL-backed name/part-number search and
  `active`/`inactive`/`archived` filters, cap pages at 200, and use opaque
  descending `(createdAt, id)` cursors with one lookahead row.
- Inventory DTOs carry separate opaque `entityVersion` (part metadata) and
  `stockEntityVersion` (selected location balance). Verified, idempotent
  mutations cover part create/update/zero-company/member-stock archive, company and
  `/inventory/me` adjustments, manager transfers, and manager batch picks.
  Migration `0019_api_inventory_mutations` keeps writes behind narrow RPCs,
  caps picks at 100 unique parts, locks balances deterministically, rejects
  underflow/stale versions, and commits movements with the inventory sync bump.
- `POST /api/v1/companies/{companyId}/jobs/{jobId}/complete` uses the atomic,
  version-checked SQL function and idempotency state. Finished-job creation and
  assigned completion can consume verified private Supabase Storage upload
  sessions in the same database transaction as attachment finalization.
- `PATCH /api/v1/companies/{companyId}/jobs/{jobId}`, `POST` on
  `.../{jobId}/accept`, and `DELETE` on the job resource require verified
  identity, `Idempotency-Key`, and an opaque entity version. Migration
  `0021_api_job_mutations` derives tenant, jobs-module, role, and assignment
  authority in SQL. PATCH accepts only bounded metadata, client, assignee, and
  non-finished status fields; direct completion remains a dedicated operation.
  Acceptance is manager/dev-only from `pending` or `waiting`. Deletion refuses
  certificates and jobs referenced by documents, inventory movements, upload
  sessions, or private attachments so it cannot orphan protected history or
  Storage objects. Acceptance consumes recorded part usages through
  `apply_job_inventory_consumption_batch(...)` before status finalization and
  rolls back completely on insufficient stock.
- `POST /api/v1/uploads/job-attachments/sessions` requires `Idempotency-Key`.
  Migration `0016_upload_session_idempotency_limits` binds the claim UUID to
  one canonical pending session, limits each user to 12 new sessions per fixed
  ten-minute window and four active sessions per workspace, and moves an
  unissued session to bounded cleanup after three signing failures. Signed
  URLs are never stored in idempotency state: a successful retry revalidates
  the pending session and requests a fresh URL from Storage, while sessions
  inside the final one-minute expiry window are not returned.
- Document preview/generation publishes only `{ taskId }`. The PDF worker
  claims tenant/user/document/request state through dedicated private RPCs and
  final completion atomically stores canonical document state plus an email
  delivery row when the validated document recipient exists.
- `GET /api/v1/companies/{companyId}/documents/{documentId}` returns the
  authoritative tax submission and email delivery states. Authorized
  `POST .../documents/{documentId}/email-retry` requeues only `failed` or
  `delivery_unknown` delivery and is idempotent.
- `POST /api/v1/companies/{companyId}/tax-invoices` accepts strict
  `DocumentDataInput` plus `Idempotency-Key`; type `305` is server-owned. One
  SQL transaction allocates the counter and writes document, items,
  reservation, and tax outbox. The route fails closed while tax mode is
  disabled.
- Google-identity-protected document/email/tax drain routes claim bounded
  outbox work. Tax gateway pre-send failures may defer; any ambiguous outbound
  result becomes `submission_unknown`. Only confirmed `approved` results with
  a confirmation number enqueue a final tax PDF.
- `/api/v1/auth/web-sessions` creates a verified-email-only 12-hour session;
  its `DELETE /current` mutation still requires `X-SJ-CSRF`.
- Valid incoming `x-request-id` values are preserved; missing or unsafe values are replaced with UUIDs. Every response echoes the selected ID.
- Every `/api/v1` response receives `Cache-Control: private, no-store`, including errors and unknown routes.
- Responses use `ApiResponse<T>` from `@smart-job/api-contracts`.
- Authorization/cookie headers and request bodies are excluded from structured
  logs; logged paths never include query strings.
- Malformed JSON, oversized bodies, and unsupported media types remain
  non-retryable 4xx responses. Handler deadline failures are retryable 504s.
- Forwarded client IPs are not trusted by default. Configure only Cloud Run's
  known proxy hops before using `request.ip` for rate limits or audit evidence.

When runtime services are configured, readiness checks Postgres. Every
authenticated transaction establishes `private.set_api_request_context(...)`
with bounded statement, lock, and idle-transaction timeouts; the HTTP deadline
alone cannot cancel a query already sent to Postgres.

Migration `0018` supplies the default client-list
`(company_id, status, created_at DESC, id DESC)` index plus narrow client
reference indexes for jobs and documents. The baseline schema does not yet
have dedicated created-at cursor indexes for memberships or inventory parts.
The bounded keyset queries are correct without them; add indexes only after
`packages/db/perf/profiling.sql` and representative staging row counts show
that they are warranted.
