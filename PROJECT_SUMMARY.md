# Smart-Job ERP — Project Summary

Last updated: July 22, 2026.

## Current state

Smart-Job is a multi-tenant field-service ERP with a Next.js website, an Expo
mobile app, a modular Cloud Run API, private PDF/email workers, a stateless tax
gateway, a monthly archive job, and a PostgreSQL/Supabase foundation.

The Edge-to-Cloud-API cutover is complete. `cloudrun-api` is the only
business-data boundary used by clients; all Supabase Edge functions and handlers
have been deleted. Firebase Messaging and Crashlytics remain for mobile push and
crash reporting. Firebase business-data services are removed.

Production tax submission remains fail-closed until certification. Batch 8 now
represents the production platform and release pipeline in code; applying it to
pre-created projects and collecting DNS/TLS, restore, traffic, and staged mobile
evidence remain launch gates.

## Package and runtime rules

- There is no root npm workspace. Install and run each package independently.
- Use Node 22 in CI and deployment.
- Build `packages/contracts` first, then `packages/api-contracts` and
  `packages/db`, before building their consumers.
- Keep the phone app on Expo 57's supported React/React DOM `19.2.3` pair.
- Drizzle migrations under `packages/db/migrations` are authoritative;
  `supabase/migrations` is intentionally disabled.
- The migration chain currently runs through `0032`.

## Trust and data ownership

- Supabase Auth owns sign-in and canonical `uid` identity.
- PostgreSQL owns tenant membership, ERP data, counters, opaque website
  sessions, idempotency, upload sessions, and durable workflow state.
- Numeric `companyId` is the public tenant scope. The API resolves it to an
  internal UUID before scoped SQL work.
- `smart_job_api`, `smart_job_pdf`, `smart_job_email`, and
  `smart_job_archiver` are separate least-privileged runtime roles. Their
  passwords are never stored in migrations or source.
- Private Supabase Storage owns active job attachments, previews, branding, and
  generated PDFs. GCS owns immutable archive record/ID segments.
- Pub/Sub messages contain opaque `taskId` or `deliveryId` values only. Workers
  lease and load canonical state from private SQL RPCs.

## Website

- All `/app/*` flows use an opaque Postgres-backed HttpOnly session and a
  server-only DAL/BFF. Canonical tenant routes are `/app/c/{companyId}/...`;
  shorter legacy paths redirect only.
- Initial overview, jobs, clients, inventory, documents, workers, settings, and
  upgrade reads are bounded and server-rendered.
- Mutations require exact Origin, double-submit CSRF, stable idempotency keys,
  and opaque entity versions where applicable.
- Supabase access/refresh tokens and the `SmartJobSession` value never enter
  browser JavaScript, HTML, browser storage, or readable cookies.

## Mobile

- Supabase transport tokens, installation identity, and encryption keys use
  SecureStore. MMKV is never used for Auth credentials or the durable outbox.
- All ERP reads and mutations use bounded, tenant-scoped Cloud API routes.
- Offline v1 is intentionally limited to `job.create_finished` and
  `job.complete_assigned`. Each uid gets a SQLCipher outbox; staged files use
  AES-256-GCM and are removed only after reconciliation or explicit discard.
- Firebase Messaging remains remote push transport; pinned
  `react-native-notify-kit` `10.4.8` owns local notifications.

## Critical transactional invariants

- Sequential IDs use SQL counters, never `MAX + 1`.
- Jobs use stable `(createdAt, id)` cursors and opaque positive entity versions.
- Job creation/completion/acceptance, client and inventory mutations,
  invitation redemption, and business registration use narrow atomic SQL RPCs.
- Multi-part picks and job inventory consumption commit or roll back as a batch.
- Generated files are create-only; canonical paths are persisted instead of
  durable signed URLs.
- Tax type `305` is created in one authoritative transaction. Only an approved
  response with a confirmation number creates the final PDF task.
- SES ambiguity becomes `delivery_unknown` and requires authorized manual
  retry. Tax ambiguity becomes `submission_unknown` and requires reconciliation.
- Archive deletion advances only from a verified immutable ID manifest.

## Local development

The repository-owned Docker Desktop stack uses Supabase project
`smart-job-erp-local` and the external `smart-job-local` network. Use only:

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes
```

Generated local credentials stay in ignored `local-platform/.env.generated`.
Do not set the local marker flags manually and never run `supabase stop --all`.

## Batch 7 verification baseline

- Exact npm audit exceptions are owner-assigned and expire after at most 30
  days; supported patch upgrades are applied without `--force`.
- JavaScript syntax checks include `.js`, `.cjs`, and `.mjs`; performance
  pagination/cursor checks are blocking.
- CI covers all package verification, database integration/migration tests,
  Supabase lint, local-fixture Playwright journeys, Maestro Cloud login/tenant/
  job/offline journeys, CodeQL, secret scanning, lockfile audits, Terraform
  validation/security scanning, SBOM generation, and container scans.
- Playwright runs WCAG 2.2 A/AA Axe checks across login and every core tenant
  route, plus keyboard skip-link and modal focus/inertness behavior.
- GitHub Actions, Dockerfile bases, and local Compose images are pinned to
  immutable digests. Released Cloud Run images are resolved and keyless-signed
  by digest before deployment.
- Operational procedures and sanitized environment templates are indexed under
  `docs/runbooks/README.md` and each environment-consuming package.
- The largest mobile document, client, job, and inventory screens are bounded
  orchestration layers backed by separate copy/model, API/state, form, style,
  and presentation modules with regression budgets.

## Batch 8 platform foundation

- Shared Terraform modules and isolated dev/staging/prod roots cover APIs,
  Artifact Registry, WIF/IAM, two-region fixed egress, Cloud Run services/jobs,
  durable queues/DLQs, Scheduler, storage, DNSSEC/TLS/load balancing, Cloud
  Armor, dashboards, alerts, and 30-day request SLOs.
- A dedicated non-root migration image uses production-only Drizzle/PG
  dependencies. The staged workflow builds/scans/signs once in staging,
  preserves the exact digest in production, and gates migration, no-traffic
  smoke, and 10/50/100 traffic.

## Remaining launch work

- Supply billed project IDs, the protected state bucket, domains, secret
  versions, connection limits, notification channels, WIF/GitHub environment
  configuration, and then apply the Terraform roots.
- Capture live DNS/TLS, fixed-egress allowlist, migration/readiness, traffic,
  alert/SLO, backup/restore, and rollback evidence.
- Complete and sign the manual website keyboard/screen-reader and native
  VoiceOver/TalkBack review in `docs/launch/`, plus the staging soak, load test,
  and native rollout (or evidence-backed greenfield waiver).
- Tax Authority certification and production enablement remain separate,
  explicit approvals.
- Some older source-structure tests remain useful guards, but critical auth,
  tenant, database, worker, and offline paths also have behavioral coverage.
- Broader strict-TypeScript adoption outside the packages already migrated
  remains a maintainability opportunity.

For installation and deployment details use `SETUP.md`; for ownership and
invariants use `architecture.md` and `backend.md`.
