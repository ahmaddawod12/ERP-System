const test = require('node:test');
const assert = require('node:assert/strict');

const { getTargetMonth } = require('../archive-month');

test('getTargetMonth handles same-year lookback', () => {
  const target = getTargetMonth(new Date('2026-07-15T12:00:00.000Z'));
  assert.equal(target.year, 2026);
  assert.equal(target.month, 1);
  assert.equal(target.startDate.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(target.endDate.toISOString(), '2026-01-31T23:59:59.999Z');
});

test('getTargetMonth handles previous-year lookback', () => {
  const target = getTargetMonth(new Date('2026-03-15T12:00:00.000Z'));
  assert.equal(target.year, 2025);
  assert.equal(target.month, 9);
  assert.equal(target.startDate.toISOString(), '2025-09-01T00:00:00.000Z');
  assert.equal(target.endDate.toISOString(), '2025-09-30T23:59:59.999Z');
});
