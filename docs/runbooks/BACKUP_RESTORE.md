# Backup and restore

Target launch objectives are an RPO of 15 minutes and an RTO of 4 hours. Do not
claim those objectives are met until a timed restore drill proves them with
production-like volume.

## Coverage

Treat these as separate recovery sets:

- PostgreSQL physical backup and PITR for database rows.
- Private GCS objects for active attachments and generated files.
- Versioned GCS archive objects and their companion ID manifests.
- Secret/IAM configuration and immutable deployment metadata.

A database backup contains Storage metadata, not the underlying Storage object
bytes. A database-only restore can therefore create references to objects that
must be recovered separately.

## Routine controls

1. Enable managed PostgreSQL PITR with a window that meets the approved RPO and
   verify it daily. The `cloudrun-backup` image supplements PITR with a daily
   PostgreSQL 17 custom-format export and a resumable 15-minute inventory of
   every generation in the private company-files GCS bucket.
2. Enable retention/versioning policies appropriate to the private file and
   archive buckets. Alert on unauthorized deletion and retention-policy changes.
3. Record custom database role definitions separately. Restored managed backups
   do not restore custom-role passwords; rotate/re-provision them afterward.
4. Run a quarterly isolated restore drill. Capture start/end time, selected
   recovery point, row/object counts, migration fingerprint, workflow state,
   application smoke tests, measured RPO/RTO, and cleanup approval.

The Storage job writes changed source versions create-only under
`storage/objects/`, immutable per-run inventories under `storage/manifests/`,
and immutable sequence checkpoints under
`state/storage-inventory-checkpoints/`. Delete markers are recorded but never
propagated to recovery objects. Logical exports and their manifests live under
`database/exports/` and `database/manifests/`. Every manifest records the raw
SHA-256 and exact GCS generation.

The backup bucket uses a customer-managed encryption key. Leave
`lock_backup_retention=false` until a successful restore drill is recorded;
Terraform rejects a lock unless `backup_restore_drill_verified=true`.

## Restore verifier

Build the image/package, select an immutable manifest object, and verify every
referenced generation and checksum:

```powershell
$env:BACKUP_BUCKET = "approved-backup-bucket"
$env:BACKUP_MANIFEST_OBJECT = "storage/manifests/2026-07-26/run-id.json"
npm --prefix cloudrun-backup run build
npm --prefix cloudrun-backup run restore:verify
```

For a database restore, also set `RESTORE_TARGET_DATABASE_URL` to an isolated
database whose name contains `restore`, `recovery`, `drill`, or `test`, and set
`RESTORE_TARGET_ISOLATED=true`. Remote targets additionally require a
non-production `RESTORE_TARGET_PROJECT_ID`. The verifier uses the exact
recorded generation, validates size and SHA-256 first, and refuses a
production-like target.

## Incident restore

1. Declare the recovery point in UTC from audit evidence. Freeze deployments,
   outbox drains, archiver schedules, and business writes before restoring.
2. Prefer restoring/duplicating into an isolated project first. Validate the
   selected backup predates the corruption and quantify expected data loss.
3. Restore through the approved managed-PostgreSQL recovery process.
   Expect downtime on an in-place restore.
4. Re-provision custom runtime-role passwords and update their Secret Manager
   versions. Confirm grants remain least privilege.
5. Compare the Drizzle journal and schema fingerprint with the reviewed release.
   Apply only required forward migrations; never run `test:migrations` against a
   non-loopback database.
6. Reconcile private GCS and archive objects by canonical path, size, MIME,
   generation, and SHA-256 metadata. Do not create public buckets or replace
   missing objects with unchecked content.
7. Before reopening traffic, verify exact readiness metadata, tenant isolation,
   counters, idempotency/session state, inventory balances, document/task/email/
   tax state, archive runs, and signed file access.
8. Re-enable drains and Scheduler jobs in bounded order, then watch backlog and
   duplicate/conflict metrics. Reopen writes only after the incident commander
   accepts the validation evidence.

The repository local reset command is not a production restore mechanism. It is
intentionally destructive only to the isolated `smart-job-erp-local` stack.
