# Deployment

## Preconditions

1. Select an exact commit SHA and confirm the CI run for that SHA is green,
   including integration, Playwright, Maestro, audit, CodeQL, secret, SBOM, and
   container-scan jobs.
2. Confirm the dependency exception register is unexpired with
   `node scripts/check-npm-audit.mjs` and the supply-chain pins pass with
   `node scripts/check-supply-chain-pins.mjs`.
3. Record the current Cloud Run service revisions, job image digest, migration
   journal tail, open incidents, outbox/DLQ depth, and database backup/PITR
   status. Keep these values with the change record.
4. Confirm the new code is backward compatible with the currently deployed
   schema. Apply reviewed expand-only migrations through the journal tail using
   a dedicated migration credential; runtime roles must never receive it.
5. Confirm all required Secret Manager versions, Pub/Sub topics/subscriptions,
   Scheduler callers, IAM allowlists, archive bucket, DNS/TLS, and service
   audiences exist for the target environment.
6. For launch releases, explicitly verify `TAX_SUBMISSION_MODE=disabled`.

For a brand-new environment, follow the staged Terraform bootstrap in
`infra/README.md`: foundation first, migration/smoke jobs second, migration
execution third, and serving workloads only after that while DNS is
undelegated. The workflow below assumes the Terraform-owned services exist.

## Release

Build shared packages in canonical order, run the local guards, and dispatch
`.github/workflows/cloudrun-deploy.yml` for the exact reviewed ref. Use the
commit SHA as `image_tag`; it is only a discovery label.

1. In staging, dispatch `promotion_stage=candidate`. The workflow builds each
   of the seven images only when that immutable SHA tag is absent, blocks on the
   vulnerability scan, signs each source digest, runs the migration job, creates
   no-traffic revisions, and runs the internal smoke job.
2. Dispatch `10`, `50`, and `100` separately. Observe the platform dashboard,
   SLO burn, 5xx rate, database connections, queue depth, and scheduler failures
   between stages. A failed public smoke automatically restores the previously
   serving revisions.
3. For production, use the same SHA. The protected environment approval is
   required. The workflow refuses to build, verifies the staging signatures,
   copies the exact OCI manifest digest to the production registry, signs it
   there, and repeats candidate/10/50/100.

The `candidate` stage must precede `10`; `10` must precede `50`; and `50` must
precede `100`. Never skip the migration/readiness gate or combine the traffic
steps into one approval.

Do not rebuild a previously approved release under the same label. Promote the
same digest across environments.

## Verification

For every deployed service or job:

1. Record the deployed `IMAGE@sha256:...`, Cloud Run revision, configuration
   revision, and signature verification result.
2. Verify liveness and readiness. Readiness must include the exact expected
   migration metadata, not only a TCP/database connection.
3. Exercise one seeded non-production journey for login, tenant isolation,
   bounded list reads, mutation idempotency replay, PDF/email dispatch, archive
   retrieval, and tax-disabled behavior.
4. Watch 4xx/5xx rates, latency, database pool pressure, Pub/Sub delivery/DLQ,
   workflow leases, and outbox depth through the agreed observation window.
5. Promote the website/mobile release only after the API and private workers are
   healthy. Follow `phone_app/MOBILE_ROLLOUT.md` for native binaries.

If a verification fails, stop promotion and use `ROLLBACK.md`. Do not mask a
schema incompatibility by weakening readiness or database permissions.
