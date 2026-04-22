const test = require('node:test');
const assert = require('node:assert/strict');

const { DOC_TYPE, DOC_SUFFIX } = require('@smart-job/contracts');
const {
  buildCompanyDataFromBusinessInfo,
  createSqlDocumentWorkflow,
} = require('../src/sql-document-orchestration');

test('document workflow builds company data from SQL business info', () => {
  const companyData = buildCompanyDataFromBusinessInfo({
    he_name: 'חכם ג׳וב',
    en_name: 'Smart Job',
    business_email: 'ops@example.com',
    business_phone: '050-0000000',
    address: 'Main St 1',
    vat_number: '123456789',
  }, '77');

  assert.deepEqual(companyData, {
    name: 'חכם ג׳וב',
    email: 'ops@example.com',
    phone: '050-0000000',
    address: 'Main St 1',
    vatNumber: '123456789',
  });
});

test('document workflow allocates and stores pending SQL document records', async () => {
  const createdRecords = [];
  const workflow = createSqlDocumentWorkflow({
    allocateCompanyDocumentNumberInSql: async () => 17,
    createDocumentInSql: async (input) => {
      createdRecords.push(input);
      return { success: true };
    },
  });

  const result = await workflow.createPendingGeneratedDocument({
    companyId: '42',
    documentType: DOC_TYPE.PRICE_PROPOSAL,
    uid: 'user-1',
    requestDocumentData: {
      client: { name: 'Client A', phone: '123' },
      items: [
        { description: 'Work', quantity: 2, price: 50 },
      ],
      language: 'he',
      date: '2026-04-22',
      notes: 'memo',
    },
    companyData: {
      name: 'Smart Job',
      email: 'ops@example.com',
      phone: '050',
      address: 'Main St 1',
      vatNumber: '123456789',
    },
    createdAt: '2026-04-22T10:00:00.000Z',
  });

  assert.equal(result.documentId, `${DOC_SUFFIX[DOC_TYPE.PRICE_PROPOSAL]}17-42`);
  assert.equal(result.documentNumber, 17);
  assert.equal(result.completeDocumentData.totals.totalBeforeVat, 100);
  assert.equal(result.completeDocumentData.totals.totalWithVat, 118);
  assert.equal(createdRecords.length, 1);
  assert.equal(createdRecords[0].documentId, `${DOC_SUFFIX[DOC_TYPE.PRICE_PROPOSAL]}17-42`);
  assert.equal(createdRecords[0].record.createdByUid, 'user-1');
  assert.equal(createdRecords[0].record.documentData.company.name, 'Smart Job');
});

test('document workflow hydrates existing SQL tax invoice for generation', async () => {
  const workflow = createSqlDocumentWorkflow({
    getDocumentInSql: async () => ({
      documentNumber: 305,
      cname: 'Client A',
      cphone: '123',
      clientCity: 'Jerusalem',
      clientVatNumber: '999',
      cid: '4',
      language: 'he',
      date: '2026-04-22',
      notes: 'existing',
      jobsData: [{ jobId: '12' }],
      priceProposalId: 'PP5-42',
      taxAuthorityConfirmationNumber: 'CONF-1',
      totalBeforeVat: 100,
      vatAmount: 18,
      totalWithVat: 118,
      items: [{ description: 'Work', quantity: 1, price: 100 }],
      documentData: {},
    }),
  });

  const result = await workflow.prepareExistingDocumentForGeneration({
    companyId: '42',
    providedDocumentId: 'TI305-42',
    companyData: {
      name: 'Smart Job',
      email: 'ops@example.com',
      phone: '050',
      address: 'Main St 1',
      vatNumber: '123456789',
    },
  });

  assert.equal(result.documentId, 'TI305-42');
  assert.equal(result.documentNumber, 305);
  assert.equal(result.completeDocumentData.company.name, 'Smart Job');
  assert.equal(result.completeDocumentData.client.name, 'Client A');
  assert.equal(result.completeDocumentData.taxAuthorityConfirmationNumber, 'CONF-1');
});
