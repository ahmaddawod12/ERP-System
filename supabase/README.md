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

```bash
supabase start
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
