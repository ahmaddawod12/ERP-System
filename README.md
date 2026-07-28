# Smart-Job ERP

Multi-tenant field-service ERP with a Next.js website, Expo mobile app, Fastify
Cloud Run services, PostgreSQL, Firebase Authentication, and Google Cloud
Storage.

## Architecture

- Firebase Authentication owns external user sign-in and ID tokens.
- `cloudrun-api` is the only client-facing business-data boundary.
- PostgreSQL is the ERP source of truth. Tenant routing supports a control
  database plus company database shards without exposing database credentials
  to clients.
- Website sessions are opaque, HttpOnly, PostgreSQL-backed sessions. Firebase
  credentials remain server-side.
- The mobile app sends Firebase ID tokens to the API.
- Active attachments and generated PDFs use the private
  `smart-job-company-files` GCS bucket.
- Archive and backup jobs use PostgreSQL and GCS directly.

See [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) and
[docs/architecture/database-per-company.md](./docs/architecture/database-per-company.md).

## Local platform

Install Node 22 and Docker Desktop, then run:

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
```

The repository-owned Compose platform starts PostgreSQL 17, the Firebase Auth
emulator, a GCS emulator, Mailpit, the API, workers, and the website. Generated
local credentials are stored only in ignored `local-platform/.env.generated`.

Reset only this repository's local data:

```powershell
.\scripts\local-platform.ps1 reset -Yes
```

## Package commands

There is no root npm workspace. Install, build, and test packages independently:

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix cloudrun-api install
npm --prefix cloudrun-api run test
npm --prefix website install
npm --prefix website run test
npm --prefix phone_app install
npm --prefix phone_app run test
```

See [SETUP.md](./SETUP.md) for environment and validation details.
