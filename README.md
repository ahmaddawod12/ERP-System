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

## Recent Hardening (April 26–27, 2026)

### Backend / SQL (migration `0010_fixes.sql`)
- Supabase mutation handlers normalize incoming `companyId` to internal company UUID before SQL queries.
- SQL counter RPCs (`allocate_company_counter`, `allocate_system_counter`) cover all sequential IDs: `public_company_id`, `member_no`, `client_no`, `job_no`, tax invoice numbers (`doc_305`), and inventory part numbers (`part_no`).
- SQL rate-limit RPC (`increment_rate_limit_bucket`) replaces Firestore-backed rate limiting; join-company flow now enforces a per-user limit.
- `document_number` immutability trigger blocks updates once a non-zero number is assigned (allows 0 → real, blocks real → different real).
- `document_tasks` RLS policy fixed to reference the correct column (`user_id`).
- `support_conversations` RLS policy fixed to allow access for records with no company scope.
- `contact_requests` now stores a dedicated `subject VARCHAR(500)` column.
- `upgrade_requests.company_id` migrated from `VARCHAR(32)` to `UUID`; handlers store the internal company UUID.
- `document_tasks` unique index changed from `(company_id, task_type, document_type)` to `(company_id, task_type, document_id)` to allow two concurrent tasks of the same doc type.

### Supabase Edge Functions
- Read-model cursor pagination for jobs/documents uses composite cursor `(created_at, id)` via PostgREST `.or()` — no in-memory filtering.
- `userSyncState` kind now returns `app_users.updated_at` instead of hardcoded zeros.
- Inventory part listing attaches the next sequential part ID from the SQL counter.
- Invite redemption consumes invite state atomically before membership finalization (prevents multi-join races).
- `contact/request` passes `subject` as a dedicated field; `company` defaults to `"General"` when absent.
- Double-fault catch in all three gateways (`mutation-gateway`, `mutation-gateway-me-west1`, `read-model`) now resolves with a safe CORS-aware error response instead of an unhandled rejection.

### Website
- Auth transport no longer persists Supabase access token or refresh token in `localStorage`; access token and expiry are kept in-memory and only non-sensitive user info (`uid`, `email`) is written to `sessionStorage`.
- `UserProfile.wid` / `mid` type narrowed from `string | number` to `number | null` to match SQL-allocated integer membership IDs.
- `generateCompanySlug` now uses `crypto.getRandomValues` instead of `Math.random()` for the randomized suffix.
- Document task URLs split by task type: `preview_url` → `previewURL`, `generate_url` → `downloadURL`. `updateBusinessInfoV1` rejects `vat_number` mutations after onboarding.

### Mobile (`phone_app`)
- Tax invoice `idempotencyKey` suffix now uses `crypto.randomUUID()` instead of `Math.random()`.
- `document-copy.ts` replaced all hardcoded numeric doc-type keys with `[DOC_TYPE.*]` computed properties from `@smart-job/contracts`.
- `SupportChat.tsx` back-button label fixed (was mojibake `×—×–×•×¨` / `Ø±Ø¬ÙˆØ¹`; now correct UTF-8 `חזור` / `رجوع`).

### `cloudrun-pdf`
- `buildStoredDocumentRecord` no longer writes forbidden field names (`clientName`, `clientPhone`, `clientEmail`, `clientAddress`, `createdBy`) to stored document records.
- `htmlTemplate.ts` now sanitizes `logoUrl` through `sanitizeUrl()` which rejects `javascript:` and `data:` schemes before insertion into the `<img src>` attribute.
- Email service is now a true singleton; the non-singleton `getEmailService()` export has been removed.

### CI / Scripts
- `check-no-ts-nocheck.mjs` stale `functions/src` / `functions/tests` paths replaced with the correct protected path set from `AGENTS.md`.
- `check-perf-budget.mjs` scan path corrected from `functions/src` to `supabase/functions`.
