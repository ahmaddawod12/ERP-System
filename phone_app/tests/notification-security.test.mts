import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  notificationMatchesAudience,
  parseNotificationAudience,
} from '../lib/notifications/audience.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';

test('notification audience validation fails closed for identity and tenant mismatches', () => {
  const data = { uid: userId, companyId: '41' };
  const scope = {
    restoredUserId: userId,
    sessionUserId: userId,
    currentCompanyId: 41,
    accessibleCompanyIds: new Set([41, 42]),
  };

  assert.deepEqual(parseNotificationAudience(data), { userId, companyId: 41 });
  assert.equal(notificationMatchesAudience(data, scope), true);
  assert.equal(notificationMatchesAudience({ ...data, uid: otherUserId }, scope), false);
  assert.equal(notificationMatchesAudience(data, { ...scope, restoredUserId: otherUserId }), false);
  assert.equal(notificationMatchesAudience(data, { ...scope, currentCompanyId: 42 }), false);
  assert.equal(notificationMatchesAudience(data, {
    ...scope,
    accessibleCompanyIds: new Set([42]),
  }), false);
  assert.equal(parseNotificationAudience({ uid: userId, company_id: '41' }), null);
  assert.equal(parseNotificationAudience({ uid: userId, companyId: 'not-a-company' }), null);
  assert.equal(parseNotificationAudience({ companyId: '41' }), null);
});

test('notification listeners guard display and open paths and use the private NotifyKit channel', async () => {
  const [notifications, provider, packageJson] = await Promise.all([
    readFile(new URL('../utils/notifications.ts', import.meta.url), 'utf8'),
    readFile(new URL('../contexts/NotificationContext.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);

  const foregroundHandler = notifications.slice(
    notifications.indexOf('const unsubscribeForeground'),
    notifications.indexOf('unsubscribers.push(unsubscribeForeground)'),
  );
  assert.ok(
    foregroundHandler.indexOf('isAcceptedNotification(normalizedData, guard)')
      < foregroundHandler.indexOf('displayLocalNotification({'),
    'the untrusted payload must be accepted before local display',
  );
  assert.match(notifications, /smart_job_private_v2/);
  assert.match(notifications, /visibility: AndroidVisibility\.PRIVATE/);
  assert.doesNotMatch(notifications, /visibility: AndroidVisibility\.PUBLIC/);
  assert.match(notifications, /isAcceptedNotification\(data, guard\)/);
  assert.match(provider, /restoreSupabaseSession\(\)/);
  assert.match(provider, /notificationMatchesAudience\(data,/);
  assert.match(provider, /const currentCompanyId = workspace\.companyId/);
  assert.match(packageJson, /"react-native-notify-kit": "10\.4\.8"/);
  assert.doesNotMatch(packageJson, /"@notifee\/react-native"/);
});
