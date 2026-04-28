# Backend

This document summarizes the active backend boundaries in April 2026.

## Current Backend Reality

- The top-level `functions/` package is not present in this repository.
- Active in-repo backend entry surfaces are implemented under `supabase/functions/` plus Cloud Run services.
- Supabase Auth is the active bearer-token provider.
- SQL is the primary persistence layer for company-scoped ERP data.
- Firestore is still used for selected operational paths, compatibility mirrors, rules-backed reads, and residual legacy surfaces.
- Supabase Edge Functions in `supabase/functions/` are the maintained gateway surface in this workspace.

## Service Boundaries

### supabase/functions/

The `supabase/functions/` package is the active trust boundary in this workspace. It is responsible for:

- auth and company-scope verification
- protected mutations and read-model endpoints
- rate limiting and idempotency
- document task orchestration
- dispatching trusted preview/generate work to `cloudrun-pdf`
- signed URL issuance
- tax authority flows
- push/email side-effect coordination
- compatibility writes to Firestore where still required

Read-model calls are kind-based and must preserve compatibility with website/mobile `kind` payload contracts.
Job contracts must expose public sequential IDs and full attachment/meta fields at that boundary, while resolving internal UUID rows only inside handlers.

Important active entry surfaces include:

- `mutationGatewayV1`
- `mutationGatewayMeWest1V1`
- `readModelV1`
- path-based endpoint handlers under `supabase/functions/**/index.ts`

### cloudrun-pdf/

This service owns PDF preview and generation. It:

- validates requester identity and company scope
- renders previews and final PDFs
- stores files by canonical `storagePath`
- finalizes task and document state
- preserves create-only semantics for new generated documents

### cloudrun-archiver/

This batch job owns monthly archive creation and verified deletion. It:

- snapshots eligible finished jobs and documents
- drains paginated SQL reads for the full target month
- writes archive payloads to Cloud Storage
- verifies integrity by checksum before deletion
- deletes only the exact IDs captured in the verified archive

### packages/db/

This package is the SQL persistence layer. It contains:

- schema definitions
- migrations
- typed access helpers
- read-model helpers used by backend services

### supabase/

This directory contains the backend gateways and extracted handler logic. `supabase/handlers/` remains the main migration work area for parity hardening and runtime rollout.

## Active Data Model Responsibilities

### SQL-first areas

Primary ERP entities live in SQL, including:

- companies and profiles
- memberships and counters
- clients
- jobs and job attachments
- inventory
- documents and document tasks
- invites
- support conversations
- tax workflow state
- operational delivery, rate-limit, and archive tables

### Firestore residual areas

Firestore remains active for:

- company ID allocation via `system/data/comid`
- compatibility profile and cache mirrors
- selected membership mirrors
- document generation locks
- residual admin and operational collections
- remaining personal inventory surface

## Request Patterns

### Website

The website uses API proxy routes and signed HttpOnly `__session` cookies, then calls backend edge function endpoints.
Those server routes authenticate backend calls from a verified split-cookie session: signed metadata in `__session`, current bearer token in HttpOnly `__session_access`.

### Mobile

The mobile app attaches Supabase bearer tokens and calls backend edge gateway endpoints.

### Direct SQL access

Client applications must not bypass the backend and talk directly to SQL for protected ERP operations.

## Development Guidance

- Treat `supabase/functions/` and `supabase/handlers/` as the active in-repo backend surface.
- Preserve canonical field names and status enums from `@smart-job/contracts`.
- Preserve backend-only mutation boundaries for locked business collections.
- Keep `storagePath` as the canonical persisted file reference.
- Do not weaken idempotency, deduplication, or create-only semantics in document flows.
- Allocate sequential identifiers through SQL counters; avoid `MAX + 1` allocation in concurrent mutation paths.
- Normalize external/public `companyId` inputs to internal company UUIDs before SQL filters in handlers.
- Normalize public job identifiers to internal rows inside handlers, but return public sequential job/member IDs back to website/mobile callers.
- Keep cursor-based pagination stable with composite cursor semantics when ordering by timestamp + id.
- When read-model payloads expose public IDs, keep cursor tokens based on the underlying ordered SQL fields, not the public display IDs.
- Keep signed URL issuance server-controlled: fixed buckets and canonical storage path validation.
- Keep document task result URLs semantically split by task type (`preview_url` vs `generate_url`) to avoid response-contract drift.
- Keep invite redemption race-safe by consuming invite state atomically before membership finalization.
- Keep preview/generate/tax document flows on the same SQL-backed draft-document plus `document_tasks` pipeline.
- Require manager authorization for company inventory mutations and for cross-member inventory mutations.
- Validate inventory location ownership against the resolved internal company UUID before applying movement updates.
- Keep tax invoice reservation/document/task ordering SQL-first and idempotent, without leaving reservation/task side effects ahead of the draft document row.
- Keep tax invoice PDF finalization create-only once `storage_path` is already set.
- Keep archive manifests in a resumable state until delete counts match the archived ID set exactly.

## Runtime Note

The migration goal remains runtime replacement without contract drift. During this period:

- client payloads and response envelopes must stay stable
- website and mobile app behavior should remain unchanged
- some legacy Firebase backend paths may still exist outside this workspace, but source changes in this repo should target `supabase/functions/`
