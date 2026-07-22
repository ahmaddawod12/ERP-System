# Smart-Job ERP

Smart-Job is a multi-tenant field-service platform for solo operators and
business teams. This repository contains independent Node 22 packages; there is
no root npm workspace.

## Architecture snapshot (July 22, 2026)

- Supabase Auth owns user identity. PostgreSQL is the source of truth for ERP
  data, tenant membership, durable workflow state, and opaque website sessions.
- `cloudrun-api` is the sole business-data trust boundary for the Next.js
  website and Expo app. All Supabase Edge functions and handlers have been
  removed.
- The website uses server-only Cloud API calls and an opaque HttpOnly session.
  The mobile app uses Supabase bearer tokens held in SecureStore. Neither client
  writes business data directly to Supabase or Firebase.
- Private Supabase Storage owns active job files and generated documents. GCS
  owns immutable monthly archive segments.
- Pub/Sub dispatches opaque IDs to the PDF and email workers. The tax gateway is
  stateless and production submission remains disabled until certification.
- Firebase Messaging and Crashlytics remain for mobile push and crash reporting;
  Firebase Auth, Functions, Firestore, Storage, and App Check are not ERP paths.

## Packages

| Path | Purpose |
|---|---|
| `website/` | Next.js 16 server-rendered website and same-origin BFF |
| `phone_app/` | Expo 57 / React Native 0.86 mobile client |
| `cloudrun-api/` | Main Fastify API and internal outbox drains |
| `cloudrun-tax/` | Stateless Israel tax-authority gateway |
| `cloudrun-pdf/` | Leased PDF preview/generation worker |
| `cloudrun-email/` | Durable SES document-email worker |
| `cloudrun-archiver/` | Leased monthly archive Cloud Run Job |
| `packages/contracts/` | Shared canonical enums and constants |
| `packages/api-contracts/` | Shared Zod HTTP contracts |
| `packages/db/` | Drizzle schema, migrations, SQL access, and profiling |

## Local platform

Start Docker Desktop, then use the repository lifecycle script from PowerShell:

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
```

This starts the isolated `smart-job-erp-local` Supabase stack plus the website,
API, disabled tax gateway, PDF/email workers, durable local dispatch adapter,
fake GCS, and Mailpit. Generated credentials stay in ignored
`local-platform/.env.generated`.

The website is at `http://127.0.0.1:3000`, API at
`http://127.0.0.1:58081`, Studio at `http://127.0.0.1:55323`, and Mailpit at
`http://127.0.0.1:58025`. See [`SETUP.md`](./SETUP.md) for reset semantics,
ports, per-package installation, and native mobile setup.

## Build order

Build local packages before consumers:

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
```

Install each remaining package independently with `npm --prefix <path> install`.
Apply Drizzle migrations before starting API or worker processes.

## Verification and release integrity

CI runs every package test/typecheck/build, website lint/build, Expo Doctor,
database migration/integration tests, Supabase lint, Playwright, Maestro Cloud,
CodeQL, secret scanning, the npm audit policy, Terraform checks when roots are
present, SBOM generation, and blocking container scans.

Repository guards:

```bash
node scripts/check-no-ts-nocheck.mjs
node scripts/check-js-syntax.mjs .
node scripts/check-local-platform.mjs
node scripts/check-perf-budget.mjs
node scripts/check-maestro-flows.mjs
node scripts/check-supply-chain-pins.mjs
node scripts/check-npm-audit.mjs
```

GitHub Actions and container bases are pinned by immutable digest. The Cloud Run
deployment workflow builds, pushes, resolves, keyless-signs, and deploys image
digests rather than mutable tags. Active dependency exceptions are exact,
owner-assigned, and expire within 30 days; see
[`security/NPM_AUDIT_EXCEPTIONS.md`](./security/NPM_AUDIT_EXCEPTIONS.md).

## Non-negotiable data rules

- `uid` is canonical identity; numeric `companyId` is tenant scope and must be
  resolved to the internal UUID inside the API transaction.
- Sequential company/member/client/job/document/part identifiers use SQL
  counters, never `MAX + 1`.
- Job status is one of `pending`, `waiting`, `finished`, or `denied`.
- All authenticated API SQL work begins with
  `private.set_api_request_context(...)` and uses least-privileged runtime roles.
- Idempotency, opaque entity versions, create-only files, composite cursors, and
  atomic inventory/job/document workflows must remain intact.
- Ambiguous SES outcomes become `delivery_unknown`; ambiguous tax submissions
  become `submission_unknown`. Neither is retried blindly.

## Documentation

- [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md) — concise current implementation
- [`SETUP.md`](./SETUP.md) — installation, environments, local topology, deploy order
- [`architecture.md`](./architecture.md) — system/data ownership and request flows
- [`backend.md`](./backend.md) — API, worker, SQL, and security boundaries
- [`docs/runbooks/README.md`](./docs/runbooks/README.md) — deployment and incident procedures
- [`website/README.md`](./website/README.md) and
  [`phone_app/README.md`](./phone_app/README.md) — client-specific rules
