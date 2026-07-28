# Rollback

## Decision

Rollback is appropriate for an application regression when the previous signed
revision is compatible with the current expand-only schema. Use a forward fix
when the old binary cannot safely understand data already written by the new
release. Use `BACKUP_RESTORE.md` only for confirmed data loss/corruption; never
run a destructive down migration as an application rollback.

## Cloud Run services

1. Freeze deployments and record the failing revision, image digest, first bad
   request time, affected tenants, and current workflow/outbox state.
2. Identify the last healthy revision and verify its image signature and schema
   compatibility.
3. Move traffic to that exact revision:

   ```bash
   gcloud run services update-traffic SERVICE --region REGION --to-revisions REVISION=100
   ```

4. Verify readiness, login, tenant isolation, one bounded read, and one
   idempotent write. Continue monitoring in-flight requests because traffic
   changes do not cancel work already executing.
5. Leave the failed revision and evidence intact until the incident review is
   complete; do not retag or overwrite its image.

For `cloudrun-archiver`, stop new Scheduler executions, let an active leased run
finish or expire, then update the job to the last healthy signed digest. Archive
leases and immutable object generations make a restart resumable; never delete
objects or reset cursors manually.

## Website and mobile

- Roll the website service back to its previous signed revision only after
  confirming that its BFF contracts match the current API.
- Native mobile binaries cannot be recalled from devices. Pause store rollout
  and OTA promotion, keep backward-compatible API routes deployed, and publish
  the last healthy compatible build through the staged mobile procedure.

## Closeout

Confirm queue recovery, error-budget recovery, no new unknown tax/email states,
and no tenant-scope anomalies. Record why rollback was safe, the final revision
mapping, follow-up owner, and whether a forward database repair is required.
