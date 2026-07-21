import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimArchiveRunLease,
  deleteArchiverRecordsChunk,
  listArchiverCandidates,
  listArchiverCompanies,
} from '../dist/archive.js';

test('archiver wrappers map opaque JSON and preserve bigint identifiers as strings', async () => {
  const calls = [];
  const db = {
    async execute(statement) {
      calls.push(statement);
      if (calls.length === 1) {
        return { rows: [{ company_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', public_company_id: '9007199254740993' }] };
      }
      if (calls.length === 2) {
        return { rows: [{
          company_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
          public_company_id: '9007199254740993',
          data_type: 'jobs',
          period_start: new Date('2024-03-01T00:00:00Z'),
          period_end: new Date('2024-04-01T00:00:00Z'),
        }] };
      }
      return {
        rows: [{
          claim: {
            leaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            claimed: true,
            attemptCount: 1,
            periodStart: '2026-01-01T00:00:00Z',
            periodEnd: '2026-02-01T00:00:00Z',
            snapshotAt: '2026-07-01T00:00:00Z',
            leaseUntil: '2026-07-01T01:00:00Z',
            segment: 1,
            archiveKey: '2026-01-j-s000001',
            runId: null,
            runStatus: null,
            docCount: 0,
            deleteCursor: 0,
            storagePath: null,
            checksum: null,
            storageGeneration: '9007199254740994',
            idManifestPath: null,
            idManifestChecksum: null,
            idManifestGeneration: null,
          },
        }],
      };
    },
  };
  const companies = await listArchiverCompanies({ db });
  assert.deepEqual(companies, [{
    internalCompanyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    publicCompanyId: '9007199254740993',
  }]);
  const candidates = await listArchiverCandidates(
    new Date('2026-02-01T00:00:00Z'),
    2000,
    { db },
  );
  assert.equal(candidates[0].dataType, 'jobs');
  assert.equal(candidates[0].periodStart.toISOString(), '2024-03-01T00:00:00.000Z');
  const claim = await claimArchiveRunLease({
    internalCompanyId: companies[0].internalCompanyId,
    archiveKey: '2026-01',
    dataType: 'jobs',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-02-01T00:00:00Z'),
    snapshotAt: new Date('2026-07-01T00:00:00Z'),
    leaseToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    leaseSeconds: 3600,
  }, { db });
  assert.equal(claim.storageGeneration, '9007199254740994');
  assert.equal(claim.segment, 1);
});

test('archiver deletion wrapper rejects malformed RPC responses', async () => {
  const db = { execute: async () => ({ rows: [{ deletion: null }] }) };
  await assert.rejects(
    deleteArchiverRecordsChunk({
      leaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      leaseToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      expectedCursor: 0,
      sourceIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    }, { db }),
    /invalid object/,
  );
});
