import {
  PushDeviceIdSchema,
  PushTokenClearRequestSchema,
  PushTokenClearResultSchema,
  PushTokenUpsertRequestSchema,
  PushTokenUpsertResultSchema,
  type PushTokenClearResult,
  type PushTokenPlatform,
  type PushTokenUpsertResult,
} from '@smart-job/api-contracts';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { requestApi } from './client';

const PUSH_TOKEN_PATH = '/api/v1/me/push-token';
const PUSH_DEVICE_ID_KEY = 'smart-job.push-device-id.v1';
const AuthenticatedUserIdSchema = z.uuid();
let pushDeviceIdPromise: Promise<string> | null = null;

/**
 * Returns the opaque identity for this native app installation.
 *
 * The value deliberately lives only in the platform keychain/keystore. It is
 * independent of the signed-in user so a shared device can remove only its own
 * registration during logout without clearing another installation.
 */
export function getOrCreatePushDeviceId(): Promise<string> {
  if (pushDeviceIdPromise) {
    return pushDeviceIdPromise;
  }

  const pending = (async () => {
    const stored = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
    const existing = PushDeviceIdSchema.safeParse(stored);
    if (existing.success) {
      return existing.data;
    }

    const generated = PushDeviceIdSchema.parse(randomUUID());
    await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, generated, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  pushDeviceIdPromise = pending;
  void pending.catch(() => {
    if (pushDeviceIdPromise === pending) {
      pushDeviceIdPromise = null;
    }
  });
  return pending;
}

export async function upsertViewerPushToken(
  uid: string,
  token: string,
  platform: PushTokenPlatform,
): Promise<PushTokenUpsertResult> {
  const expectedUid = AuthenticatedUserIdSchema.parse(uid);
  const deviceId = await getOrCreatePushDeviceId();
  const body = PushTokenUpsertRequestSchema.parse({ deviceId, token, platform });
  return requestApi(PUSH_TOKEN_PATH, PushTokenUpsertResultSchema, {
    method: 'POST',
    body,
    uid: expectedUid,
  });
}

export async function clearViewerPushToken(uid: string): Promise<PushTokenClearResult> {
  const expectedUid = AuthenticatedUserIdSchema.parse(uid);
  const deviceId = await getOrCreatePushDeviceId();
  const body = PushTokenClearRequestSchema.parse({ deviceId });
  return requestApi(PUSH_TOKEN_PATH, PushTokenClearResultSchema, {
    method: 'DELETE',
    body,
    uid: expectedUid,
  });
}
