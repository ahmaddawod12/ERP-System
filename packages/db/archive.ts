import { sql } from 'drizzle-orm';
import { getDb } from './client';

export type ArchiveDataType = 'jobs' | 'documents';

export interface ArchiverCompany {
  readonly internalCompanyId: string;
  readonly publicCompanyId: string;
}

export interface ArchiverCandidate extends ArchiverCompany {
  readonly dataType: ArchiveDataType;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface ArchiveLeaseClaim {
  readonly leaseId: string;
  readonly claimed: boolean;
  readonly attemptCount: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly snapshotAt: string;
  readonly leaseUntil: string;
  readonly segment: number;
  readonly archiveKey: string;
  readonly runId: string | null;
  readonly runStatus: string | null;
  readonly docCount: number;
  readonly deleteCursor: number;
  readonly storagePath: string | null;
  readonly checksum: string | null;
  readonly storageGeneration: string | null;
  readonly idManifestPath: string | null;
  readonly idManifestChecksum: string | null;
  readonly idManifestGeneration: string | null;
}

export interface ArchiverPageRecord {
  readonly sourceId: string;
  readonly cursorAt: string;
  readonly record: Record<string, unknown>;
}

export interface RecordedArchiveRun {
  readonly runId: string;
  readonly docCount: number;
  readonly deleteCursor: number;
  readonly status: string;
}

export interface ArchiveDeleteResult {
  readonly runId: string;
  readonly deleteCursor: number;
  readonly processedCount: number;
  readonly replayed: boolean;
}

interface DbOptions {
  readonly db?: ReturnType<typeof getDb>;
  readonly env?: NodeJS.ProcessEnv;
}

function database(options: DbOptions) {
  return options.db ?? getDb(options.env);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${label} returned an invalid object`);
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is missing`);
  return normalized;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function requiredDate(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(requiredString(value, label));
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function mapClaim(value: unknown): ArchiveLeaseClaim {
  const row = objectValue(value, 'Archive lease claim');
  return {
    leaseId: requiredString(row.leaseId, 'leaseId'),
    claimed: row.claimed === true,
    attemptCount: nonNegativeInteger(row.attemptCount, 'attemptCount'),
    periodStart: requiredString(row.periodStart, 'periodStart'),
    periodEnd: requiredString(row.periodEnd, 'periodEnd'),
    snapshotAt: requiredString(row.snapshotAt, 'snapshotAt'),
    leaseUntil: requiredString(row.leaseUntil, 'leaseUntil'),
    segment: nonNegativeInteger(row.segment, 'segment'),
    archiveKey: requiredString(row.archiveKey, 'archiveKey'),
    runId: nullableString(row.runId),
    runStatus: nullableString(row.runStatus),
    docCount: nonNegativeInteger(row.docCount, 'docCount'),
    deleteCursor: nonNegativeInteger(row.deleteCursor, 'deleteCursor'),
    storagePath: nullableString(row.storagePath),
    checksum: nullableString(row.checksum),
    storageGeneration: nullableString(row.storageGeneration),
    idManifestPath: nullableString(row.idManifestPath),
    idManifestChecksum: nullableString(row.idManifestChecksum),
    idManifestGeneration: nullableString(row.idManifestGeneration),
  };
}

export async function listArchiverCompanies(options: DbOptions = {}): Promise<ArchiverCompany[]> {
  const result = await database(options).execute(sql`
    SELECT company_id, public_company_id
    FROM private.list_archiver_companies()
  `);
  return (result.rows ?? []).map((row) => ({
    internalCompanyId: requiredString(row.company_id, 'companyId').toLowerCase(),
    publicCompanyId: requiredString(row.public_company_id, 'publicCompanyId'),
  }));
}

export async function listArchiverCandidates(
  cutoffEnd: Date,
  limit: number,
  options: DbOptions = {},
): Promise<ArchiverCandidate[]> {
  const result = await database(options).execute(sql`
    SELECT company_id, public_company_id, data_type, period_start, period_end
    FROM private.list_archiver_candidates(
      ${cutoffEnd}::timestamptz,
      ${limit}::integer
    )
  `);
  return (result.rows ?? []).map((row) => {
    if (row.data_type !== 'jobs' && row.data_type !== 'documents') {
      throw new TypeError('Archive candidate dataType is invalid');
    }
    return {
      internalCompanyId: requiredString(row.company_id, 'companyId').toLowerCase(),
      publicCompanyId: requiredString(row.public_company_id, 'publicCompanyId'),
      dataType: row.data_type,
      periodStart: requiredDate(row.period_start, 'periodStart'),
      periodEnd: requiredDate(row.period_end, 'periodEnd'),
    };
  });
}

export async function claimArchiveRunLease(input: {
  readonly internalCompanyId: string;
  readonly archiveKey: string;
  readonly dataType: ArchiveDataType;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly snapshotAt: Date;
  readonly leaseToken: string;
  readonly leaseSeconds: number;
}, options: DbOptions = {}): Promise<ArchiveLeaseClaim> {
  const result = await database(options).execute(sql`
    SELECT private.claim_archive_run_lease(
      ${input.internalCompanyId}::uuid,
      ${input.archiveKey}::text,
      ${input.dataType}::text,
      ${input.periodStart}::timestamptz,
      ${input.periodEnd}::timestamptz,
      ${input.snapshotAt}::timestamptz,
      ${input.leaseToken}::uuid,
      ${input.leaseSeconds}::integer
    ) AS claim
  `);
  return mapClaim(result.rows?.[0]?.claim);
}

export async function renewArchiveRunLease(
  leaseId: string,
  leaseToken: string,
  leaseSeconds: number,
  options: DbOptions = {},
): Promise<Date> {
  const result = await database(options).execute(sql`
    SELECT private.renew_archive_run_lease(
      ${leaseId}::uuid, ${leaseToken}::uuid, ${leaseSeconds}::integer
    ) AS lease_until
  `);
  const leaseUntil = new Date(requiredString(result.rows?.[0]?.lease_until, 'leaseUntil'));
  if (!Number.isFinite(leaseUntil.getTime())) throw new TypeError('leaseUntil is invalid');
  return leaseUntil;
}

export async function listArchiverPage(input: {
  readonly dataType: ArchiveDataType;
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly afterCursorAt?: Date | null;
  readonly afterId?: string | null;
  readonly pageSize: number;
}, options: DbOptions = {}): Promise<ArchiverPageRecord[]> {
  const db = database(options);
  const values = input.dataType === 'jobs'
    ? await db.execute(sql`
        SELECT source_id, cursor_at, record
        FROM private.read_archiver_jobs_page(
          ${input.leaseId}::uuid,
          ${input.leaseToken}::uuid,
          ${input.afterCursorAt ?? null}::timestamptz,
          ${input.afterId ?? null}::uuid,
          ${input.pageSize}::integer
        )
      `)
    : await db.execute(sql`
        SELECT source_id, cursor_at, record
        FROM private.read_archiver_documents_page(
          ${input.leaseId}::uuid,
          ${input.leaseToken}::uuid,
          ${input.afterCursorAt ?? null}::timestamptz,
          ${input.afterId ?? null}::uuid,
          ${input.pageSize}::integer
        )
      `);
  return (values.rows ?? []).map((row) => ({
    sourceId: requiredString(row.source_id, 'sourceId').toLowerCase(),
    cursorAt: requiredString(row.cursor_at, 'cursorAt'),
    record: objectValue(row.record, 'Archive page record'),
  }));
}

export async function recordArchiverUploadedRun(input: {
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly docCount: number;
  readonly storagePath: string;
  readonly checksum: string;
  readonly storageGeneration: string;
  readonly idManifestPath: string;
  readonly idManifestChecksum: string;
  readonly idManifestGeneration: string;
}, options: DbOptions = {}): Promise<RecordedArchiveRun> {
  const result = await database(options).execute(sql`
    SELECT private.record_archiver_uploaded_run(
      ${input.leaseId}::uuid,
      ${input.leaseToken}::uuid,
      ${input.docCount}::integer,
      ${input.storagePath}::text,
      ${input.checksum}::text,
      ${input.storageGeneration}::bigint,
      ${input.idManifestPath}::text,
      ${input.idManifestChecksum}::text,
      ${input.idManifestGeneration}::bigint
    ) AS run
  `);
  const row = objectValue(result.rows?.[0]?.run, 'Uploaded archive run');
  return {
    runId: requiredString(row.runId, 'runId'),
    docCount: nonNegativeInteger(row.docCount, 'docCount'),
    deleteCursor: nonNegativeInteger(row.deleteCursor, 'deleteCursor'),
    status: requiredString(row.status, 'status'),
  };
}

export async function deleteArchiverRecordsChunk(input: {
  readonly leaseId: string;
  readonly leaseToken: string;
  readonly expectedCursor: number;
  readonly sourceIds: readonly string[];
}, options: DbOptions = {}): Promise<ArchiveDeleteResult> {
  const result = await database(options).execute(sql`
    SELECT private.delete_archiver_records_chunk(
      ${input.leaseId}::uuid,
      ${input.leaseToken}::uuid,
      ${input.expectedCursor}::integer,
      ${[...input.sourceIds]}::uuid[]
    ) AS deletion
  `);
  const row = objectValue(result.rows?.[0]?.deletion, 'Archive deletion');
  return {
    runId: requiredString(row.runId, 'runId'),
    deleteCursor: nonNegativeInteger(row.deleteCursor, 'deleteCursor'),
    processedCount: nonNegativeInteger(row.processedCount, 'processedCount'),
    replayed: row.replayed === true,
  };
}

export async function completeArchiverRun(
  leaseId: string,
  leaseToken: string,
  options: DbOptions = {},
): Promise<boolean> {
  const result = await database(options).execute(sql`
    SELECT private.complete_archiver_run(${leaseId}::uuid, ${leaseToken}::uuid) AS completed
  `);
  return result.rows?.[0]?.completed === true;
}

export async function releaseEmptyArchiveRunLease(
  leaseId: string,
  leaseToken: string,
  options: DbOptions = {},
): Promise<boolean> {
  const result = await database(options).execute(sql`
    SELECT private.release_empty_archive_run_lease(
      ${leaseId}::uuid, ${leaseToken}::uuid
    ) AS released
  `);
  return result.rows?.[0]?.released === true;
}

export async function failArchiveRunLease(
  leaseId: string,
  leaseToken: string,
  error: string,
  options: DbOptions = {},
): Promise<boolean> {
  const result = await database(options).execute(sql`
    SELECT private.finish_archive_run_lease(
      ${leaseId}::uuid, ${leaseToken}::uuid, false, ${error}::text
    ) AS failed
  `);
  return result.rows?.[0]?.failed === true;
}
