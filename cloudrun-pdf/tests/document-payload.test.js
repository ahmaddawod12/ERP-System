const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHtmlPayload,
  buildStoredDocumentRecord,
  normalizeClientVatNumber,
} = require('../document-payload');

test('normalizeClientVatNumber supports legacy field names', () => {
  assert.equal(normalizeClientVatNumber({ vatNumber: '123456789' }), '123456789');
  assert.equal(normalizeClientVatNumber({ customerVatNumber: '987654321' }), '987654321');
});

test('buildHtmlPayload forwards receipt fields to template input', () => {
  const payload = buildHtmlPayload({
    documentType: 400,
    documentData: {
      client: { name: 'Dana' },
      items: [{ description: 'Repair', quantity: 1, price: 100 }],
      paymentMethod: 'check',
      paymentInfo: 'CHK-1001',
      invoiceReference: 'TI-55',
    },
    documentNumber: 18,
    logoUrl: 'data:image/png;base64,abc',
    confirmationNumber: '',
  });

  assert.equal(payload.paymentMethod, 'check');
  assert.equal(payload.paymentInfo, 'CHK-1001');
  assert.equal(payload.invoiceReference, 'TI-55');
  assert.equal(payload.documentNumber, 18);
});

test('buildStoredDocumentRecord preserves metadata for non-tax documents', () => {
  const record = buildStoredDocumentRecord({
    documentType: 400,
    documentData: {
      client: {
        name: 'Dana',
        phone: '050-123',
        city: 'Jerusalem',
        vatNumber: '123456789',
        clientId: 'client-1',
      },
      items: [{ description: 'Repair', quantity: 1, price: 100, partId: 7 }],
      language: 'he',
      date: '2026-03-11',
      notes: 'Paid in full',
      paymentMethod: 'cash',
      paymentInfo: 'front desk',
      invoiceReference: 'TI-55',
    },
    uid: 'user-1',
    createdAt: '2026-03-25T10:15:00.000Z',
    totalBeforeVat: 100,
    vatAmount: 18,
    totalWithVat: 118,
    downloadURL: 'https://example.com/doc.pdf',
    storagePath: 'companies/acme/2026-03/18/18.pdf',
    normalizedDocumentId: '18',
  });

  assert.equal(record.documentId, '18');
  assert.equal(record.documentNumber, '18');
  assert.equal(record.cname, 'Dana');
  assert.equal(record.clientCity, 'Jerusalem');
  assert.equal(record.clientVatNumber, '123456789');
  assert.equal(record.paymentMethod, 'cash');
  assert.equal(record.paymentInfo, 'front desk');
  assert.equal(record.invoiceReference, 'TI-55');
  assert.equal(record.documentData.client.clientVatNumber, '123456789');
});
