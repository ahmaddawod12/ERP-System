import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DocumentSummarySchema, DocumentTaskAcceptedSchema } from '@smart-job/api-contracts';

import { StableDocumentActionKeys } from '../modules/documents/lib/document-action-keys.ts';
import {
  buildDocumentListPath,
  mapDocumentSummary,
  mergeDocumentSummaryPages,
  normalizeDocumentListFilters,
} from '../modules/documents/lib/document-history-model.ts';
import {
  buildDocumentGenerateRequest,
  buildDocumentPreviewRequest,
  isTaxDocumentType,
  normalizeDocumentCompanyId,
} from '../modules/documents/lib/document-mutation-model.ts';
import {
  buildDocumentTaskAttempt,
  PersistedDocumentTaskAttemptSchema,
} from '../modules/documents/lib/document-task-attempt.ts';

const firstDocument = DocumentSummarySchema.parse({
  documentId: '11111111-1111-4111-8111-111111111111',
  documentCode: '305-42',
  documentType: 305,
  documentNumber: 42,
  generationStatus: 'completed',
  taxAuthorityStatus: 'approved',
  client: {
    clientId: '22222222-2222-4222-8222-222222222222',
    name: 'Dana',
    phone: '0501234567',
    city: 'Haifa',
    vatNumber: '515000000',
  },
  creator: {
    uid: '33333333-3333-4333-8333-333333333333',
    memberNo: 7,
    displayName: 'Manager',
  },
  language: 'he',
  notes: 'Compressor service',
  totalBeforeVat: 100,
  vatAmount: 18,
  totalWithVat: 118,
  confirmationNumber: 'CONF-42',
  documentDate: '2026-07-12T08:00:00.000Z',
  hasFile: true,
  emailSent: false,
  emailDeliveryStatus: null,
  entityVersion: 'opaque-version-4',
  createdAt: '2026-07-12T08:00:00.000Z',
  updatedAt: '2026-07-12T08:05:00.000Z',
});

test('document filters and composite cursors serialize deterministically', () => {
  const filters = normalizeDocumentListFilters({
    search: '  Dana  ',
    status: ['failed', 'completed', 'failed'],
    documentType: [400, 305, 305],
    dateFrom: new Date('2026-07-01T00:00:00.000Z'),
    dateTo: '2026-07-13T23:59:59.000Z',
    pageSize: 50,
  });

  assert.deepEqual(filters.statuses, ['completed', 'failed']);
  assert.deepEqual(filters.documentTypes, [305, 400]);
  assert.equal(
    buildDocumentListPath(17, filters, 'opaque+cursor/='),
    '/api/v1/companies/17/documents?search=Dana&status=completed&status=failed&documentType=305&documentType=400&dateFrom=2026-07-01T00%3A00%3A00.000Z&dateTo=2026-07-13T23%3A59%3A59.000Z&pageSize=50&afterCursor=opaque%2Bcursor%2F%3D',
  );
});

test('API document summaries retain identity, version, totals, creator, and file availability', () => {
  const mapped = mapDocumentSummary(firstDocument);

  assert.equal(mapped.id, firstDocument.documentId);
  assert.equal(mapped.documentNumber, 42);
  assert.equal(mapped.entityVersion, 'opaque-version-4');
  assert.equal(mapped.type, 305);
  assert.equal(mapped.total, 118);
  assert.equal(mapped.createdByName, 'Manager');
  assert.equal(mapped.hasFile, true);
  assert.equal(mapped.storagePath, undefined);
});

test('overlapping document cursor pages are merged without duplicates', () => {
  const documents = mergeDocumentSummaryPages([
    { items: [firstDocument] },
    { items: [firstDocument] },
  ]);

  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.documentCode, '305-42');
});

test('mobile document reads use contract-validated Cloud API paths only', () => {
  const api = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'lib', 'documents-api.ts'),
    'utf8',
  );
  const history = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'screens', 'DocumentHistory.tsx'),
    'utf8',
  );
  const createDocument = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'screens', 'CreateDocument.tsx'),
    'utf8',
  );
  const download = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'lib', 'document-download.ts'),
    'utf8',
  );
  const taskHook = fs.readFileSync(
    path.resolve(process.cwd(), 'hooks', 'useDocumentTask.ts'),
    'utf8',
  );
  const taskPersistence = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'lib', 'document-task-persistence.ts'),
    'utf8',
  );
  const taxHook = fs.readFileSync(
    path.resolve(process.cwd(), 'modules', 'documents', 'hooks', 'useTaxInvoiceSubmission.ts'),
    'utf8',
  );

  assert.match(api, /DocumentListPageSchema/);
  assert.match(api, /DocumentTaskSchema/);
  assert.match(api, /DocumentDownloadAccessSchema/);
  assert.match(api, /DocumentPreviewRequestSchema/);
  assert.match(api, /DocumentGenerateRequestSchema/);
  assert.match(api, /DocumentDeleteRequestSchema/);
  assert.match(api, /DocumentTaskAcceptedSchema/);
  assert.match(api, /DocumentDeleteResultSchema/);
  assert.match(api, /\/api\/v1\/companies\/\$\{input\.companyId\}\/document-tasks/);
  assert.match(api, /\/api\/v1\/companies\/\$\{input\.companyId\}\/documents/);
  assert.match(api, /document-tasks\/preview/);
  assert.match(api, /document-tasks\/generate/);
  assert.match(api, /method: 'DELETE'/);
  assert.match(api, /idempotencyKey: input\.idempotencyKey/g);
  assert.doesNotMatch(api, /readModelV1|MMKV|firebase/i);
  assert.doesNotMatch(history, /useCache|cachedDocuments|readModelV1|httpsCallable|from ['"]\.\.\/\.\.\/\.\.\/firebase/);
  assert.match(history, /DocumentDeleteRequestSchema\.parse/);
  assert.match(history, /StableDocumentActionKeys/);
  assert.match(history, /useDocumentMutations/);
  assert.match(createDocument, /buildDocumentData\(resolvedClient\)/);
  assert.doesNotMatch(download, /httpsCallable|firebase|createDocumentDownloadUrlV1/i);
  assert.match(taskHook, /readDocumentTaskAttempt/);
  assert.match(taskHook, /persistDocumentTaskAttempt/);
  assert.match(taskHook, /Retry the same action to resume this task/);
  assert.match(taskPersistence, /createMMKV\(\{ id: 'smart-job-document-tasks' \}\)/);
  assert.doesNotMatch(createDocument, /getInvoiceApproval|middleEastFunctions/);
  assert.doesNotMatch(taxHook, /getInvoiceApproval|middleEastFunctions|Tax Authority Approved/);
  assert.match(createDocument, /TAX_SUBMISSION_UNAVAILABLE_MESSAGE/);
  assert.match(taxHook, /TAX_SUBMISSION_UNAVAILABLE_MESSAGE/);
});

