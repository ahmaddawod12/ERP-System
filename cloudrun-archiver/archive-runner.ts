import { randomUUID } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import {
  claimArchiveRunLease,
  completeArchiverRun,
  deleteArchiverRecordsChunk,
  failArchiveRunLease,
  listArchiverCandidates,
  listArchiverPage,
  recordArchiverUploadedRun,
  releaseEmptyArchiveRunLease,
  renewArchiveRunLease,
  type ArchiveDataType,
  type ArchiveLeaseClaim,
  type ArchiverCandidate,
  type ArchiverCompany,
  type ArchiverPageRecord,
} from '@smart-job/db';

import {
  createArchivePayloadFiles,
  loadVerifiedIdManifest,
  uploadArchivePairCreateOnly,
  verifyArchiveObject,
} from './archive-files';
import { getTargetMonth } from './archive-month';

const DELETE_CHUNK_SIZE = 500;
const MAX_JOB_DEADLINE_MS = 59 * 60 * 1000;

export interface ArchiveRunnerConfig {
  readonly bucketName: string;
  readonly pageSize: number;
  readonly companyConcurrency: number;
  readonly leaseSeconds: number;
  readonly jobDeadlineMs: number;
  readonly monthsLookback: number;
  readonly candidateLimit: number;
}

export interface ArchiveRunLogger {
  log(message?: unknown, ...optional: unknown[]): void;
  warn(message?: unknown, ...optional: unknown[]): void;
  error(message?: unknown, ...optional: unknown[]): void;
}

export interface ArchiveRunnerSummary {
  readonly targetKey: string;
  readonly companyCount: number;
  readonly completedCompanies: number;
  readonly failedCompanies: number;
  readonly failures: ReadonlyArray<{ readonly publicCompanyId: string; readonly message: string }>;
}

interface ArchiveDependencies {
  listCandidates(cutoffEnd: Date, limit: number): Promise<ArchiverCandidate[]>;
  claim(input: Parameters<typeof claimArchiveRunLease>[0]): Promise<ArchiveLeaseClaim>;
  renew(leaseId: string, leaseToken: string, leaseSeconds: number): Promise<unknown>;
  page(input: Parameters<typeof listArchiverPage>[0]): Promise<ArchiverPageRecord[]>;
  record(input: Parameters<typeof recordArchiverUploadedRun>[0]): Promise<{
    readonly runId: string;
    readonly docCount: number;
    readonly deleteCursor: number;
    readonly status: string;
  }>;
  deleteChunk(input: Parameters<typeof deleteArchiverRecordsChunk>[0]): Promise<{
    readonly deleteCursor: number;
  }>;
  complete(leaseId: string, leaseToken: string): Promise<boolean>;
  releaseEmpty(leaseId: string, leaseToken: string): Promise<boolean>;
  fail(leaseId: string, leaseToken: string, error: string): Promise<boolean>;
  now(): Date;
  newLeaseToken(): string;
}

const defaultDependencies: ArchiveDependencies = {
  listCandidates: (cutoffEnd, limit) => listArchiverCandidates(cutoffEnd, limit),
  claim: (input) => claimArchiveRunLease(input),
  renew: (leaseId, leaseToken, leaseSeconds) => renewArchiveRunLease(
    leaseId,
    leaseToken,
    leaseSeconds,
  ),
  page: (input) => listArchiverPage(input),
  record: (input) => recordArchiverUploadedRun(input),
  deleteChunk: (input) => deleteArchiverRecordsChunk(input),
  complete: (leaseId, leaseToken) => completeArchiverRun(leaseId, leaseToken),
  releaseEmpty: (leaseId, leaseToken) => releaseEmptyArchiveRunLease(leaseId, leaseToken),
  fail: (leaseId, leaseToken, error) => failArchiveRunLease(leaseId, leaseToken, error),
  now: () => new Date(),
  newLeaseToken: () => randomUUID(),
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function readArchiveRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArchiveRunnerConfig {
  const bucketName = String(env.ARCHIVE_BUCKET || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/.test(bucketName)) {
    throw new Error('ARCHIVE_BUCKET is required and must be a valid bucket name');
  }
  return {
    bucketName,
    pageSize: boundedInteger(env.ARCHIVER_QUERY_PAGE_SIZE, 500, 1, 500, 'ARCHIVER_QUERY_PAGE_SIZE'),
    companyConcurrency: boundedInteger(
      env.ARCHIVER_COMPANY_CONCURRENCY,
      2,
      1,
      4,
      'ARCHIVER_COMPANY_CONCURRENCY',
    ),
    leaseSeconds: boundedInteger(
      env.ARCHIVER_LEASE_SECONDS,
      3600,
      60,
      3600,
      'ARCHIVER_LEASE_SECONDS',
    ),
    jobDeadlineMs: boundedInteger(
      env.ARCHIVER_JOB_DEADLINE_MS,
      55 * 60 * 1000,
      60_000,
      MAX_JOB_DEADLINE_MS,
      'ARCHIVER_JOB_DEADLINE_MS',
    ),
    monthsLookback: 6,
    candidateLimit: boundedInteger(
      env.ARCHIVER_CANDIDATE_LIMIT,
      2000,
      1,
      2000,
      'ARCHIVER_CANDIDATE_LIMIT',
    ),
  };
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 1000) || 'Archive run failed';
}

