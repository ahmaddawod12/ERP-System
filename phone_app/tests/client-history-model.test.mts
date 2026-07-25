import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClientHistoryEntries,
  clientHistoryTime,
  formatClientHistoryDate,
  formatClientHistoryMonth,
} from '../modules/clients/lib/client-history-model.ts';
import type { MobileClientSummary } from '../modules/clients/lib/client-list-model.ts';

const client = {
  id: 'client-1',
  cid: 41,
  name: 'Acme Cooling',
} as MobileClientSummary;

test('client history normalizes, scopes, and sorts finished jobs', () => {
  const entries = buildClientHistoryEntries([
    {
      id: 'old',
      cid: 41,
      title: 'Old repair',
      finishedAt: '2026-07-01T08:00:00.000Z',
      parts: [{ partName: 'Relay' }],
    },
    {
      id: 'other-tenant-client',
      cid: 99,
      title: 'Not visible',
      finishedAt: '2026-07-22T08:00:00.000Z',
    },
    {
      id: 'new',
      clientId: 'client-1',
      jobTitle: 'New repair',
      finishedAt: '2026-07-20T08:00:00.000Z',
    },
  ], client, 'finishedJobs');

  assert.deepEqual(entries.map((entry) => entry.id), ['new', 'old']);
  assert.equal(entries[1]?.kind, 'job');
  assert.deepEqual(entries[1]?.kind === 'job' ? entries[1].partNames : [], ['Relay']);
});

test('document history calculates legacy line totals without unsafe UI casts', () => {
  const [entry] = buildClientHistoryEntries([{
    id: 'doc-1',
    cname: 'Acme Cooling',
    type: '305',
    createdAt: '2026-07-21T08:00:00.000Z',
    income: [{ price: '120', quantity: '2' }, { price: 10, quantity: 1 }],
  }], client, 'documents');

  assert.equal(entry?.kind, 'document');
  assert.equal(entry?.kind === 'document' ? entry.total : 0, 250);
});

test('history dates support timestamp adapters and localized Intl output', () => {
  const timestamp = { toDate: () => new Date('2026-07-22T08:00:00.000Z') };
  assert.equal(clientHistoryTime(timestamp), Date.parse('2026-07-22T08:00:00.000Z'));
  assert.notEqual(formatClientHistoryDate(timestamp, 'he'), '—');
  assert.match(formatClientHistoryMonth(new Date('2026-07-01T00:00:00.000Z'), 'en'), /July 2026/);
});
