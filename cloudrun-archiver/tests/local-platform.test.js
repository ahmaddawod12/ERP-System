const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { assertArchiverRuntimeConfig } = require('../local-platform');
const { readUploadCleanupConfig } = require('../upload-cleanup');

const marker = () => Buffer.from('smart-job-erp-local-platform-v1');
const localEnvironment = {
  SMART_JOB_DEPLOYMENT_ENV: 'local',
  SMART_JOB_LOCAL_PLATFORM: 'true',
  LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
  STORAGE_EMULATOR_HOST: 'http://gcs-emulator:4443',
  ALLOW_LOCAL_ARCHIVER_ADMIN: 'true',
  DATABASE_URL: 'postgresql://postgres:postgres@supabase_db_smart-job-erp-local:5432/postgres',
  DATABASE_SSL_MODE: 'disable',
};

describe('local archiver safeguards', () => {
  it('accepts only the repository-owned database and emulator with the marker', () => {
    assert.equal(
      assertArchiverRuntimeConfig(localEnvironment, marker).verifiedLocalPlatform,
      true,
    );
    assert.throws(
      () => assertArchiverRuntimeConfig({
        ...localEnvironment,
        DATABASE_URL: 'postgresql://postgres:postgres@other-db:5432/postgres',
      }, marker),
      /repository-owned Supabase database/,
    );
    assert.throws(
      () => assertArchiverRuntimeConfig(localEnvironment, () => Buffer.from('wrong')),
      /mounted local-platform marker/,
    );
  });

  it('allows the internal Supabase cleanup endpoint only with the marker', () => {
    const config = readUploadCleanupConfig({
      ...localEnvironment,
      SUPABASE_URL: 'http://supabase_kong_smart-job-erp-local:8000',
      SUPABASE_SECRET_KEY: 'sb_secret_local_test_only',
    }, { readLocalMarker: marker });
    assert.equal(config.supabaseOrigin, 'http://supabase_kong_smart-job-erp-local:8000');
  });
});
