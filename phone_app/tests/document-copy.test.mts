import test from 'node:test';
import assert from 'node:assert/strict';

import { DOC_TYPE } from '@smart-job/contracts';
import { DOCUMENT_CONFIGS, getPaymentMethods } from '../modules/documents/lib/document-config.ts';
import { getDocumentTranslations } from '../modules/documents/lib/document-copy.ts';

test('document configs preserve receipt and tax invoice requirements', () => {
  assert.equal(DOCUMENT_CONFIGS[DOC_TYPE.TAX_INVOICE].requiresVatNumber, true);
  assert.equal(DOCUMENT_CONFIGS[DOC_TYPE.RECEIPT].requiresPaymentMethod, true);
  assert.equal(DOCUMENT_CONFIGS[DOC_TYPE.RECEIPT].hasReceiptMode, true);
});

test('document translations stay localized and type-specific', () => {
  const en = getDocumentTranslations('en', DOC_TYPE.RECEIPT);
  const ar = getDocumentTranslations('ar', DOC_TYPE.TAX_INVOICE);

  assert.equal(en.documentTypeName, 'Receipt');
  assert.match(en.selectReceiptMode, /receipt/i);
  assert.equal(ar.documentTypeName, 'فاتورة ضريبية');
});

test('payment method labels remain localized', () => {
  const he = getPaymentMethods('he');
  const cash = he.find((method) => method.id === 'cash');

  assert.equal(cash?.label, 'מזומן');
  assert.equal(he.length, 6);
});
