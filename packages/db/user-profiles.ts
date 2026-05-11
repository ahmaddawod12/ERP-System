import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { getUserProfileByFirebaseUid } from './access';

const {
  appUsers,
  companyMemberships,
} = require('./schema');

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function updateUserProfile(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const profile: any = await getUserProfileByFirebaseUid(input.uid, { db: tx });
    if (!profile) {
      const error = new Error('User profile not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const userUpdate: Record<string, any> = { updatedAt: now };
    if (input.name !== undefined) userUpdate.displayName = input.name || null;
    if (input.phoneNumber !== undefined) userUpdate.phoneNumber = input.phoneNumber || null;

    await tx.update(appUsers)
      .set(userUpdate)
      .where(eq(appUsers.id, input.uid));

    if (profile.membershipId) {
      const membershipUpdate: Record<string, any> = { updatedAt: now };
      if (input.name !== undefined) membershipUpdate.displayName = input.name || null;
      if (input.phoneNumber !== undefined) membershipUpdate.phoneNumber = input.phoneNumber || null;

      await tx.update(companyMemberships)
        .set(membershipUpdate)
        .where(eq(companyMemberships.id, profile.membershipId));
    }

    return getUserProfileByFirebaseUid(input.uid, { db: tx });
  });
}

async function updateUserPushToken(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  const updateData: Record<string, any> = {
    updatedAt: now,
    pushToken: input.pushToken,
    pushTokenPlatform: input.pushTokenPlatform || null,
    pushTokenUpdatedAt: now,
  };

  const rows = await db.update(appUsers)
    .set(updateData)
    .where(eq(appUsers.id, input.uid))
    .returning({ id: appUsers.id });

  if (!rows[0]) {
    const error = new Error('User profile not found');
    (error as any).code = 'not-found';
    throw error;
  }

  return { success: true };
}

async function clearUserPushToken(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  const rows = await db.update(appUsers)
    .set({
      updatedAt: now,
      pushToken: null,
      pushTokenPlatform: null,
      pushTokenUpdatedAt: null,
    })
    .where(eq(appUsers.id, input.uid))
    .returning({ id: appUsers.id });

  if (!rows[0]) {
    const error = new Error('User profile not found');
    (error as any).code = 'not-found';
    throw error;
  }

  return { success: true };
}

export { clearUserPushToken, updateUserProfile, updateUserPushToken };

