import { isVerifiedLocalPlatform, type LocalMarkerReader } from './local-platform';

const CANONICAL_BUCKET = 'smart-job-company-files';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`);
const MAX_OBJECTS_PER_SESSION = 20;

type FetchLike = typeof fetch;

export interface UploadCleanupConfig {
  readonly supabaseOrigin: string;
  readonly secretKey: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

export interface UploadCleanupClaim {
  readonly sessionId: string;
  readonly bucketId: string;
  readonly objectPaths: readonly string[];
  readonly leaseExpiresAt: string;
  readonly attemptCount: number;
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

interface RawClaim {
  readonly session_id?: unknown;
  readonly bucket_id?: unknown;
  readonly object_paths?: unknown;
  readonly lease_expires_at?: unknown;
  readonly attempt_count?: unknown;
}

interface FinishResult {
  readonly outcome?: unknown;
  readonly status?: unknown;
  readonly attemptCount?: unknown;
}

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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

function parseSupabaseOrigin(rawValue: string, verifiedLocalPlatform = false): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('SUPABASE_URL must be an absolute URL');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SUPABASE_URL must not include credentials, a query, or a fragment');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('SUPABASE_URL must contain only the project origin');
  }
  const localService = verifiedLocalPlatform
    && parsed.protocol === 'http:'
    && parsed.hostname === 'smart-job-supabase-gateway'
    && parsed.port === '8000';
  if (
    parsed.protocol !== 'https:'
    && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))
    && !localService
  ) {
    throw new Error('SUPABASE_URL must use HTTPS except for a loopback local stack');
  }
  return parsed.origin;
}

export function readUploadCleanupConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly readLocalMarker?: LocalMarkerReader } = {},
): UploadCleanupConfig | null {
  const rawUrl = String(env.SUPABASE_URL || '').trim();
  const secretKey = String(env.SUPABASE_SECRET_KEY || '').trim();
  if (!rawUrl && !secretKey) return null;
  if (!rawUrl || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured together');
  }
  if (!secretKey.startsWith('sb_secret_')) {
    throw new Error('SUPABASE_SECRET_KEY must use the server-only sb_secret_ key format');
  }
  const localFlagsPresent = env.SMART_JOB_DEPLOYMENT_ENV === 'local'
    || env.SMART_JOB_LOCAL_PLATFORM !== undefined
    || env.LOCAL_PLATFORM_MARKER_PATH !== undefined;
  const verifiedLocalPlatform = isVerifiedLocalPlatform(env, options.readLocalMarker);
  if (localFlagsPresent && !verifiedLocalPlatform) {
    throw new Error('Local upload cleanup overrides require the mounted local-platform marker');
  }

  return {
    supabaseOrigin: parseSupabaseOrigin(rawUrl, verifiedLocalPlatform),
    secretKey,
    batchSize: boundedInteger(
      env.UPLOAD_CLEANUP_BATCH_SIZE,
      25,
      1,
      100,
      'UPLOAD_CLEANUP_BATCH_SIZE',
    ),
    leaseSeconds: boundedInteger(
      env.UPLOAD_CLEANUP_LEASE_SECONDS,
      300,
      30,
      900,
      'UPLOAD_CLEANUP_LEASE_SECONDS',
    ),
    concurrency: boundedInteger(
      env.UPLOAD_CLEANUP_CONCURRENCY,
      4,
      1,
      10,
      'UPLOAD_CLEANUP_CONCURRENCY',
    ),
    timeoutMs: boundedInteger(
      env.UPLOAD_CLEANUP_HTTP_TIMEOUT_MS,
      10_000,
      1_000,
      12_000,
      'UPLOAD_CLEANUP_HTTP_TIMEOUT_MS',
    ),
  };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500) || 'upload cleanup failed';
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

async function requestSupabase(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike,
  path: string,
  method: 'POST' | 'DELETE',
  body: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const url = new URL(path, `${config.supabaseOrigin}/`);
  if (url.origin !== config.supabaseOrigin) {
    throw new Error('Supabase request escaped the configured project origin');
  }
  const response = await fetchImpl(url, {
    method,
    redirect: 'error',
    headers: {
      apikey: config.secretKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    const detail = typeof responseBody === 'string'
      ? responseBody
      : JSON.stringify(responseBody);
    throw new Error(`Supabase ${method} ${url.pathname} returned HTTP ${response.status}: ${detail}`);
  }
  return responseBody;
}

function parseClaim(rawValue: unknown): UploadCleanupClaim {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new Error('cleanup claim must be an object');
  }
  const raw = rawValue as RawClaim;
  if (typeof raw.session_id !== 'string' || !UUID_PATTERN.test(raw.session_id)) {
    throw new Error('cleanup claim session_id is invalid');
  }
  if (raw.bucket_id !== CANONICAL_BUCKET) {
    throw new Error('cleanup claim bucket_id is invalid');
  }
  if (
    !Array.isArray(raw.object_paths)
    || raw.object_paths.length < 1
    || raw.object_paths.length > MAX_OBJECTS_PER_SESSION
    || raw.object_paths.some((path) => typeof path !== 'string')
  ) {
    throw new Error('cleanup claim object_paths is invalid');
  }
  if (new Set(raw.object_paths).size !== raw.object_paths.length) {
    throw new Error('cleanup claim object_paths contains duplicates');
  }
  if (typeof raw.lease_expires_at !== 'string' || Number.isNaN(Date.parse(raw.lease_expires_at))) {
    throw new Error('cleanup claim lease_expires_at is invalid');
  }
  if (
    typeof raw.attempt_count !== 'number'
    || !Number.isSafeInteger(raw.attempt_count)
    || raw.attempt_count < 1
    || raw.attempt_count > 5
  ) {
    throw new Error('cleanup claim attempt_count is invalid');
  }
  return {
    sessionId: raw.session_id,
    bucketId: raw.bucket_id,
    objectPaths: raw.object_paths as string[],
    leaseExpiresAt: raw.lease_expires_at,
    attemptCount: Number(raw.attempt_count),
  };
}

function assertCanonicalClaimPaths(claim: UploadCleanupClaim): void {
  if (claim.bucketId !== CANONICAL_BUCKET) {
    throw new Error('cleanup claim is not in the canonical company-file bucket');
  }
  const objectPathPattern = new RegExp(
    `^${UUID_SOURCE}/${UUID_SOURCE}/${claim.sessionId}/${UUID_SOURCE}\\.(jpg|png|webp|heic|heif)$`,
  );
  for (const objectPath of claim.objectPaths) {
    if (!objectPathPattern.test(objectPath)) {
      throw new Error('cleanup claim contains a non-canonical session object path');
    }
  }
}

async function queueExpiredSessions(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike,
): Promise<Readonly<Record<string, unknown>>> {
  const result = await requestSupabase(
    config,
    fetchImpl,
    '/rest/v1/rpc/queue_expired_file_upload_cleanup',
    'POST',
    {},
  );
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('queue_expired_file_upload_cleanup returned a malformed response');
  }
  return result as Readonly<Record<string, unknown>>;
}

async function claimCleanupBatch(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike,
): Promise<UploadCleanupClaim[]> {
  const result = await requestSupabase(
    config,
    fetchImpl,
    '/rest/v1/rpc/claim_file_upload_cleanup_batch',
    'POST',
    {
      p_limit: config.batchSize,
      p_lease_seconds: config.leaseSeconds,
    },
  );
  if (!Array.isArray(result)) {
    throw new Error('claim_file_upload_cleanup_batch returned a malformed response');
  }
  return result.map(parseClaim);
}

async function deleteClaimedObjects(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike,
  claim: UploadCleanupClaim,
): Promise<void> {
  assertCanonicalClaimPaths(claim);
  await requestSupabase(
    config,
    fetchImpl,
    `/storage/v1/object/${encodeURIComponent(CANONICAL_BUCKET)}`,
    'DELETE',
    { prefixes: claim.objectPaths },
  );
}

async function finishClaim(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike,
  claim: UploadCleanupClaim,
  succeeded: boolean,
  error: string | null,
): Promise<FinishResult> {
  const result = await requestSupabase(
    config,
    fetchImpl,
    '/rest/v1/rpc/finish_file_upload_cleanup',
    'POST',
    {
      p_session_id: claim.sessionId,
      p_attempt_count: claim.attemptCount,
      p_succeeded: succeeded,
      p_error: error,
    },
  );
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('finish_file_upload_cleanup returned a malformed response');
  }
  return result as FinishResult;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await work(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

export async function runUploadCleanup(
  config: UploadCleanupConfig,
  fetchImpl: FetchLike = fetch,
): Promise<UploadCleanupSummary> {
  const failures: UploadCleanupFailure[] = [];
  const queueResult = await queueExpiredSessions(config, fetchImpl);
  const claims = await claimCleanupBatch(config, fetchImpl);
  let completed = 0;
  let requeued = 0;
  let deadLettered = 0;
  let stale = 0;

  await mapWithConcurrency(claims, config.concurrency, async (claim) => {
    let deletionSucceeded = false;
    let deletionError: string | null = null;
    let failureStage: UploadCleanupFailure['stage'] = 'delete';
    try {
      assertCanonicalClaimPaths(claim);
      failureStage = 'delete';
      await deleteClaimedObjects(config, fetchImpl, claim);
      deletionSucceeded = true;
    } catch (error) {
      deletionError = safeErrorMessage(error);
      failureStage = deletionError.includes('non-canonical') ? 'validation' : 'delete';
      failures.push({
        sessionId: claim.sessionId,
        stage: failureStage,
        message: deletionError,
      });
    }

    try {
      const finish = await finishClaim(
        config,
        fetchImpl,
        claim,
        deletionSucceeded,
        deletionError,
      );
      if (finish.outcome === 'cleanup_complete') completed += 1;
      else if (finish.outcome === 'cleanup_pending') requeued += 1;
      else if (finish.outcome === 'cleanup_failed') deadLettered += 1;
      else {
        stale += 1;
        failures.push({
          sessionId: claim.sessionId,
          stage: 'finish',
          message: `cleanup acknowledgement was ${String(finish.outcome || 'unknown')}`,
        });
      }
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

export async function runUploadCleanupFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<UploadCleanupSummary> {
  const config = readUploadCleanupConfig(env);
  if (!config) {
    return {
      skipped: true,
      queueResult: null,
      claimed: 0,
      completed: 0,
      requeued: 0,
      deadLettered: 0,
      stale: 0,
      failures: [],
    };
  }
  return runUploadCleanup(config, fetchImpl);
}

export async function runUploadCleanupStartup(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: FetchLike;
  readonly logger?: UploadCleanupLogger;
} = {}): Promise<UploadCleanupSummary | null> {
  const logger = options.logger ?? console;
  try {
    const cleanup = await runUploadCleanupFromEnvironment(
      options.env ?? process.env,
      options.fetchImpl ?? fetch,
    );
    if (cleanup.skipped) {
      logger.warn(
        'Upload cleanup skipped: SUPABASE_URL and SUPABASE_SECRET_KEY are not configured',
      );
      return cleanup;
    }

    logger.log('Upload cleanup startup phase completed', {
      claimed: cleanup.claimed,
      completed: cleanup.completed,
      requeued: cleanup.requeued,
      deadLettered: cleanup.deadLettered,
      stale: cleanup.stale,
      queueResult: cleanup.queueResult,
    });
    for (const failure of cleanup.failures) {
      logger.error('Upload cleanup item failed', failure);
    }
    return cleanup;
  } catch (error) {
    logger.error(
      'Upload cleanup startup phase failed; monthly archives will continue',
      { message: safeErrorMessage(error) },
    );
    return null;
  }
}
