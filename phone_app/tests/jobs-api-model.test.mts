import assert from 'node:assert/strict';
import test from 'node:test';
import { JobDetailSchema, JobSummarySchema } from '@smart-job/api-contracts';

import {
  buildJobListPath,
  mapJobDetail,
  mapJobSummary,
  mergeJobSummaryPages,
  normalizeJobListFilters,
} from '../modules/jobs/lib/job-list-model.ts';

const firstJob = JobSummarySchema.parse({
  jobId: '11111111-1111-4111-8111-111111111111',
  jobNo: 42,
  status: 'pending',
  title: 'Compressor service',
  description: 'Inspect the compressor',
  notes: null,
  location: 'Haifa',
  address: null,
  category: null,
  priority: null,
  dueAt: '2026-07-14T12:00:00.000Z',
  client: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Dana',
    phone: '0501234567',
  },
  assignee: { memberNo: 7, displayName: 'Worker' },
  creator: { uid: null, memberNo: 3, displayName: 'Manager' },
  isCertificate: false,
  timeFrom: null,
  timeTo: null,
  signingPerson: null,
  travelDistance: null,
  entityVersion: 'opaque-version-7',
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
  finishedAt: null,
  deniedAt: null,
});

test('job list filters and cursors serialize deterministically', () => {
  const filters = normalizeJobListFilters({
    status: ['denied', 'pending', 'waiting', 'pending'],
    dateFrom: new Date('2026-07-01T00:00:00.000Z'),
    dateTo: '2026-07-13T23:59:59.000Z',
    search: '  compressor  ',
    pageSize: 50,
  });

  assert.deepEqual(filters.statuses, ['pending', 'waiting', 'denied']);
  assert.equal(
    buildJobListPath(17, filters, 'opaque+cursor/='),
    '/api/v1/companies/17/jobs?status=pending&status=waiting&status=denied&dateField=createdAt&dateFrom=2026-07-01T00%3A00%3A00.000Z&dateTo=2026-07-13T23%3A59%3A59.000Z&search=compressor&pageSize=50&afterCursor=opaque%2Bcursor%2F%3D',
  );
});

test('historical job filters can target finishedAt while cursors remain opaque', () => {
  const filters = normalizeJobListFilters({
    status: 'finished',
    dateField: 'finishedAt',
    dateFrom: '2026-01-01T00:00:00.000Z',
    pageSize: 25,
  });
  assert.match(buildJobListPath(17, filters), /dateField=finishedAt/);
});

test('API jobs retain UUID identity, public number, and opaque entity version', () => {
  const mapped = mapJobSummary(firstJob);

  assert.equal(mapped.id, firstJob.jobId);
  assert.equal(mapped.jobNo, 42);
  assert.equal(mapped.entityVersion, 'opaque-version-7');
  assert.equal(mapped.wid, 7);
  assert.equal(mapped.mname, 'Manager');
  assert.equal(mapped.cid, firstJob.client?.id);
});

test('job details keep public part numbers and opaque attachment ids at the mobile boundary', () => {
  const partUuid = '33333333-3333-4333-8333-333333333333';
  const attachmentId = '44444444-4444-4444-8444-444444444444';
  const detail = JobDetailSchema.parse({
    ...firstJob,
    parts: [{ partId: partUuid, partNo: 18, name: 'Relay', quantity: 2 }],
    attachments: [{
      attachmentId,
      kind: 'photo',
      fileName: 'relay.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1_024,
      sha256: 'a'.repeat(64),
      createdAt: firstJob.createdAt,
    }],
  });

  const mapped = mapJobDetail(detail);
  assert.equal(mapped.partsUsed[0]?.id, 18);
  assert.equal(mapped.photos[0]?.attachmentId, attachmentId);
  assert.equal('storagePath' in mapped.photos[0]!, false);
});

test('overlapping cursor pages are merged without duplicate jobs', () => {
  const jobs = mergeJobSummaryPages([
    { items: [firstJob] },
    { items: [firstJob] },
  ]);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.entityVersion, 'opaque-version-7');
});
