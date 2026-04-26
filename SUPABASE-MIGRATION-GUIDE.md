# Supabase Migration Guide

Status: Phase 2 hardening in progress (April 26, 2026)

This document defines the migration approach from legacy Firebase-backed runtime paths to the Supabase Edge runtime under `supabase/functions/`, without breaking website or mobile behavior.

## Scope

- Runtime surface: `supabase/functions/`
- Shared business logic extraction: `supabase/handlers/`
- Primary persistence: PostgreSQL via `packages/db`
- Compatibility surfaces: Firestore and Cloud Storage where still required

## Non-Negotiable Rules

- Keep endpoint contracts stable during migration.
- Preserve canonical identity keys (`uid`, `companyId`).
- Preserve region split: default gateway and `me-west1` tax gateway.
- Keep protected writes backend-only.
- Keep CORS allowlists explicit and fail closed when no origin is allowed.
- Claim idempotency before push/email/PubSub side effects.
- Persist only canonical `storagePath` for generated artifacts.
- Keep read-model `kind` contracts stable across website and mobile callers.
- Keep document task URL mapping stable: `previewURL <- preview_url` and `downloadURL <- generate_url`.
- Allocate sequential identifiers through SQL counters, not `MAX + 1` reads.
- Keep invite redemption race-safe with atomic invite-consume semantics.
- Normalize incoming/public `companyId` values to internal company UUIDs in handler write paths.
- Preserve stable cursor pagination semantics for timestamp-sorted read-model collections.

## Active Entry Surfaces

- `mutation-gateway`
- `mutation-gateway-me-west1`
- `read-model`

## Migration Workflow

1. Extract operation logic into focused modules under `supabase/handlers/`.
2. Wire extracted handlers into gateway dispatchers.
3. Validate auth, company scope checks, and input limits.
4. Verify SQL read/write parity against current behavior.
5. Validate side effects (documents, tax, notifications) behind idempotency guards.
6. Run tests and rollout incrementally.

## Readiness Checklist

- Contracts and response envelopes are unchanged.
- Role and company-scope checks are explicit.
- Canonical field names match `@smart-job/contracts`.
- Firestore compatibility writes (where still needed) are preserved.
- Regression tests pass for migrated operations.
- Rollback path is documented before enabling broader traffic.

## Exit Criteria

- All required operations are served from `supabase/functions/` in production.
- No frontend dependency remains on legacy protected runtime surfaces.
- Migration-era feature flags are removed or permanently settled.
- Documentation reflects post-cutover runtime reality.

## Related Docs

- `supabase/README.md`
- `SETUP.md`
- `backend.md`
- `architecture.md`
