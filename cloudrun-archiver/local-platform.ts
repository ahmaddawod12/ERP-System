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
    || env.GCS_API_ENDPOINT !== undefined;
  if (env.ALLOW_LOCAL_ARCHIVER_ADMIN !== undefined) {
    throw new Error('ALLOW_LOCAL_ARCHIVER_ADMIN has been removed; use smart_job_archiver');
  }
  const verifiedLocalPlatform = localOverridesPresent
    ? isVerifiedLocalPlatform(env, readMarker)
    : false;
  if (localOverridesPresent && !verifiedLocalPlatform) {
    throw new Error('Local archiver overrides require the mounted local-platform marker');
  }
  const databaseUrl = new URL(String(env.DATABASE_URL || ''));
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || databaseUrl.username !== 'smart_job_archiver'
  ) {
    throw new Error('The archiver DATABASE_URL must authenticate as smart_job_archiver');
  }
  if (String(env.DATABASE_MAX_CONNECTIONS || '') !== '1') {
    throw new Error('The archiver database pool must be limited to one connection');
  }
  if (verifiedLocalPlatform) {
    if (env.GCS_API_ENDPOINT !== 'http://gcs-emulator:4443') {
      throw new Error('Local archiver requires the canonical GCS emulator endpoint');
    }
    if (
      databaseUrl.hostname !== 'smart-job-postgres'
      || (databaseUrl.port !== '' && databaseUrl.port !== '5432')
    ) {
      throw new Error('Local archiver access is restricted to the repository-owned PostgreSQL database');
    }
    if (env.DATABASE_SSL_MODE !== 'disable') {
      throw new Error('Local archiver database SSL mode must be disable');
    }
  } else if (env.GCS_API_ENDPOINT !== undefined) {
    throw new Error('GCS_API_ENDPOINT is forbidden outside the verified local platform');
  }
  return { verifiedLocalPlatform };
}
