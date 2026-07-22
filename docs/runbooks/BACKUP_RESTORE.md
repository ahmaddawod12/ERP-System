# Backup and restore

Target launch objectives are an RPO of 15 minutes and an RTO of 4 hours. Do not
claim those objectives are met until a timed restore drill proves them with
production-like volume.

## Coverage

Treat these as separate recovery sets:

- Supabase/PostgreSQL physical backup and PITR for database rows.
- Private Supabase Storage objects for active attachments and generated files.
- Versioned GCS archive objects and their companion ID manifests.
- Secret/IAM configuration and immutable deployment metadata.

A database backup contains Storage metadata, not the underlying Storage object
bytes. A database-only restore can therefore create references to objects that
must be recovered separately.

## Routine controls

1. Enable a PITR retention window that meets the approved RPO and verify backup
   health daily. Keep a periodic encrypted logical export in a separate failure
   domain when policy requires it.
2. Enable retention/versioning policies appropriate to the private file and
   archive buckets. Alert on unauthorized deletion and retention-policy changes.
3. Record custom database role definitions separately. Restored managed backups
   do not restore custom-role passwords; rotate/re-provision them afterward.
4. Run a quarterly isolated restore drill. Capture start/end time, selected
   recovery point, row/object counts, migration fingerprint, workflow state,
   application smoke tests, measured RPO/RTO, and cleanup approval.

## Incident restore

1. Declare the recovery point in UTC from audit evidence. Freeze deployments,
   outbox drains, archiver schedules, and business writes before restoring.
2. Prefer restoring/duplicating into an isolated project first. Validate the
   selected backup predates the corruption and quantify expected data loss.
3. Restore through the Supabase Dashboard or approved Management API process.
   Expect downtime on an in-place restore.
4. Re-provision custom runtime-role passwords and update their Secret Manager
   versions. Confirm grants remain least privilege.
5. Compare the Drizzle journal and schema fingerprint with the reviewed release.
   Apply only required forward migrations; never run `test:migrations` against a
   non-loopback database.
6. Reconcile private Storage and archive objects by canonical path, size, MIME,
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
