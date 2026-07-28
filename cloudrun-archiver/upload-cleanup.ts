import { Storage, type Bucket } from '@google-cloud/storage';
import {
  claimFileUploadCleanupBatch,
  finishFileUploadCleanup,
  queueExpiredFileUploadCleanup,
  type FileUploadCleanupClaim,
} from '@smart-job/db';

const CANONICAL_BUCKET = 'smart-job-company-files';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const MAX_OBJECTS_PER_SESSION = 20;

export interface UploadCleanupConfig {
  readonly projectId?: string;
  readonly bucketId: string;
  readonly apiEndpoint?: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly concurrency: number;
}

export interface UploadCleanupFailure {
  readonly sessionId: string | null;
  readonly stage: 'configuration' | 'queue' | 'claim' | 'validation' | 'delete' | 'finish';
  readonly message: string;
}

export interface UploadCleanupSummary {
  readonly skipped: boolean;
  readonly queueResult: Readonly<Record<string, unknown>> | null;
  readonly claimed: number;
  readonly completed: number;
  readonly requeued: number;
  readonly deadLettered: number;
  readonly stale: number;
  readonly failures: readonly UploadCleanupFailure[];
}

export interface UploadCleanupLogger {
  log(message?: unknown, ...optional: unknown[]): void;
  warn(message?: unknown, ...optional: unknown[]): void;
  error(message?: unknown, ...optional: unknown[]): void;
}

export interface UploadCleanupDatabase {
  queue(): Promise<Record<string, unknown>>;
  claim(limit: number, leaseSeconds: number): Promise<FileUploadCleanupClaim[]>;
  finish(input: {
    sessionId: string;
    attemptCount: number;
    succeeded: boolean;
    error: string | null;
  }): Promise<Record<string, unknown>>;
}

const defaultDatabase: UploadCleanupDatabase = {
  queue: queueExpiredFileUploadCleanup,
  claim: claimFileUploadCleanupBatch,
  finish: finishFileUploadCleanup,
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function readUploadCleanupConfig(
  env: NodeJS.ProcessEnv = process.env,
): UploadCleanupConfig {
  const bucketId = String(env.COMPANY_FILES_BUCKET || '').trim();
  if (bucketId !== CANONICAL_BUCKET) {
    throw new Error(`COMPANY_FILES_BUCKET must be ${CANONICAL_BUCKET}`);
  }
  const apiEndpoint = String(env.GCS_API_ENDPOINT || '').trim();
  return {
    bucketId,
    ...(String(env.GCS_PROJECT_ID || '').trim()
      ? { projectId: String(env.GCS_PROJECT_ID).trim() }
      : {}),
    ...(apiEndpoint ? { apiEndpoint } : {}),
    batchSize: boundedInteger(env.UPLOAD_CLEANUP_BATCH_SIZE, 25, 1, 100, 'UPLOAD_CLEANUP_BATCH_SIZE'),
    leaseSeconds: boundedInteger(env.UPLOAD_CLEANUP_LEASE_SECONDS, 300, 30, 900, 'UPLOAD_CLEANUP_LEASE_SECONDS'),
    concurrency: boundedInteger(env.UPLOAD_CLEANUP_CONCURRENCY, 4, 1, 10, 'UPLOAD_CLEANUP_CONCURRENCY'),
  };
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500) || 'upload cleanup failed';
}

function assertCanonicalClaim(claim: FileUploadCleanupClaim): void {
  if (claim.bucketId !== CANONICAL_BUCKET || claim.objectPaths.length > MAX_OBJECTS_PER_SESSION) {
    throw new Error('cleanup claim bucket or object count is invalid');
  }
  const pathPattern = new RegExp(
    `^${UUID_SOURCE}/${UUID_SOURCE}/${claim.sessionId}/${UUID_SOURCE}\\.(jpg|png|webp|heic|heif)$`,
  );
  if (
    claim.objectPaths.length < 1
    || new Set(claim.objectPaths).size !== claim.objectPaths.length
    || claim.objectPaths.some((path) => !pathPattern.test(path))
  ) {
    throw new Error('cleanup claim contains a non-canonical session object path');
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        if (item !== undefined) await work(item);
      }
    },
  ));
}

export async function runUploadCleanup(
  config: UploadCleanupConfig,
  dependencies: {
    readonly database?: UploadCleanupDatabase;
    readonly bucket?: Pick<Bucket, 'file'>;
  } = {},
): Promise<UploadCleanupSummary> {
  const database = dependencies.database ?? defaultDatabase;
  const bucket = dependencies.bucket ?? new Storage({
    ...(config.projectId ? { projectId: config.projectId } : {}),
    ...(config.apiEndpoint
      ? { apiEndpoint: config.apiEndpoint, useAuthWithCustomEndpoint: false }
      : {}),
  }).bucket(config.bucketId);
  const failures: UploadCleanupFailure[] = [];
  const queueResult = await database.queue();
  const claims = await database.claim(config.batchSize, config.leaseSeconds);
  let completed = 0;
  let requeued = 0;
  let deadLettered = 0;
  let stale = 0;

  await mapWithConcurrency(claims, config.concurrency, async (claim) => {
    let succeeded = false;
    let failure: string | null = null;
    try {
      assertCanonicalClaim(claim);
      await Promise.all(claim.objectPaths.map((path) =>
        bucket.file(path).delete({ ignoreNotFound: true }).then(() => undefined)
      ));
      succeeded = true;
    } catch (error) {
      failure = safeErrorMessage(error);
      failures.push({
        sessionId: claim.sessionId,
        stage: failure.includes('non-canonical') ? 'validation' : 'delete',
        message: failure,
      });
    }
    try {
      const result = await database.finish({
        sessionId: claim.sessionId,
        attemptCount: claim.attemptCount,
        succeeded,
        error: failure,
      });
      if (result.outcome === 'cleanup_complete') completed += 1;
      else if (result.outcome === 'cleanup_pending') requeued += 1;
      else if (result.outcome === 'cleanup_failed') deadLettered += 1;
      else stale += 1;
    } catch (error) {
      failures.push({
        sessionId: claim.sessionId,
        stage: 'finish',
        message: safeErrorMessage(error),
      });
    }
  });

  return {
    skipped: false,
    queueResult,
    claimed: claims.length,
    completed,
    requeued,
    deadLettered,
    stale,
    failures,
  };
}

export async function runUploadCleanupStartup(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: UploadCleanupLogger;
} = {}): Promise<UploadCleanupSummary | null> {
  const logger = options.logger ?? console;
  try {
    const summary = await runUploadCleanup(readUploadCleanupConfig(options.env));
    logger.log('Upload cleanup startup phase completed', summary);
    for (const failure of summary.failures) logger.error('Upload cleanup item failed', failure);
    return summary;
  } catch (error) {
    logger.error('Upload cleanup startup phase failed; monthly archives will continue', {
      message: safeErrorMessage(error),
    });
    return null;
  }
}
