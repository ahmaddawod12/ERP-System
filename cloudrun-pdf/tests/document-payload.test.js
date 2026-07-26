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
  assert.deepEqual(payload.paymentDetails, { reference: 'CHK-1001' });
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
    storagePath: 'companies/acme/2026-03/18/18.pdf',
    normalizedDocumentId: '18',
  });

  assert.equal(record.documentId, '18');
  assert.equal(record.documentNumber, '18');
  assert.equal(record.cname, 'Dana');
  assert.equal(record.clientCity, 'Jerusalem');
  assert.equal(record.clientVatNumber, '123456789');
  assert.equal(record.paymentMethod, 'cash');
  assert.equal(record.paymentDetails, null);
  assert.equal(record.invoiceReference, 'TI-55');
  assert.equal(record.documentData.client.clientVatNumber, '123456789');
  assert.equal(record.downloadURL, undefined);
});

test('credit details retain last four and authorization only', () => {
  const payload = buildHtmlPayload({
    documentType: 400,
    documentData: {
      client: { name: 'Dana' },
      items: [{ description: 'Repair', quantity: 1, price: 100 }],
      paymentMethod: 'credit',
      paymentDetails: {
        last4: '4242',
        authorizationReference: 'AUTH-123456',
      },
    },
    documentNumber: 19,
  });

  assert.deepEqual(payload.paymentDetails, {
    last4: '4242',
    authorizationReference: 'AUTH-123456',
  });
});

test('legacy payment data containing a likely PAN is not rendered or persisted', () => {
  const payload = buildHtmlPayload({
    documentType: 400,
    documentData: {
      client: { name: 'Dana' },
      items: [{ description: 'Repair', quantity: 1, price: 100 }],
      paymentMethod: 'transfer',
      paymentInfo: '4111 1111 1111 1111',
    },
    documentNumber: 20,
  });

  assert.equal(payload.paymentDetails, null);
  assert.equal(JSON.stringify(payload).includes('4111 1111 1111 1111'), false);
});
