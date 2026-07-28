# Smart-Job ERP architecture

## Trust boundaries

```text
Next.js website --opaque session--\
                                  cloudrun-api --> control PostgreSQL
Expo mobile ----Firebase ID token-/      |
                                        +--> company PostgreSQL shard
                                        +--> private GCS company files
                                        +--> Pub/Sub workers
```

Firebase Authentication owns sign-in only. It does not own ERP data,
membership, roles, or tenant routing. The API validates Firebase ID tokens,
maps provider UIDs to stable internal UUIDs, and resolves every public company
ID through the control database.

## Database topology

The control plane stores company-to-shard assignments and provisioning state.
Each data plane database uses the same Drizzle schema and migration version.
Development may route multiple companies to one local shard; larger customers
can move to dedicated databases without changing website or mobile contracts.

Every database transaction sets a request-local internal user ID, applies
bounded statement/lock/idle timeouts, and calls narrow private SQL functions.
Roles, modules, assignment scope, and optimistic entity versions are rechecked
inside SQL.

See [docs/architecture/database-per-company.md](./docs/architecture/database-per-company.md).

## Website

Password sign-in and account actions call Firebase Identity Toolkit only from
server routes. A successful login creates an opaque PostgreSQL-backed session.
The browser receives an HttpOnly session cookie and readable CSRF cookie, never
Firebase ID or refresh tokens.

Protected pages are Server Components. Browser mutations use same-origin BFF
handlers with exact Origin validation, double-submit CSRF, stable idempotency
keys, and current entity versions.

## Mobile

The Expo app uses the native Firebase Auth SDK. API calls obtain a current ID
token and verify the UID is unchanged before and after token refresh. Offline
job writes use per-user SQLCipher outboxes and retry-stable idempotency keys.

## Files and asynchronous work

The private `smart-job-company-files` GCS bucket stores attachments and
generated PDFs. Upload sessions allocate canonical object paths and V4 signed
create-only URLs. Before committing job data, the API verifies object metadata,
content type, size, magic bytes, and SHA-256.

Pub/Sub carries opaque task IDs to PDF and email workers. Monthly archives and
recovery backups use PostgreSQL plus versioned GCS objects with exact generation
and checksum manifests.

## Local platform

Docker Compose runs PostgreSQL 17, Firebase Auth emulator, GCS emulator,
Mailpit, API services, and the website on the repository-owned
`smart-job-local` network. `scripts/local-platform.ps1` is the supported
lifecycle entry point.
