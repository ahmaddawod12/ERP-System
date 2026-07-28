# Operations runbooks

These procedures describe the current Cloud API architecture. They are
checklists, not authorization to mutate production. Record the environment,
incident/change ID, operator, UTC timestamps, commit SHA, image digest, and
verification evidence for every execution.

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — release preflight and digest deployment
- [`ROLLBACK.md`](./ROLLBACK.md) — application revision rollback and database rules
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — database, Storage, and archive recovery
- [`SECRET_ROTATION.md`](./SECRET_ROTATION.md) — staged credential rotation
- [`DLQ_REPLAY.md`](./DLQ_REPLAY.md) — safe opaque-message inspection and replay
- [`TAX_RECONCILIATION.md`](./TAX_RECONCILIATION.md) — `submission_unknown` handling
- [`EMAIL_DELIVERY_UNKNOWN.md`](./EMAIL_DELIVERY_UNKNOWN.md) — ambiguous SES delivery
- [`ARCHIVE_RESTORE.md`](./ARCHIVE_RESTORE.md) — verified archive retrieval/rehydration
- [`../../phone_app/MOBILE_ROLLOUT.md`](../../phone_app/MOBILE_ROLLOUT.md) — native staged rollout
- [`../launch/README.md`](../launch/README.md) — required production evidence and accessibility sign-off

Global rules:

- Keep `TAX_SUBMISSION_MODE=disabled` until the separate certification approval.
- Never put bearer tokens, database URLs, private keys, or secret payloads in
  tickets, shell history, screenshots, logs, or committed files.
- Database migrations are expand-only during release. Roll application code
  back by signed digest; repair schema forward or use an approved PITR event.
- Do not manually update durable workflow tables to bypass leases,
  idempotency, optimistic versions, or unknown-outcome states.
- Practice restore and rollback procedures in an isolated non-production
  environment before relying on them in an incident.
