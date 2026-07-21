import { readFileSync } from 'node:fs';

export const LOCAL_PLATFORM_MARKER = 'smart-job-erp-local-platform-v1';
export const LOCAL_PLATFORM_MARKER_PATH = '/run/secrets/smart_job_local_platform';
export type LocalMarkerReader = (path: string, encoding: BufferEncoding) => string | Buffer;

export function isVerifiedLocalPlatform(
  env: NodeJS.ProcessEnv = process.env,
  readMarker: LocalMarkerReader = readFileSync,
): boolean {
  if (
    env.SMART_JOB_DEPLOYMENT_ENV !== 'local'
    || env.SMART_JOB_LOCAL_PLATFORM !== 'true'
    || env.LOCAL_PLATFORM_MARKER_PATH !== LOCAL_PLATFORM_MARKER_PATH
  ) return false;
  try {
    return String(readMarker(LOCAL_PLATFORM_MARKER_PATH, 'utf8')).trim()
      === LOCAL_PLATFORM_MARKER;
  } catch {
    return false;
  }
}

export function assertArchiverRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  readMarker: LocalMarkerReader = readFileSync,
): { readonly verifiedLocalPlatform: boolean } {
  const localOverridesPresent = env.SMART_JOB_DEPLOYMENT_ENV === 'local'
    || env.SMART_JOB_LOCAL_PLATFORM !== undefined
    || env.LOCAL_PLATFORM_MARKER_PATH !== undefined
    || env.STORAGE_EMULATOR_HOST !== undefined
    || env.ALLOW_LOCAL_ARCHIVER_ADMIN !== undefined;
  if (!localOverridesPresent) return { verifiedLocalPlatform: false };
  if (!isVerifiedLocalPlatform(env, readMarker)) {
    throw new Error('Local archiver overrides require the mounted local-platform marker');
  }
  if (env.STORAGE_EMULATOR_HOST !== 'http://gcs-emulator:4443') {
    throw new Error('Local archiver requires the canonical GCS emulator endpoint');
  }
  if (env.ALLOW_LOCAL_ARCHIVER_ADMIN !== 'true') {
    throw new Error('Local archiver admin access must be explicitly enabled');
  }
  const databaseUrl = new URL(String(env.DATABASE_URL || ''));
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || databaseUrl.hostname !== 'supabase_db_smart-job-erp-local'
    || (databaseUrl.port !== '' && databaseUrl.port !== '5432')
    || databaseUrl.username !== 'postgres'
  ) {
    throw new Error('Local archiver admin access is restricted to the repository-owned Supabase database');
  }
  if (env.DATABASE_SSL_MODE !== 'disable') {
    throw new Error('Local archiver database SSL mode must be disable');
  }
  return { verifiedLocalPlatform: true };
}
