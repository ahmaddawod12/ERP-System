# Smart-Job backend

`cloudrun-api` is the sole client-facing business API. It runs on Node 22 with
Fastify, shared Zod HTTP contracts, a least-privilege PostgreSQL role, Firebase
Admin token verification, opaque website sessions, GCS file signing, and
bounded Pub/Sub dispatch.

## Authentication

- Mobile sends `Authorization: Bearer <Firebase ID token>`.
- Website sends `Authorization: SmartJobSession <opaque token>` from its
  server-only BFF.
- Firebase provider UIDs map deterministically to internal UUIDs.
- Email verification and disabled-user state are checked through Firebase
  Admin for sensitive mutations and website sessions.
- PostgreSQL remains authoritative for tenant membership and roles.

## Database access

The API chooses a company database through the control database router. Runtime
connections authenticate with `smart_job_api`, use small bounded pools, and set
transaction-local user identity plus statement, lock, and idle-transaction
timeouts before tenant SQL.

The consolidated baseline creates narrow private functions for workspace,
client, inventory, job, document, invitation, profile, support, archive, and
tax workflows. The runtime role has no direct write access to ERP tables.

## Storage

Active company files use the private GCS bucket configured by
`COMPANY_FILES_BUCKET`. The API issues create-only signed upload URLs and
short-lived download URLs. It verifies upload bytes before the database
transaction consumes an upload session.

The PDF and email services use Application Default Credentials and dedicated
service accounts. The archiver deletes abandoned upload objects only after
claiming a bounded PostgreSQL cleanup lease.

## Background services

- `cloudrun-pdf`: leases preview/generation tasks and creates PDFs.
- `cloudrun-email`: leases durable email deliveries and sends through SES.
- `cloudrun-archiver`: writes immutable archive segments to GCS and deletes
  source rows in resumable batches.
- `cloudrun-backup`: exports PostgreSQL and inventories exact GCS generations,
  then verifies isolated restores.
- `cloudrun-tax`: protects authority callbacks and submission correlation.

## Local development

Use `scripts/local-platform.ps1`. It starts plain PostgreSQL 17, Firebase Auth
emulator, GCS emulator, Mailpit, and the application containers. Migrations are
always sourced from `packages/db/migrations`.
