const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { assertArchiverRuntimeConfig } = require('../local-platform');
const { readUploadCleanupConfig } = require('../upload-cleanup');

const marker = () => Buffer.from('smart-job-erp-local-platform-v1');
const localEnvironment = {
  SMART_JOB_DEPLOYMENT_ENV: 'local',
  SMART_JOB_LOCAL_PLATFORM: 'true',
  LOCAL_PLATFORM_MARKER_PATH: '/run/secrets/smart_job_local_platform',
  GCS_API_ENDPOINT: 'http://gcs-emulator:4443',
  DATABASE_URL: 'postgresql://smart_job_archiver:password@smart-job-postgres:5432/postgres',
  DATABASE_SSL_MODE: 'disable',
  DATABASE_MAX_CONNECTIONS: '1',
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
        DATABASE_URL: 'postgresql://smart_job_archiver:password@other-db:5432/postgres',
      }, marker),
      /repository-owned PostgreSQL database/,
    );
    assert.throws(
      () => assertArchiverRuntimeConfig(localEnvironment, () => Buffer.from('wrong')),
      /mounted local-platform marker/,
    );
  });

  it('rejects the removed local administrator escape hatch', () => {
    assert.throws(
      () => assertArchiverRuntimeConfig({
        ...localEnvironment,
        ALLOW_LOCAL_ARCHIVER_ADMIN: 'true',
      }, marker),
      /has been removed/,
    );
    assert.throws(
      () => assertArchiverRuntimeConfig({
        ...localEnvironment,
        DATABASE_URL: 'postgresql://postgres:postgres@smart-job-postgres:5432/postgres',
      }, marker),
      /smart_job_archiver/,
    );
  });

  it('allows the internal GCS emulator only with the marker', () => {
    const config = readUploadCleanupConfig({
      ...localEnvironment,
      GCS_PROJECT_ID: 'smart-job-local',
      COMPANY_FILES_BUCKET: 'smart-job-company-files',
    });
    assert.equal(config.apiEndpoint, 'http://gcs-emulator:4443');
  });
});
