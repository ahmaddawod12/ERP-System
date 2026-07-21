const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');

const { readArchiveRunnerConfig, runMonthlyArchives } = require('../archive-runner');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function claim(overrides = {}) {
  return {
    leaseId: '10000000-0000-4000-8000-000000000001',
    claimed: true,
    attemptCount: 1,
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-02-01T00:00:00.000Z',
    snapshotAt: '2026-07-15T00:00:00.000Z',
    leaseUntil: '2026-07-15T01:00:00.000Z',
    segment: 1,
    archiveKey: '2026-01-j-s000001',
    runId: null,
    runStatus: null,
    docCount: 0,
    deleteCursor: 0,
    storagePath: null,
    checksum: null,
    storageGeneration: null,
    idManifestPath: null,
    idManifestChecksum: null,
    idManifestGeneration: null,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    bucketName: 'smart-job-archives-local',
    pageSize: 500,
    companyConcurrency: 1,
    leaseSeconds: 3600,
    jobDeadlineMs: 60_000,
    monthsLookback: 6,
    candidateLimit: 2000,
    ...overrides,
  };
}

const company = {
  internalCompanyId: '20000000-0000-4000-8000-000000000001',
  publicCompanyId: '42',
};
function candidate(dataType, overrides = {}) {
  return {
    ...company,
    dataType,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}
const silentLogger = { log() {}, warn() {}, error() {} };

test('an empty snapshot releases the lease and leaves the month open', async () => {
  let releases = 0;
  let completions = 0;
  const summary = await runMonthlyArchives({
    bucket: {},
    config: config(),
    logger: silentLogger,
    dependencies: {
      listCandidates: async () => [candidate('documents'), candidate('jobs')],
      claim: async ({ dataType }) => claim({
        leaseId: dataType === 'jobs'
          ? '10000000-0000-4000-8000-000000000002'
          : '10000000-0000-4000-8000-000000000001',
        archiveKey: `2026-01-${dataType === 'jobs' ? 'j' : 'd'}-s000001`,
      }),
      renew: async () => {},
      page: async () => [],
      releaseEmpty: async () => { releases += 1; return true; },
      complete: async () => { completions += 1; return true; },
      fail: async () => true,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      newLeaseToken: () => '30000000-0000-4000-8000-000000000001',
    },
  });
  assert.equal(summary.failedCompanies, 0);
  assert.equal(releases, 2);
  assert.equal(completions, 0);
});

test('a lost worker resumes deletion from the verified ID object in 500-row chunks', async () => {
  const sourceIds = Array.from({ length: 1001 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  ));
  const idBytes = Buffer.from(JSON.stringify(sourceIds));
  const dataBytes = Buffer.from('[]');
  const objects = new Map([
    ['companies/42/archives/2026-01-j-s000001.json', {
      bytes: dataBytes,
      generation: '11',
      metadata: {
        sha256: sha256(dataBytes), docCount: '1001', archiveKey: '2026-01-j-s000001', objectKind: 'records',
      },
    }],
    ['companies/42/archives/2026-01-j-s000001.ids.json', {
      bytes: idBytes,
      generation: '12',
      metadata: {
        sha256: sha256(idBytes), docCount: '1001', archiveKey: '2026-01-j-s000001', objectKind: 'ids',
      },
    }],
  ]);
  const bucket = {
    file(path) {
      const object = objects.get(path);
      return {
        getMetadata: async () => [{ generation: object.generation, metadata: object.metadata }],
        createReadStream: () => Readable.from([object.bytes]),
      };
    },
  };
  const chunks = [];
  let completed = 0;
  const summary = await runMonthlyArchives({
    bucket,
    config: config(),
    logger: silentLogger,
    dependencies: {
      listCandidates: async () => [candidate('jobs')],
      claim: async () => claim({
          runId: '40000000-0000-4000-8000-000000000001',
          runStatus: 'uploaded_not_deleted',
          docCount: 1001,
          deleteCursor: 500,
          storagePath: 'companies/42/archives/2026-01-j-s000001.json',
          checksum: sha256(dataBytes),
          storageGeneration: '11',
          idManifestPath: 'companies/42/archives/2026-01-j-s000001.ids.json',
          idManifestChecksum: sha256(idBytes),
          idManifestGeneration: '12',
        }),
      renew: async () => {},
      deleteChunk: async ({ expectedCursor, sourceIds: chunkIds }) => {
        chunks.push(chunkIds);
        return { deleteCursor: expectedCursor + chunkIds.length };
      },
      complete: async () => { completed += 1; return true; },
      fail: async () => true,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      newLeaseToken: () => '30000000-0000-4000-8000-000000000001',
    },
  });
  assert.equal(summary.failedCompanies, 0);
  assert.deepEqual(chunks.map((item) => item.length), [500, 1]);
  assert.equal(chunks[0][0], sourceIds[500]);
  assert.equal(completed, 1);
});

test('configuration rejects unbounded pages, concurrency, leases and deadlines', () => {
  const base = { ARCHIVE_BUCKET: 'smart-job-archives-local' };
  assert.equal(readArchiveRunnerConfig(base).pageSize, 500);
  assert.equal(readArchiveRunnerConfig(base).candidateLimit, 2000);
  assert.throws(() => readArchiveRunnerConfig({ ...base, ARCHIVER_QUERY_PAGE_SIZE: '501' }), /1 to 500/);
  assert.throws(() => readArchiveRunnerConfig({ ...base, ARCHIVER_COMPANY_CONCURRENCY: '5' }), /1 to 4/);
  assert.throws(() => readArchiveRunnerConfig({ ...base, ARCHIVER_LEASE_SECONDS: '3601' }), /60 to 3600/);
  assert.throws(() => readArchiveRunnerConfig({ ...base, ARCHIVER_JOB_DEADLINE_MS: '3600000' }), /60000 to 3540000/);
  assert.throws(() => readArchiveRunnerConfig({ ...base, ARCHIVER_CANDIDATE_LIMIT: '2001' }), /1 to 2000/);
});

test('late historical candidate periods produce later archive claims', async () => {
  const claims = [];
  await runMonthlyArchives({
    bucket: {},
    config: config(),
    logger: silentLogger,
    dependencies: {
      listCandidates: async (cutoffEnd, limit) => {
        assert.equal(cutoffEnd.toISOString(), '2026-02-01T00:00:00.000Z');
        assert.equal(limit, 2000);
        return [candidate('jobs', {
          periodStart: new Date('2024-03-01T00:00:00.000Z'),
          periodEnd: new Date('2024-04-01T00:00:00.000Z'),
        })];
      },
      claim: async (input) => {
        claims.push(input);
        return claim({ archiveKey: '2024-03-j-s000002' });
      },
      renew: async () => {},
      page: async () => [],
      releaseEmpty: async () => true,
      fail: async () => true,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      newLeaseToken: () => '30000000-0000-4000-8000-000000000001',
    },
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].archiveKey, '2024-03');
  assert.equal(claims[0].periodEnd.toISOString(), '2024-04-01T00:00:00.000Z');
});
