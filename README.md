# Smart-Job ERP Monorepo

Smart-Job ERP is a multi-tenant field-service platform for solo operators and business teams.

## Runtime Snapshot (April 26, 2026)

- Supabase Auth is the active sign-in provider for website and mobile.
- `supabase/functions/` is the in-repo backend trust boundary.
- PostgreSQL (via `packages/db`) is the primary source of truth for company-scoped ERP data.
- Firestore and Cloud Storage remain for compatibility reads, operational metadata, and files.
- Cloud Run services still handle PDF generation and monthly archives.

## Repository Layout

```text
ERP-System/
|-- website/             Next.js website
|-- phone_app/           Expo mobile app
|-- supabase/            Backend gateways and migration handlers
|-- cloudrun-pdf/        PDF preview/generation service
|-- cloudrun-archiver/   Monthly archive service
|-- packages/contracts/  Shared contracts and constants
|-- packages/db/         SQL schema, migrations, and access layer
|-- SETUP.md             Setup and deployment guide
|-- architecture.md      System and data ownership map
|-- backend.md           Backend boundaries and responsibilities
`-- SUPABASE-MIGRATION-GUIDE.md
```

## Canonical Documentation

- `SETUP.md`: environment setup, deployment order, release prerequisites
- `architecture.md`: architecture and data ownership
- `backend.md`: backend runtime boundaries and invariants
- `SUPABASE-MIGRATION-GUIDE.md`: migration strategy and rollout controls
- `supabase/README.md`: working guide for `supabase/functions/` and `supabase/handlers/`
- `website/README.md`: web app responsibilities and API proxy model
- `phone_app/README.md`: mobile app architecture and operational rules

## Quick Start

Install dependencies per package:

```bash
npm --prefix packages/contracts install
npm --prefix packages/db install
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-archiver install
```

Common checks:

```bash
npm --prefix website run typecheck
npm --prefix phone_app run typecheck
npm --prefix website run test
npm --prefix phone_app run test
```

## Core Rules

- `uid` is canonical user identity.
- `companyId` is canonical tenant scope.
- Sequential IDs are allocated through SQL-backed counters, not `MAX + 1` reads.
- Protected company writes stay backend-only.
- Persist canonical `storagePath` for generated files, not durable download URLs.
- Valid job statuses are `pending`, `waiting`, `finished`, and `denied`.
- Keep `read-model` `kind` contracts synchronized across website, mobile, and backend handlers.

## Recent Hardening (April 26, 2026)

- Supabase mutation handlers now normalize incoming `companyId` to internal company UUID before SQL queries.
- Tax invoice numbering and company inventory part numbering are allocated through SQL-backed counters.
- Read-model cursor pagination for jobs/documents uses a stable composite cursor (`createdAt`, `id`) to avoid duplicate/skip edge cases.
- Website protected-route session validation now uses a short-lived in-memory revocation-check cache to reduce per-request overhead.
- Website auth transport no longer persists Supabase refresh tokens in `localStorage`.
- Supabase Edge CORS handling now fails closed when request origins are not explicitly allowlisted.
- Invite redemption now consumes invite state atomically before membership finalization to avoid multi-join races.
- Document task URLs are now split by task type: `preview_url` for preview and `generate_url` for generated PDFs.
- `updateBusinessInfoV1` now rejects `vat_number` mutations after onboarding.
- `fetchArchiveMonthV1` is fail-explicit (`unavailable`) until Supabase Edge archive retrieval is fully implemented.
