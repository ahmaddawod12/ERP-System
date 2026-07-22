# Archive restore

Monthly archives are immutable JSON record segments plus companion ID manifests
in GCS. Database archive-run metadata records canonical paths, generations,
counts, and SHA-256 checksums. The public archive API is read-only; there is no
generic production rehydration endpoint.

## Retrieval validation

1. Identify the exact company, month, data type, archive run/segment, object
   generation, record count, and expected checksums from `archive_runs`.
2. Freeze the archiver for that company/month/type if a concurrent recovery
   could overlap an active lease. Do not delete or overwrite archive objects.
3. Download the exact recorded generations to an encrypted, access-controlled
   recovery workspace. Verify object metadata, SHA-256 bytes, JSON shape, record
   count, companion ID count, UUID validity/uniqueness, and one-to-one ordering.
4. Confirm the archive belongs to the requested tenant and that the requesting
   role may access the data type. The API's authorized archive download route is
   suitable for read-only customer retrieval but not database rehydration.

## Controlled rehydration

1. Restore into isolated staging tables/project first. Build a reviewed,
   one-purpose recovery migration for the exact schema version and data type.
2. Resolve canonical IDs and foreign keys without allocating replacement
   sequential numbers. Reject conflicts, malformed tenant ownership, missing
   parents, and duplicate rows; never silently overwrite live records.
3. Compare the staged IDs with the verified companion manifest and reconcile
   documents/jobs, attachment paths, inventory references, and sync versions.
4. Test API tenant isolation and representative reads in isolation. Obtain data
   owner and incident commander approval before a production transaction.
5. Import in bounded transactions with an audit record, then bump only the
   affected sync versions through canonical helpers. Keep archive objects and
   run metadata unchanged as evidence.

If the source schema cannot be mapped deterministically, stop and recover a
database backup/PITR point instead. Never use an unverified fresh source query
to infer what an archived segment deleted.
