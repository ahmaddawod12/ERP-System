# Supabase Backend Workspace

Status: Active backend gateway surface (April 26, 2026)

This directory is where backend runtime work happens in this repository.

## What Lives Here

- `functions/`: HTTP entrypoints (gateway and domain endpoints)
- `handlers/`: extracted domain logic
- `shared-edge-helpers.ts`: auth, request parsing, validation, response helpers

## Active Entrypoints

- `functions/mutation-gateway/`
- `functions/mutation-gateway-me-west1/`
- `functions/read-model/`

## Read-Model Contract

`functions/read-model/` is kind-based and must stay aligned with website/mobile requests.

Job-specific contract notes:

- `jobs` and `recordById` return public sequential job IDs and public member numbers (`wid`, `mid`) at the client boundary.
- Job part usage payloads must also expose public inventory part numbers, not internal inventory UUIDs.
- `createJobV1` / `updateJobV1` must preserve job meta and attachment fields used by website/mobile, including `timeFrom`, `timeTo`, `travelDistance`, `signingPerson`, `photos`, `signature`, and `partsUsed`.
- Handlers may still accept legacy UUID job identifiers internally during transition, but should normalize back to the public sequential job ID in responses.

Supported `kind` values:

- `bootstrap`
- `workers`
- `clients`
- `jobs`
- `documents`
- `inventory`
- `companySyncState`
- `recordById`
- `documentTask`
- `userSyncState`

## Local Development

Run these from the repository root:

```bash
supabase start
deno check --config deno.json supabase/shared-edge-helpers.ts supabase/functions/**/*.ts supabase/handlers/**/*.ts
supabase functions serve mutation-gateway --env-file supabase/.env
supabase functions serve mutation-gateway-me-west1 --env-file supabase/.env
supabase functions serve read-model --env-file supabase/.env
```

Notes:

- Do not use `--no-verify-jwt` in shared or production environments.
- Keep `CORS_ALLOWED_ORIGINS` explicitly configured; empty origin lists fail closed.

Smoke test:

```bash
curl -X POST http://localhost:54321/functions/v1/mutation-gateway \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"operation":"updateProfileV1","payload":{"displayName":"Test"}}'
```

## Working Rules

- Keep operation contracts stable.
- Keep role and company checks explicit.
- Normalize incoming/public `companyId` values to internal company UUIDs before SQL filters.
- Normalize public job identifiers to internal rows inside handlers, but do not expose internal job or membership UUIDs back to clients.
- Use canonical field names and enums from `@smart-job/contracts`.
- Treat `packages/db` as the SQL source of truth.
- Preserve backend-only write boundaries.
- Preserve idempotency and deduplication before side effects.
- Use SQL-backed counter allocation helpers for sequential IDs (`public_company_id`, `member_no`, `client_no`, `job_no`).
- Do not use `MAX + 1` allocation patterns in concurrent mutation paths.

## Environment Essentials

Required in local or deployed environments:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `CLOUD_RUN_PDF_SERVICE_URL`
- `ARCHIVE_BUCKET`

Required for trusted edge-to-Cloud-Run document dispatch:

- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`
- `PUBSUB_VERIFICATION_TOKEN` when `cloudrun-pdf` shared-token verification is enabled

Required for backend archive retrieval:

- `ARCHIVE_BUCKET`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_SERVICE_ACCOUNT_PRIVATE_KEY`

Domain-specific vars such as tax credentials and callback URLs should match `SETUP.md`.

## Suggested Workflow

1. Implement operation logic under `handlers/`.
2. Wire operation in gateway dispatcher.
3. Validate payload rules and auth behavior.
4. Run tests and targeted smoke checks.
5. Verify no schema drift or contract drift.

## Related Docs

- `../SUPABASE-MIGRATION-GUIDE.md`
- `../backend.md`
- `../architecture.md`
- `../SETUP.md`
