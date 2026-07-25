# Smart-Job ERP Production Remediation and Launch Plan

## Summary

> Repository status (July 22, 2026): all implementation batches are represented
> in source, tests, Terraform, CI, and runbooks. Production is intentionally not
> marked launched: billed-project setup, live Terraform application, DNS/TLS,
> seven-day soak, load/restore drills, staged native adoption, manual assistive-
> technology review, legal approval, and tax certification require external
> owners and signed evidence. The authoritative blank evidence record is
> `docs/launch/LAUNCH_EVIDENCE_TEMPLATE.md`; an uncompleted gate blocks launch.

Bring the current greenfield repository to production on:

- GCP `europe-west3` for website, API, PDF, email worker, and archiver.
- GCP `me-west1` for the Tax Authority gateway.
- Separate dev, staging, and production GCP/Supabase/Firebase projects.
- Supabase `eu-central-1`, colocated as closely as possible with the GCP data plane, per the [available-region documentation](https://supabase.com/docs/guides/platform/regions).
- Terraform-managed project resources, with projects, billing links, and the Terraform state bucket bootstrapped manually.
- Cloud Logging/Monitoring/Trace/Error Reporting plus Firebase Crashlytics.
- AWS SES retained behind a durable email-delivery workflow.
- Tax submission implemented but production-disabled until certification.
- 99.9% service target, RPO 15 minutes, RTO 4 hours.
- Full Cloud API mobile cutover; legacy Edge endpoints retire after 99% adoption and 30 consecutive days without business traffic.

Estimated implementation: **12–16 engineer-weeks**, excluding app-store review, Tax Authority certification, DNS ownership, and legal review. Each numbered batch lands separately and must leave CI green.

## Implementation Batches

### 0. Immediate release blockers

- Add a fail-closed `TAX_SUBMISSION_MODE=disabled|sandbox|production`; production defaults to `disabled`. Mobile and web show “Tax submission unavailable/pending certification” and never claim approval from the legacy reservation handler.
- Normalize document-task company IDs immediately and add a cross-service regression test covering SQL payload → API publisher → PDF authorization.
- Pass a stable upload-session idempotency key from offline operations, derived as `<operation-idempotency-key>:attachments`, and preserve it across retries/restarts.
- Persist accepted document task ID, fingerprint, and idempotency key in website session storage and mobile MMKV. Clear only on terminal reconciliation or explicit user discard; timeout resumes polling rather than creating a new task.
- Upgrade Drizzle to `>=0.45.2` and `basic-ftp` to `>=5.3.0`; update supported dependency patches without forced Expo downgrades.
- Acceptance gate: the six Critical/High deterministic failures from the audit have regression tests before further feature work.

### 1. Database correctness and migration metadata

- Generate the next sequential custom Drizzle migration as a no-op metadata baseline representing the schema after migration 0024; verify its snapshot against a clean database built from migrations 0001–0024.
- Add the following subsequent expand-only migrations:
  - Job acceptance consumes recorded parts through `apply_job_inventory_consumption_batch` before status finalization.
  - PDF, email, and archiver receive dedicated least-privilege login roles with only private RPC access; passwords remain out-of-band.
  - Document email deliveries, tax submissions, and archive-run leases receive durable tables/state machines.
- Never grant runtime roles direct write access to public ERP tables.
- Test every migration from a blank hosted-compatible Postgres 17 database and as an upgrade from 0024. Explicitly grant only required Data API access because new Supabase projects no longer automatically expose new public tables by default, as documented in the [2026 platform change](https://supabase.com/changelog/45702-developer-update-may-2026).
- Run integration permission matrices for `anon`, `authenticated`, `service_role`, `smart_job_api`, PDF, email, and archiver roles.

### 2. Reliable document and email pipeline

- Add a shared `DocumentDispatchMessageSchema` containing only `taskId`; Pub/Sub messages no longer carry trusted tenant/user/document data.
- Replace PDF’s status-only task claim with a private RPC that atomically claims and returns canonical task type, tenant, user, document, and request payload. Every completion/failure RPC verifies the lease token and canonical identifiers.
- Make Pub/Sub configuration mandatory in production. Provision preview/generate topics, authenticated push subscriptions, dead-letter topics, bounded retries, and a scheduled database-outbox drain.
- Final PDF completion atomically stores the generated object, marks the document generated, and creates an email-delivery row when a validated recipient exists.
- Create a small `cloudrun-email` service. It receives only `deliveryId`, claims the canonical delivery, sends via SES, and records `queued|sending|sent|failed|delivery_unknown`.
- Retry only definite pre-send or provider-rejected transient failures. A crash/timeout after SES submission becomes `delivery_unknown` and requires an explicit manager/dev retry, preventing automatic duplicate customer mail.
- Remove SES and email state handling from `cloudrun-pdf`.
- Preserve `emailSent` for compatibility while adding `emailDeliveryStatus` to document responses.

### 3. Authoritative tax workflow

- Add `POST /api/v1/companies/{companyId}/tax-invoices`, requiring verified identity and `Idempotency-Key`. The request contains only strict `DocumentDataInput`; document type 305 is implicit.
- Implement one private SQL RPC that validates positive bounded decimal amounts, allocates the `doc_305` counter, inserts document/items/reservation, and creates a durable tax-submission outbox record atomically.
- Add `submitted` to the tax-authority status enum and shared contract. User-visible states become `reserved`, `submitted`, `approved`, `rejected`, and `failed`; only `approved` may display an approval claim or confirmation number.
- Add an internal, Google-identity-protected tax-submission drain. It claims submissions, calls `cloudrun-tax` with a stable correlation ID, and processes immediate results through the same idempotent result function used by callbacks.
- Verify during certification whether the authority guarantees correlation-ID idempotency. Ambiguous timeouts remain `submission_unknown` and require reconciliation rather than blind retry.
- An approved result atomically records the confirmation number and enqueues PDF generation. Rejected/failed submissions never generate a final tax invoice PDF.
- Remove `getInvoiceApproval` and the 501 Edge callback after mobile cutover.
- Production enablement requires: sandbox contract tests, callback replay/conflict tests, authority idempotency verification, security review, accounting/legal sign-off, and a controlled production canary.

### 4. Complete mobile Cloud API cutover

- Add the missing API surfaces:
  - `GET /api/v1/companies/{companyId}/jobs/{jobId}` returning parts and attachment metadata.
  - `GET /api/v1/companies/{companyId}/jobs/{jobId}/attachments/{attachmentId}/download`.
  - `GET /api/v1/companies/{companyId}/archives/{archiveRunId}/download`.
  - `GET /api/v1/companies/{companyId}/documents/{documentId}` for authoritative document/tax/email state.
- Move online job attachments to the existing signed Supabase upload-session protocol; remove direct Firebase Storage upload/delete calls.
- Replace remaining Edge calls for job create/update/accept/delete, preview, tax, archives, invitations, and upgrades with typed Cloud API clients.
- Delete the unused `updateCacheV1`/`updateInventoryV1` version hook; server mutations remain the sole source of sync-version changes.
- Split the Firebase compatibility file into Supabase auth transport and Firebase Messaging/Crashlytics modules. Remove callable and Storage exports plus `@react-native-firebase/storage`; retain FCM.
- Centralize request deadlines, cancellation, typed error parsing, single-flight token refresh, retry policy, and tenant-scoped React Query invalidation.
- Remove dead cache-fetcher stubs and migrate consumers to bounded cursor queries rather than full-collection drains.
- Ship the new binary through staged store rollout. Keep a compatibility Edge deployment until 99% of active installations use the new API version and legacy business traffic is zero for 30 days; then remove Edge code, deploy secrets, and `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`.

### 5. Archive, performance, session, and abuse hardening

- Replace mutable per-company GCS manifests with leased database archive runs. Store snapshot time, segment, checksum, GCS generation, counts, and lease expiry.
- Use advisory locking plus GCS `ifGenerationMatch` preconditions. Allow later segments for late-arriving historical rows; an empty run never permanently closes a month.
- Store a verified companion ID manifest and delete source rows in bounded 500-row chunks. Resume from the verified object after worker loss.
- Bound archive page size and company concurrency; use one task, 60-minute timeout, and two retries initially.
- Profile a synthetic large tenant before indexing. Where thresholds fail, add generated normalized search text plus `pg_trgm` GIN indexes for jobs/documents and a trigram index for inventory names. Targets: list p95 under 300 ms and search p95 under 500 ms at 100k jobs/50k documents.
- Resolve web sessions without a write lock when tokens are safely valid; acquire and recheck under `FOR UPDATE` only inside the refresh window.
- Replace fixed contact arithmetic with server-verified reCAPTCHA Enterprise. Apply Cloud Armor IP throttles to auth/contact routes, generic account-recovery responses, bounded upstream response reads, and request deadlines.
- Strengthen readiness to verify expected schema version, required RPC privileges, mandatory publisher configuration, and initialized storage clients; keep liveness dependency-free.
- Keep Chromium inside Cloud Run’s sandboxed runtime, prohibit arbitrary navigation/URLs, run non-root, and document `--no-sandbox` as a reviewed compensating-control exception.

### 6. Web/mobile quality and maintainability

- Website:
  - Add focus capture/trap/restore, background inertness, and scroll locking to modal behavior.
  - Add skip navigation, table header scopes, accessible error announcements, RTL-aware formatting, and consistent `Intl` dates/currency.
  - Add AbortController deadlines to server Auth calls.
  - Implement consent-aware GA4 without PII or remove the no-op analytics abstraction.
- Mobile:
  - Add modal/alert semantics, labels/hints/states for shared inputs and controls, and screen-reader announcements for errors.
  - Correct all mojibake with verified UTF-8 Hebrew/Arabic fixtures.
  - Set automatic light/dark appearance and responsive tablet/landscape layout.
  - Replace direct console calls with the project logger and redact identifiers.
  - Decompose the oversized document, client, job, and inventory screens into state-machine/API, form, and presentation modules without changing behavior.
- Enable strict TypeScript one package at a time: contracts, database, archiver, PDF, then new email service. Remove `any` from public boundaries before enabling each package.
- Remove stale `db_errors.txt` and dormant legacy website token code after usage verification.

### 7. Dependencies, CI, and documentation

- Resolve npm audit findings through supported patch upgrades. For Expo-only transitive findings without compatible fixes, record a time-limited risk exception with owner, reachability, compensating controls, and 30-day review date; never use `--force`.
- Fix syntax checking to include `.mjs`; rewrite the performance guard against current paths and make verified checks blocking.
- CI must run:
  - Every unit test, typecheck, lint, build, Deno check/test, database unit/integration test, and `supabase db lint`.
  - Mandatory Playwright core journeys and Maestro login/tenant/job/offline flows.
  - CodeQL, secret scanning, lockfile audit, Terraform validate/tflint/security scan, SBOM generation, and container vulnerability scanning.
- Pin GitHub Actions and container bases by immutable digest. Sign container images with keyless provenance.
- Replace source-regex-only protection for critical paths with behavioral integration tests.
- Update existing READMEs, `SETUP.md`, architecture documents, and project summary to the final architecture. Add sanitized per-package environment examples plus concise deployment, rollback, backup restore, secret rotation, DLQ replay, tax reconciliation, email-unknown, archive restore, and mobile-rollout runbooks.

### 8. Terraform production platform and delivery pipeline

- Add shared Terraform modules and explicit `infra/environments/{dev,staging,prod}` roots with separate state keys.
- Pre-create project/billing links and a versioned encrypted GCS Terraform state bucket. Terraform owns APIs, Artifact Registry, IAM, VPC/NAT/static egress, Cloud DNS records, managed certificates, load balancer, Cloud Armor, Cloud Run, Pub/Sub, Scheduler, archive/backup buckets, monitoring, and GitHub Workload Identity Federation.
- Terraform creates Secret Manager containers and IAM only; secret values never enter Terraform state. Supabase, SES, session keys, and signing material are populated out-of-band.
- Deploy:
  - Next.js standalone non-root Cloud Run image, min 1.
  - Main API min 1.
  - Tax gateway min 1 in `me-west1`.
  - PDF/email workers min 0 with durable queues.
  - Archiver as a single-task Cloud Run Job.
  - Cap aggregate maximum database pools at 70% of the Supabase connection limit.
- Put website/API/tax callback domains behind the external HTTPS load balancer and Cloud Armor. Keep PDF/email/internal drains private to authenticated Google service identities.
- Use a dedicated migration Cloud Run Job with the owner/migrator secret. Runtime services never receive migration credentials.
- CI builds each image once, scans/signs it, and promotes the same digest through staging and production.
- Deployment sequence: expand-only migration → no-traffic revision → readiness/smoke → 10% traffic → 50% → 100%. Production requires GitHub environment approval.
- The website uses a parameterized Cloud Run domain, exact production `WEBSITE_ORIGIN`, opaque secure cookies, and the server-only API origin.

## Public Interfaces and Data Models

- Add shared schemas for:
  - Tax invoice creation/accepted status and `submitted` authority state.
  - Canonical document dispatch messages.
  - Job detail, attachment metadata, and signed download access.
  - Archive page/download access.
  - Email delivery status.
  - Bootstrap capability `taxSubmissionMode`.
- Add public routes:
  - Tax invoice submission and document detail/status.
  - Job detail and exact attachment download.
  - Archive run download.
  - Idempotent manual retry for `failed|delivery_unknown` document email, restricted to authorized document roles.
- Add internal routes:
  - Tax submission drain.
  - Document/email outbox drains.
  - Existing tax callback/session binding remains Google-identity protected.
- Pub/Sub payloads contain opaque IDs only. Consumers load canonical tenant/user/request state from private SQL RPCs.
- Preserve existing v1 fields during the mobile adoption window; additions are backward-compatible. Remove legacy Edge paths only after the retirement gate.

## Verification and Launch Gates

- Critical behavioral tests:
  - Tax never reports approval or generates a final PDF before confirmed authority acceptance.
  - Callback and immediate approval replays are idempotent; conflicting payloads fail.
  - Document tasks authorize numeric/string company representations identically.
  - Accepted-task timeout/reload resumes the same task and never allocates another number.
  - Job acceptance consumes parts exactly once under concurrency and rolls back on insufficient stock.
  - Offline and online attachments survive retry/restart and remain tenant-scoped.
  - SES duplicate delivery is prevented; ambiguous delivery becomes manual-review state.
  - Archive overlap, late data, checksum failure, worker loss, and large deletion batches recover safely.
- Security tests:
  - Full role × tenant × entitlement matrix.
  - Cross-tenant attachment/document/archive denial.
  - Runtime-role grant snapshots.
  - Auth/contact enumeration, CAPTCHA, rate-limit, timeout, and oversized-response behavior.
  - No secrets in client bundles, logs, images, Terraform state, or repository.
- Quality gates:
  - WCAG 2.2 AA automated checks for website core journeys and manual keyboard/screen-reader review.
  - VoiceOver/TalkBack smoke tests for login, navigation, forms, alerts, job completion, and Pending Work.
  - No Critical/High dependency or image vulnerability at release; exceptions allowed only for unreachable Moderate transitive issues with expiry.
- Operational gates:
  - Seven-day staging soak with production-like configuration.
  - Load tests meet 99.9% SLO/error-budget and latency targets.
  - Document queue, email queue, tax submissions, callbacks, archive failures, DB pool saturation, and session-refresh failures have dashboards and alerts.
  - Quarterly restore drill proves RPO 15 minutes/RTO 4 hours.
  - Production mobile rollout: 10% for 24 hours, 50% for 48 hours, then 100% if crash-free sessions and API error budget remain healthy.
  - Tax remains `disabled` in production at platform launch.

## Assumptions and Fixed Defaults

- There is no live production customer data; the first production database is created cleanly from migrations.
- GCP projects and billing links are supplied before Terraform execution.
- Supabase production uses a paid tier supporting the selected PITR/recovery posture.
- FCM and Crashlytics remain; Firebase Auth, Functions, Firestore, and Storage are not production business-data paths.
- AWS SES is configured in an EU region with verified domain, DKIM/SPF/DMARC, production sending access, bounce/complaint handling, and no credentials in source.
- Legal counsel supplies final tax/document retention periods and privacy wording; launch is blocked until those values are configured and documented.
- No payment processing is introduced.
- The repository remains intentionally package-by-package with no root npm workspace.
- Database migrations are expand-only during launch; application rollback uses the prior signed image digest, while database recovery uses forward fixes or PITR rather than destructive down migrations.
