import { isSqlPersistenceEnabled } from './sql-access';
import { bumpCompanySyncStateInSql } from './sql-company-sync';

/**
 * Firestore boundary policy for the SQL migration:
 * - Firestore remains allowed for support/chat flows, auth-adjacent metadata,
 *   and explicitly temporary compatibility mirrors only.
 * - Business-domain source-of-truth writes must go through SQL helpers first.
 * - New ERP business logic should not introduce direct Firestore reads/writes
 *   outside the allowlisted compatibility helpers in this module.
 */
export const APPROVED_LEGACY_FIRESTORE_USE_CASES = [
  'user cache version mirrors',
  'company sync version mirrors',
  'temporary profile/membership mirrors for legacy clients',
  'temporary business_info mirrors for legacy clients',
] as const;

const {
  admin,
  logger,
  userCacheDocPath,
  userProfileDocPath,
  companyWorkerDocPath,
  companyManagerDocPath,
} = require('./shared');

async function touchLegacyUserCache(uid: string) {
  await admin.firestore().doc(userCacheDocPath(uid)).set({
    profile: 1,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function bumpLegacyCompanySyncVersion(companyId: string, field: string) {
  if (isSqlPersistenceEnabled()) {
    await bumpCompanySyncStateInSql(companyId, [field]);
    return;
  }

  await admin.firestore().doc(`companies/${companyId}/data/cache`).set({
    [field]: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function mirrorLegacyProfileAndMembership(input: {
  uid: string;
  companyId?: string | null;
  wid?: string | number | null;
  mid?: string | number | null;
  profileUpdates?: Record<string, any> | null;
  membershipUpdates?: Record<string, any> | null;
}) {
  const {
    uid,
    companyId,
    wid,
    mid,
    profileUpdates = {},
    membershipUpdates = {},
  } = input;

  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const workerRef = companyId && wid
    ? admin.firestore().doc(companyWorkerDocPath(companyId, String(wid)))
    : null;
  const managerRef = companyId && mid
    ? admin.firestore().doc(companyManagerDocPath(companyId, String(mid)))
    : null;

  const [workerSnap, managerSnap] = await Promise.all([
    workerRef ? workerRef.get() : Promise.resolve(null),
    managerRef ? managerRef.get() : Promise.resolve(null),
  ]);

  const batch = admin.firestore().batch();
  if (profileUpdates && Object.keys(profileUpdates).length > 0) {
    batch.set(profileRef, profileUpdates, { merge: true });
  }

  if (workerRef && workerSnap?.exists && membershipUpdates && Object.keys(membershipUpdates).length > 0) {
    batch.set(workerRef, membershipUpdates, { merge: true });
  }

  if (managerRef && managerSnap?.exists && membershipUpdates && Object.keys(membershipUpdates).length > 0) {
    batch.set(managerRef, membershipUpdates, { merge: true });
  }

  await batch.commit();
}

async function mirrorLegacyBusinessInfo(companyId: string, businessInfo: Record<string, any> | null | undefined) {
  if (!companyId || !businessInfo) {
    return;
  }

  await admin.firestore().doc(`companies/${companyId}/data/business_info`).set({
    ...businessInfo,
    last_updated: businessInfo.last_updated || new Date().toISOString(),
  }, { merge: true });

  logger.info('Mirrored legacy business_info after SQL write', {
    companyId,
    fields: Object.keys(businessInfo),
  });
}

export {
  bumpLegacyCompanySyncVersion,
  mirrorLegacyBusinessInfo,
  mirrorLegacyProfileAndMembership,
  touchLegacyUserCache,
};
