import { eq } from 'drizzle-orm';
import { getDb, type DatabaseOptions } from './client';
import { getUserProfileByFirebaseUid } from './access';
import {
  appUsers,
  companyMemberships,
} from './schema';

type UserProfileInput = {
  uid: string;
  name?: string | null;
  phoneNumber?: string | null;
  now?: string | Date;
};

type PushTokenInput = {
  uid: string;
  pushToken: string;
  pushTokenPlatform?: string | null;
  now?: string | Date;
};

type ClearPushTokenInput = {
  uid: string;
  now?: string | Date;
};

function asDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function updateUserProfile(input: UserProfileInput, options: DatabaseOptions = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const profile = await getUserProfileByFirebaseUid(input.uid, { db: tx });
    if (!profile) {
      const error = new Error('User profile not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const userUpdate: Partial<typeof appUsers.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) userUpdate.displayName = input.name || null;
    if (input.phoneNumber !== undefined) userUpdate.phoneNumber = input.phoneNumber || null;

    await tx.update(appUsers)
      .set(userUpdate)
      .where(eq(appUsers.id, input.uid));

    if (profile.membershipId) {
      const membershipUpdate: Partial<typeof companyMemberships.$inferInsert> = { updatedAt: now };
      if (input.name !== undefined) membershipUpdate.displayName = input.name || null;
      if (input.phoneNumber !== undefined) membershipUpdate.phoneNumber = input.phoneNumber || null;

      await tx.update(companyMemberships)
        .set(membershipUpdate)
        .where(eq(companyMemberships.id, profile.membershipId));
    }

    return getUserProfileByFirebaseUid(input.uid, { db: tx });
  });
}

async function updateUserPushToken(input: PushTokenInput, options: DatabaseOptions = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  const updateData: Partial<typeof appUsers.$inferInsert> = {
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

async function clearUserPushToken(input: ClearPushTokenInput, options: DatabaseOptions = {}) {
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