test('non-tax document mutations normalize legacy form data into strict API contracts', () => {
  const params = {
    documentType: 'priceProposal',
    companyId: '17',
    documentData: {
      client: {
        clientId: '22222222-2222-4222-8222-222222222222',
        name: '  Dana  ',
        email: '',
        phone: ' 0501234567 ',
        address: '',
        city: ' Haifa ',
      },
      items: [
        { description: ' Compressor ', quantity: '2', price: '50', partId: '42' },
        { description: ' Custom labor ', quantity: 1, price: 20, partId: 'manual-part' },
      ],
      language: 'en',
      date: '2026-07-14',
      notes: '',
    },
  } as const;

  const preview = buildDocumentPreviewRequest(params);
  const generated = buildDocumentGenerateRequest(params);

  assert.equal(normalizeDocumentCompanyId(params.companyId), 17);
  assert.equal(preview.documentType, 10);
  assert.equal(preview.documentData.client.name, 'Dana');
  assert.equal(preview.documentData.client.email, undefined);
  assert.equal(preview.documentData.client.phone, '0501234567');
  assert.equal(preview.documentData.items[0]?.partNo, 42);
  assert.equal(preview.documentData.items[1]?.partNo, undefined);
  assert.deepEqual(generated, preview);
});

test('tax invoice type 305 cannot enter generic preview or generate requests', () => {
  const taxParams = {
    documentType: 'taxInvoice',
    companyId: '17',
    documentData: {
      client: { name: 'Dana' },
      items: [{ description: 'Service', quantity: 1, price: 100 }],
      language: 'he',
      date: '2026-07-14',
    },
  } as const;

  assert.equal(isTaxDocumentType('taxInvoice'), true);
  assert.equal(isTaxDocumentType(305), true);
  assert.throws(() => buildDocumentPreviewRequest(taxParams), /tax approval workflow/i);
  assert.throws(() => buildDocumentGenerateRequest(taxParams), /tax approval workflow/i);
});

test('document mutation idempotency keys survive retries and rotate after confirmation', () => {
  let sequence = 0;
  const keys = new StableDocumentActionKeys(() => `document-key-${++sequence}`);

  const first = keys.keyFor('generate:17', '{"documentType":10}');
  assert.equal(keys.keyFor('generate:17', '{"documentType":10}'), first);
  assert.notEqual(keys.keyFor('generate:17', '{"documentType":200}'), first);

  const deleteKey = keys.keyFor('delete:document-1', '{"entityVersion":"v1"}');
  keys.complete('delete:document-1', deleteKey);
  assert.notEqual(keys.keyFor('delete:document-1', '{"entityVersion":"v1"}'), deleteKey);

  keys.restore('generate:17', '{"documentType":10}', 'restored-document-key');
  assert.equal(keys.keyFor('generate:17', '{"documentType":10}'), 'restored-document-key');
});

test('accepted mobile document task metadata survives a process restart', () => {
  const accepted = DocumentTaskAcceptedSchema.parse({
    taskId: 'preview-task-restored',
    status: 'pending',
    documentId: null,
    documentCode: null,
    entityVersion: null,
  });
  const attempt = buildDocumentTaskAttempt({
    uid: '33333333-3333-4333-8333-333333333333',
    companyId: 17,
    action: 'preview',
    fingerprint: '{"documentType":10}',
    idempotencyKey: 'document-preview-idempotency-key',
    accepted,
    updatedAt: 1234,
  });

  assert.deepEqual(PersistedDocumentTaskAttemptSchema.parse(attempt), {
    version: 1,
    uid: '33333333-3333-4333-8333-333333333333',
    companyId: 17,
    action: 'preview',
    fingerprint: '{"documentType":10}',
    idempotencyKey: 'document-preview-idempotency-key',
    accepted,
    updatedAt: 1234,
  });
});
