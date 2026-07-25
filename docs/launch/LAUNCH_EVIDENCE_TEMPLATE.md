# Production launch evidence

Status: **NOT APPROVED**

## Release identity

| Field | Value |
|---|---|
| Environment | `<production>` |
| Change/incident ID | `<required>` |
| Commit SHA | `<required>` |
| Signed image digests | `<required: website/api/tax/pdf/email/archiver/migration>` |
| Database migration journal tail | `<required>` |
| Start/end UTC | `<required>` |
| Release owner | `<required>` |
| Final approver | `<required>` |

## Required gates

Use `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. `N/A` is allowed only where the
gate itself defines a signed waiver.

| Gate | Status | Owner | Evidence / measured result |
|---|---|---|---|
| Billed GCP projects and protected versioned Terraform state bucket | NOT RUN |  |  |
| Terraform plan/apply for the exact reviewed ref | NOT RUN |  |  |
| Numbered Secret Manager versions and least-privilege IAM | NOT RUN |  |  |
| DNSSEC delegation, managed certificates active, and direct-origin bypass denied | NOT RUN |  |  |
| Fixed egress addresses allowlisted and verified from each runtime region | NOT RUN |  |  |
| Expand-only migration job, exact schema marker, runtime privileges, readiness, and no-traffic smoke | NOT RUN |  |  |
| Candidate → 10% → 50% → 100% traffic promotion with rollback revision recorded | NOT RUN |  |  |
| 30-day request SLOs and alert delivery tested with the real notification channels | NOT RUN |  |  |
| Document queues/DLQs, email queue/DLQ, tax submission/callback, archive, DB pool, and session-refresh dashboards/alerts | NOT RUN |  |  |
| Production-like load test meets the agreed latency targets and 99.9% error-budget objective | NOT RUN |  |  |
| Seven consecutive days of staging soak with production-like configuration | NOT RUN |  |  |
| Timed isolated restore proves RPO ≤15 minutes and RTO ≤4 hours | NOT RUN |  |  |
| Signed-digest application rollback and forward-schema recovery rehearsal | NOT RUN |  |  |
| CI, SAST, secret scan, SBOM, lockfile audit, and image scan green for the exact SHA | NOT RUN |  |  |
| Website WCAG automation plus signed manual keyboard/screen-reader review | NOT RUN |  |  |
| VoiceOver/TalkBack smoke review on the release binaries | NOT RUN |  |  |
| Maestro production-like login/tenant/job/offline journeys | NOT RUN |  |  |
| Native 10%/24h → 50%/48h → 100% rollout, or approved greenfield waiver | NOT RUN |  |  |
| SES domain/DKIM/SPF/DMARC, production access, bounce/complaint handling | NOT RUN |  |  |
| Legal retention periods and privacy wording configured and approved | NOT RUN |  |  |
| `TAX_SUBMISSION_MODE=disabled` verified in production | NOT RUN |  |  |

## Approval

- Open incidents/exceptions: `<required; write none if empty>`
- Rollback decision owner: `<required>`
- Final decision: `BLOCKED`
- Approver/signature and UTC timestamp: `<required>`

