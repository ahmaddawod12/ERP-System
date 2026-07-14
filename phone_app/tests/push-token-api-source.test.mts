import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PushTokenClearRequestSchema,
  PushTokenClearResultSchema,
  PushTokenUpsertRequestSchema,
  PushTokenUpsertResultSchema,
} from '@smart-job/api-contracts';
import { runLogoutSequence } from '../modules/settings/lib/logout.ts';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('mobile push-token contracts keep the token write-only and native-only', () => {
  const token = 'fcm:mobile-device-token-123456789';
  const deviceId = '8da9077e-c776-4c09-a5b8-64c31f87448a';
  assert.deepEqual(PushTokenUpsertRequestSchema.parse({
    deviceId,
    token,
    platform: 'android',
  }), { deviceId, token, platform: 'android' });
  assert.equal(PushTokenUpsertRequestSchema.safeParse({ deviceId, token, platform: 'web' }).success, false);
  assert.deepEqual(PushTokenClearRequestSchema.parse({ deviceId }), { deviceId });
  assert.equal(PushTokenUpsertResultSchema.safeParse({
    registered: true,
    platform: 'ios',
    pushTokenUpdatedAt: '2026-07-13T12:00:00.000Z',
    token,
  }).success, false);
  assert.equal(PushTokenClearResultSchema.safeParse({ cleared: true }).success, true);
});

test('FCM registration and refresh use the identity-bound resource API', async () => {
  const [api, notifications, provider] = await Promise.all([
    readSource('../lib/api/push-tokens.ts'),
    readSource('../utils/notifications.ts'),
    readSource('../contexts/NotificationContext.tsx'),
  ]);

  assert.match(api, /AuthenticatedUserIdSchema = z\.uuid\(\)/);
  assert.match(api, /AuthenticatedUserIdSchema\.parse\(uid\)/);
  assert.match(api, /PushTokenUpsertRequestSchema\.parse/);
  assert.match(api, /PushTokenClearRequestSchema\.parse/);
  assert.match(api, /SecureStore\.getItemAsync\(PUSH_DEVICE_ID_KEY\)/);
  assert.match(api, /SecureStore\.setItemAsync\(PUSH_DEVICE_ID_KEY, generated/);
  assert.match(api, /PushDeviceIdSchema\.parse\(randomUUID\(\)\)/);
  assert.match(api, /PushTokenUpsertRequestSchema\.parse\(\{ deviceId, token, platform \}\)/);
  assert.match(api, /requestApi\(PUSH_TOKEN_PATH, PushTokenUpsertResultSchema/);
  assert.match(api, /method: 'POST'[\s\S]*body,[\s\S]*uid/);
  assert.match(api, /requestApi\(PUSH_TOKEN_PATH, PushTokenClearResultSchema/);
  assert.match(api, /method: 'DELETE'[\s\S]*body,[\s\S]*uid/);
  assert.match(api, /\/api\/v1\/me\/push-token/);

  assert.match(notifications, /Platform\.OS === 'ios' \|\| Platform\.OS === 'android'/);
  assert.match(notifications, /upsertViewerPushToken\(userId, pushToken, platform\)/);
  assert.match(notifications, /persistPushToken\(newToken, userId\)/);
  assert.match(provider, /setupNotificationListeners\(\s*userId,\s*guard,/);
  assert.doesNotMatch(notifications, /auth\.currentUser/);
  assert.doesNotMatch(notifications, /httpsCallable|functions,\s*'updatePushTokenV1'/);
  assert.doesNotMatch(notifications, /mmkvHelpers|CACHE_KEYS\.PROFILE/);
  assert.doesNotMatch(notifications, /substring\(0, 30\)|FCM Token obtained:/);
});

test('logout proceeds through session teardown when push cleanup is offline', async () => {
  const events: string[] = [];
  await runLogoutSequence({
    userId: '11111111-1111-4111-8111-111111111111',
    async clearPushToken() {
      events.push('clear');
      throw new Error('offline');
    },
    onPushTokenClearError() {
      events.push('cleanup-warning');
    },
    async signOut() {
      events.push('sign-out');
    },
    clearCache() {
      events.push('clear-cache');
    },
  });

  assert.deepEqual(events, ['clear', 'cleanup-warning', 'sign-out', 'clear-cache']);
});

test('logout without a restored user skips remote cleanup but still tears down locally', async () => {
  const events: string[] = [];
  await runLogoutSequence({
    userId: null,
    async clearPushToken() {
      events.push('unexpected-clear');
    },
    onPushTokenClearError() {
      events.push('unexpected-warning');
    },
    async signOut() {
      events.push('sign-out');
    },
    clearCache() {
      events.push('clear-cache');
    },
  });
  assert.deepEqual(events, ['sign-out', 'clear-cache']);
});

test('settings binds logout cleanup to the current SessionContext user', async () => {
  const settings = await readSource('../modules/settings/screens/Settings.tsx');

  assert.match(settings, /const \{ user, signOut: signOutSession \} = useSession\(\)/);
  assert.match(settings, /runLogoutSequence\(\{[\s\S]*userId: user\?\.id \?\? null/);
  assert.match(settings, /clearPushToken: clearViewerPushToken/);
  assert.match(settings, /signOut: signOutSession/);
  assert.match(settings, /logger\.warn\('Failed to clear push token before logout:'/);
  assert.doesNotMatch(settings, /clearPushTokenV1|httpsCallable|\bfunctions\b/);
  assert.doesNotMatch(settings, /console\.(warn|error)/);
});