function requireResumeMetadata(claim: ArchiveLeaseClaim): {
  readonly storagePath: string;
  readonly checksum: string;
  readonly storageGeneration: string;
  readonly idManifestPath: string;
  readonly idManifestChecksum: string;
  readonly idManifestGeneration: string;
} {
  if (
    !claim.runId
    || claim.docCount < 1
    || !claim.storagePath
    || !claim.checksum
    || !claim.storageGeneration
    || !claim.idManifestPath
    || !claim.idManifestChecksum
    || !claim.idManifestGeneration
  ) {
    throw new Error('Recorded archive run is missing immutable object metadata');
  }
  return {
    storagePath: claim.storagePath,
    checksum: claim.checksum,
    storageGeneration: claim.storageGeneration,
    idManifestPath: claim.idManifestPath,
    idManifestChecksum: claim.idManifestChecksum,
    idManifestGeneration: claim.idManifestGeneration,
  };
}

function assertWithinDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) {
    throw new Error('Archive job reached its bounded execution deadline');
  }
}

async function processArchiveType(input: {
  readonly company: ArchiverCompany;
  readonly dataType: ArchiveDataType;
  readonly target: Pick<ReturnType<typeof getTargetMonth>, 'year' | 'month' | 'startDate' | 'endDate'>;
  readonly bucket: Bucket;
  readonly config: ArchiveRunnerConfig;
  readonly dependencies: ArchiveDependencies;
  readonly deadlineAt: number;
  readonly logger: ArchiveRunLogger;
}): Promise<'completed' | 'empty' | 'leased'> {
  const { company, dataType, target, bucket, config, dependencies, deadlineAt, logger } = input;
  assertWithinDeadline(deadlineAt);
  const monthKey = `${target.year}-${String(target.month).padStart(2, '0')}`;
  const leaseToken = dependencies.newLeaseToken();
  const claim = await dependencies.claim({
    internalCompanyId: company.internalCompanyId,
    archiveKey: monthKey,
    dataType,
    periodStart: target.startDate,
    periodEnd: target.endDate,
    snapshotAt: dependencies.now(),
    leaseToken,
    leaseSeconds: config.leaseSeconds,
  });

  if (!claim.claimed) {
    logger.log('Archive lease is already held by another task', {
      publicCompanyId: company.publicCompanyId,
      dataType,
      archiveKey: claim.archiveKey,
    });
    return 'leased';
  }

  try {
    let docCount = claim.docCount;
    let deleteCursor = claim.deleteCursor;
    let metadata: ReturnType<typeof requireResumeMetadata>;

    if (claim.runId) {
      metadata = requireResumeMetadata(claim);
      await verifyArchiveObject({
        bucket,
        path: metadata.storagePath,
        checksum: metadata.checksum,
        generation: metadata.storageGeneration,
        docCount,
        archiveKey: claim.archiveKey,
        objectKind: 'records',
      });
    } else {
      const payload = await createArchivePayloadFiles({
        archiveKey: claim.archiveKey,
        pageSize: config.pageSize,
        renewLease: async () => {
          assertWithinDeadline(deadlineAt);
          await dependencies.renew(claim.leaseId, leaseToken, config.leaseSeconds);
        },
        loadPage: (afterCursorAt, afterId) => dependencies.page({
          dataType,
          leaseId: claim.leaseId,
          leaseToken,
          afterCursorAt,
          afterId,
          pageSize: config.pageSize,
        }),
      });
      try {
        if (payload.docCount === 0) {
          const released = await dependencies.releaseEmpty(claim.leaseId, leaseToken);
          if (!released) throw new Error('Empty archive lease could not be released');
          logger.log('Archive snapshot was empty; month remains open for late rows', {
            publicCompanyId: company.publicCompanyId,
            dataType,
            archiveKey: claim.archiveKey,
          });
          return 'empty';
        }

        const prefix = `companies/${company.publicCompanyId}/archives/${claim.archiveKey}`;
        const stored = await uploadArchivePairCreateOnly({
          bucket,
          archiveKey: claim.archiveKey,
          storagePath: `${prefix}.json`,
          idManifestPath: `${prefix}.ids.json`,
          payload,
        });
        const recorded = await dependencies.record({
          leaseId: claim.leaseId,
          leaseToken,
          docCount: payload.docCount,
          storagePath: stored.data.path,
          checksum: stored.data.checksum,
          storageGeneration: stored.data.generation,
          idManifestPath: stored.ids.path,
          idManifestChecksum: stored.ids.checksum,
          idManifestGeneration: stored.ids.generation,
        });
        docCount = recorded.docCount;
        deleteCursor = recorded.deleteCursor;
        metadata = {
          storagePath: stored.data.path,
          checksum: stored.data.checksum,
          storageGeneration: stored.data.generation,
          idManifestPath: stored.ids.path,
          idManifestChecksum: stored.ids.checksum,
          idManifestGeneration: stored.ids.generation,
        };
      } finally {
        await payload.cleanup();
      }
    }

    assertWithinDeadline(deadlineAt);
    const sourceIds = await loadVerifiedIdManifest({
      bucket,
      path: metadata.idManifestPath,
      checksum: metadata.idManifestChecksum,
      generation: metadata.idManifestGeneration,
      docCount,
      archiveKey: claim.archiveKey,
    });
    if (deleteCursor > sourceIds.length) {
      throw new Error('Archive delete cursor exceeds the verified ID manifest');
    }

    while (deleteCursor < sourceIds.length) {
      assertWithinDeadline(deadlineAt);
      await dependencies.renew(claim.leaseId, leaseToken, config.leaseSeconds);
      const sourceIdChunk = sourceIds.slice(deleteCursor, deleteCursor + DELETE_CHUNK_SIZE);
      const deletion = await dependencies.deleteChunk({
        leaseId: claim.leaseId,
        leaseToken,
        expectedCursor: deleteCursor,
        sourceIds: sourceIdChunk,
      });
      if (deletion.deleteCursor <= deleteCursor || deletion.deleteCursor > sourceIds.length) {
        throw new Error('Archive deletion returned a non-progressing cursor');
      }
      deleteCursor = deletion.deleteCursor;
    }

    const completed = await dependencies.complete(claim.leaseId, leaseToken);
    if (!completed) throw new Error('Archive run could not be completed');
    logger.log('Immutable archive segment completed', {
      publicCompanyId: company.publicCompanyId,
      dataType,
      archiveKey: claim.archiveKey,
      docCount,
      storageGeneration: metadata.storageGeneration,
    });
    return 'completed';
  } catch (error) {
    await dependencies.fail(claim.leaseId, leaseToken, safeError(error)).catch(() => false);
    throw error;
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await work(items[index]);
    }
  });
  await Promise.all(workers);
}

