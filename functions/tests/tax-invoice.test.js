const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStoredTaxInvoiceDocument,
  getClientVatNumber,
  normalizeInvoiceDate,
} = require('../src/tax-invoice');

test('normalizeInvoiceDate keeps valid user-selected date', () => {
  assert.equal(normalizeInvoiceDate('2026-03-11', '2026-03-25'), '2026-03-11');
});

test('normalizeInvoiceDate falls back for invalid date input', () => {
  assert.equal(normalizeInvoiceDate('2026-02-31', '2026-03-25'), '2026-03-25');
});

test('getClientVatNumber accepts website and mobile field names', () => {
  assert.equal(getClientVatNumber({ vatNumber: '123456789' }), '123456789');
  assert.equal(getClientVatNumber({ customerVatNumber: '987654321' }), '987654321');
  assert.equal(getClientVatNumber({ clientVatNumber: '456456456' }), '456456456');
});

test('buildStoredTaxInvoiceDocument preserves metadata and normalized client vat', () => {
  const documentRecord = buildStoredTaxInvoiceDocument({
    uid: 'user-1',
    documentId: 'TI15-alpha',
    documentNumber: 15,
    client: {
      name: 'Acme',
      phone: '050-123',
      email: 'billing@example.com',
      address: 'Main 1',
      city: 'Haifa',
      vatNumber: '123456789',
      clientId: 'client-7',
    },
    items: [{ description: 'Repair', quantity: 2, price: 50 }],
    language: 'he',
    date: '2026-03-11',
    notes: 'Handled on site',
    jobsData: [{ jobId: '42' }],
    priceProposalId: 'PP-9',
    totalBeforeVat: 100,
    vatAmount: 18,
    totalWithVat: 118,
    confirmationNumber: 'CN-77',
    responseData: { approved: true },
    submittedAt: '2026-03-25T10:15:00.000Z',
  });

  assert.equal(documentRecord.date, '2026-03-11');
  assert.equal(documentRecord.clientVatNumber, '123456789');
  assert.equal(documentRecord.confirmationNumber, 'CN-77');
  assert.equal(documentRecord.taxAuthorityConfirmationNumber, 'CN-77');
  assert.equal(documentRecord.cname, 'Acme');
  assert.equal(documentRecord.cphone, '050-123');
  assert.equal(documentRecord.clientCity, 'Haifa');
  assert.equal(documentRecord.documentData.client.clientVatNumber, '123456789');
  assert.equal(documentRecord.documentData.totals.totalWithVat, 118);
});
