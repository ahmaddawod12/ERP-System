import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveResponsiveLayout } from '../lib/layout/responsive.ts';

test('responsive layout adapts phones, landscape, and tablets', () => {
  assert.deepEqual(
    { ...resolveResponsiveLayout(390, 844), width: undefined, height: undefined },
    {
      width: undefined,
      height: undefined,
      isLandscape: false,
      isTablet: false,
      isWide: false,
      maxContentWidth: 900,
      columnCount: 1,
    },
  );
  assert.equal(resolveResponsiveLayout(844, 390).isWide, true);
  assert.equal(resolveResponsiveLayout(1024, 768).isTablet, true);
  assert.equal(resolveResponsiveLayout(1200, 800).columnCount, 2);
});
