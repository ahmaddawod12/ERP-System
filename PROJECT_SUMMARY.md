# Smart-Job ERP project summary

Smart-Job ERP is a multi-tenant field-service platform. The clients never
connect directly to business databases or object storage.

## Runtime packages

| Path | Purpose |
|---|---|
| `website/` | Next.js App Router website with opaque server sessions |
| `phone_app/` | Expo mobile client using native Firebase Authentication |
| `cloudrun-api/` | Versioned business API, authorization, tenant routing |
| `cloudrun-tax/` | Stateless Israel tax gateway foundation |
| `cloudrun-pdf/` | PDF generation worker |
| `cloudrun-email/` | Durable SES delivery worker |
| `cloudrun-archiver/` | Monthly PostgreSQL-to-GCS archive job |
| `cloudrun-backup/` | PostgreSQL and GCS recovery backup verifier |
| `cloudrun-migrations/` | Dedicated migration and smoke image |
| `packages/control-db/` | Company-to-database routing metadata |
| `packages/db/` | Drizzle schema and consolidated PostgreSQL baseline |

## Identity and authorization

Firebase issues the external provider UID and ID token. The API validates the
token with Firebase Admin and deterministically maps the provider UID to an
internal UUID used by existing database foreign keys. The mapping is stable and
does not expose tenant or role authority.

`companyId` remains the public tenant identifier. The API resolves it to an
internal company UUID and database shard before executing tenant SQL.
PostgreSQL functions re-derive membership, role, module, and entity-version
authority inside the transaction.

The website exchanges Firebase password credentials server-side and stores only
an opaque session token in an HttpOnly cookie. The mobile app relies on the
native Firebase SDK and sends short-lived ID tokens to the API.

## Data and files

- The control database stores routing metadata, not tenant business rows.
- Company databases use the same versioned schema and least-privilege roles.
- Development can route all companies to one shard; production can allocate
  dedicated databases without changing client contracts.
- Active files and generated documents use private GCS objects.
- Archive and backup manifests record exact object generations and checksums.

## Local platform

`compose.local.yml` runs PostgreSQL 17, Firebase Auth emulator, GCS emulator,
Mailpit, and all application services on the labeled `smart-job-local` network.
Use `scripts/local-platform.ps1`; do not hand-set its marker flags.

## Verification

CI runs repository guards, package typechecks/tests/builds, the consolidated
baseline against plain PostgreSQL 17, API integration tests, website Playwright
journeys, mobile Maestro flows, Terraform validation, image builds, and
vulnerability scans.