export async function runMonthlyArchives(input: {
  readonly bucket: Bucket;
  readonly config: ArchiveRunnerConfig;
  readonly logger?: ArchiveRunLogger;
  readonly dependencies?: Partial<ArchiveDependencies>;
}): Promise<ArchiveRunnerSummary> {
  const logger = input.logger ?? console;
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const startedAt = Date.now();
  const deadlineAt = startedAt + input.config.jobDeadlineMs;
  const target = getTargetMonth(dependencies.now(), input.config.monthsLookback);
  const targetKey = `${target.year}-${String(target.month).padStart(2, '0')}`;
  const candidates = await dependencies.listCandidates(target.endDate, input.config.candidateLimit);
  const companyCandidates = new Map<string, {
    readonly company: ArchiverCompany;
    readonly periods: ArchiverCandidate[];
  }>();
  for (const candidate of candidates) {
    if (
      candidate.periodEnd.getTime() > target.endDate.getTime()
      || candidate.periodEnd.getTime() <= candidate.periodStart.getTime()
    ) {
      throw new Error('Archive candidate period is outside the retention cutoff');
    }
    const existing = companyCandidates.get(candidate.internalCompanyId);
    if (existing) existing.periods.push(candidate);
    else {
      companyCandidates.set(candidate.internalCompanyId, {
        company: candidate,
        periods: [candidate],
      });
    }
  }
  const companies = [...companyCandidates.values()];
  const failures: Array<{ publicCompanyId: string; message: string }> = [];
  let completedCompanies = 0;

  await mapWithConcurrency(companies, input.config.companyConcurrency, async ({ company, periods }) => {
    try {
      periods.sort((left, right) => (
        left.periodStart.getTime() - right.periodStart.getTime()
        || (left.dataType === right.dataType ? 0 : left.dataType === 'documents' ? -1 : 1)
      ));
      for (const period of periods) {
        await processArchiveType({
          company,
          dataType: period.dataType,
          target: {
            year: period.periodStart.getUTCFullYear(),
            month: period.periodStart.getUTCMonth() + 1,
            startDate: period.periodStart,
            endDate: period.periodEnd,
          },
          bucket: input.bucket,
          config: input.config,
          dependencies,
          deadlineAt,
          logger,
        });
      }
      completedCompanies += 1;
    } catch (error) {
      const message = safeError(error);
      failures.push({ publicCompanyId: company.publicCompanyId, message });
      logger.error('Company archive failed', { publicCompanyId: company.publicCompanyId, message });
    }
  });

  return {
    targetKey,
    companyCount: companies.length,
    completedCompanies,
    failedCompanies: failures.length,
    failures,
  };
}
