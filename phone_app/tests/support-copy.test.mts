import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSupportCategoryMeta,
  getSupportTemplateQuestions,
  getSupportTranslations,
} from '../modules/support/lib/support-copy.ts';

test('support copy exposes localized open and closed status labels', () => {
  const en = getSupportTranslations('en');
  const he = getSupportTranslations('he');

  assert.equal(en.openStatus, 'Open');
  assert.equal(en.closedStatus, 'Closed');
  assert.equal(he.openStatus, 'פתוח');
  assert.equal(he.closedStatus, 'סגור');
});

test('support template questions remain category-specific', () => {
  assert.equal(getSupportTemplateQuestions('en', 'bug').length, 4);
  assert.equal(getSupportTemplateQuestions('en', 'support').length, 2);
  assert.equal(getSupportTemplateQuestions('en', 'freeChat').length, 0);
});

test('support category metadata returns localized label and icon data', () => {
  const t = getSupportTranslations('en');
  const meta = getSupportCategoryMeta('suggestion', {
    error: '#f00',
    primary: '#00f',
    textSecondary: '#999',
  }, t);

  assert.equal(meta.label, 'Suggestion for improvements');
  assert.equal(meta.type, 'Ionicons');
  assert.equal(meta.icon, 'bulb-outline');
});
