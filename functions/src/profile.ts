import { isSqlPersistenceEnabled } from './sql-access';
import { updateCompanyBusinessInfoInSql } from './sql-company-profile';
import { bumpCompanySyncStateInSql } from './sql-company-sync';
import {
  mirrorLegacyBusinessInfo,
  mirrorLegacyProfileAndMembership,
} from './legacy-firestore-mirrors';

/**
 * Profile & cache domain module.
 */

const {
  onCall,
  HttpsError,
  admin,
  logger,
  userProfileDocPath,
  userCacheDocPath,
  companyWorkerDocPath,
  companyManagerDocPath,
  requireNonEmptyString,
  optionalTrimmedString,
  normalizeRole,
  validateCompanyId,
  assertHttpCompanyAccess,
  assertTargetWorkerScopedUserInCompany,
  HTTP_COMPANY_MANAGER_ROLES,
  isValidEmail,
} = require('./shared');
const {
  clearUserPushTokenInSql,
  getUserProfileInSql,
  updateUserProfileInSql,
  updateUserPushTokenInSql,
} = require('./sql-user-profile');

/**
 * Callable Function: updateProfileV1
 */
export const updateProfileV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const name = typeof data.name === 'string' ? data.name.trim() : undefined;
  const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : undefined;

  if (name === undefined && phoneNumber === undefined) {
    throw new HttpsError('invalid-argument', 'At least one of name or phoneNumber must be provided');
  }

  // Validate field lengths
  if (name !== undefined && name.length > 200) {
    throw new HttpsError('invalid-argument', 'Name is too long');
  }
  if (phoneNumber !== undefined && phoneNumber.length > 30) {
    throw new HttpsError('invalid-argument', 'Phone number is too long');
  }

  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const profileData = isSqlPersistenceEnabled()
    ? await getUserProfileInSql(uid)
    : await profileRef.get().then((snap) => {
      if (!snap.exists) {
        throw new HttpsError('not-found', 'User profile not found');
      }
      return snap.data();
    });
  const companyId = profileData.companyId;
  const wid = profileData.wid;
  const mid = profileData.mid;

  const updates: Record<string, any> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name !== undefined) updates.name = name;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

  if (isSqlPersistenceEnabled()) {
    await updateUserProfileInSql({ uid, name, phoneNumber });
  }

  const membershipUpdates: Record<string, any> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name !== undefined) membershipUpdates.name = name;
  if (phoneNumber !== undefined) membershipUpdates.phoneNumber = phoneNumber;

  // Keep Firestore profile and denormalized membership docs mirrored for legacy access paths.
  if (isSqlPersistenceEnabled()) {
    await mirrorLegacyProfileAndMembership({
      uid,
      companyId,
      wid,
      mid,
      profileUpdates: updates,
      membershipUpdates,
    });
  } else if (companyId && (wid || mid)) {
    const workerRef = wid
      ? admin.firestore().doc(companyWorkerDocPath(companyId, String(wid)))
      : null;
    const managerRef = mid
      ? admin.firestore().doc(companyManagerDocPath(companyId, String(mid)))
      : null;

    await admin.firestore().runTransaction(async (tx) => {
      const membershipWorkerSnap = workerRef ? await tx.get(workerRef) : null;
      const membershipManagerSnap = managerRef ? await tx.get(managerRef) : null;

      tx.update(profileRef, updates);

      if (workerRef && membershipWorkerSnap?.exists) {
        tx.update(workerRef, membershipUpdates);
        logger.info('updateProfileV1: synced worker doc atomically', {
          uid, companyId, wid, fields: Object.keys(membershipUpdates),
        });
      }

      if (managerRef && membershipManagerSnap?.exists) {
        tx.update(managerRef, membershipUpdates);
        logger.info('updateProfileV1: synced manager doc atomically', {
          uid, companyId, mid, fields: Object.keys(membershipUpdates),
        });
      }
    });
  } else {
    await profileRef.update(updates);
  }

  // Sync name change to Firebase Auth displayName for consistency
  if (name !== undefined) {
    try {
      await admin.auth().updateUser(uid, { displayName: name || undefined });
    } catch (authUpdateErr) {
      logger.warn('updateProfileV1: failed to sync displayName to Auth', { uid, error: authUpdateErr.message });
    }
  }

  logger.info('updateProfileV1: profile updated', { uid, fields: Object.keys(updates) });
  return { success: true };
});

/**
 * Callable Function: updatePushTokenV1
 * Updates ONLY push-notification fields on the user profile.
 * Since profile is read-only from the client, this CF handles pushToken writes.
 */
export const updatePushTokenV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const pushToken = typeof data.pushToken === 'string' ? data.pushToken.trim() : '';
  const pushTokenPlatform = typeof data.pushTokenPlatform === 'string' ? data.pushTokenPlatform.trim() : '';
  const pushTokenType = typeof data.pushTokenType === 'string' ? data.pushTokenType.trim() : 'fcm';

  if (!pushToken) {
    throw new HttpsError('invalid-argument', 'pushToken is required');
  }

  if (pushToken.length > 500) {
    throw new HttpsError('invalid-argument', 'pushToken is too long');
  }

  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  let currentToken = null;
  if (!isSqlPersistenceEnabled()) {
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
      throw new HttpsError('not-found', 'User profile not found');
    }
    currentToken = profileSnap.data().pushToken || null;
  }

  if (currentToken === pushToken) {
    return { success: true, changed: false };
  }

  if (isSqlPersistenceEnabled()) {
    await updateUserPushTokenInSql({
      uid,
      pushToken,
      pushTokenPlatform,
    });
  } else {
    const now = new Date().toISOString();
    await profileRef.set({
      pushToken,
      pushTokenUpdatedAt: now,
      pushTokenPlatform,
      pushTokenType,
    }, { merge: true });
  }

  logger.info('updatePushTokenV1: push token updated', { uid, platform: pushTokenPlatform });
  return { success: true, changed: true };
});

/**
 * Callable Function: updateBusinessInfoV1
 * Updates business_info fields EXCEPT vat_number and document_numbers.
 * Only manager/dev roles with company access can call this.
 */
export const updateBusinessInfoV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);

  await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_MANAGER_ROLES, // manager, dev only
    allowSoloScope: true,
  });

  if (!isSqlPersistenceEnabled()) {
    const businessInfoRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);
    const bizSnap = await businessInfoRef.get();
    if (!bizSnap.exists) {
      throw new HttpsError('not-found', 'Business info not found');
    }
  }

  // Build update — ONLY allowed fields
  const ALLOWED_FIELDS = [
    'he_name', 'en_name', 'city', 'address',
    'business_type', 'business_phone', 'business_email', 'business_fax',
    'accountant_name', 'accountant_email', 'accountant_phone',
  ];

  const updates = { last_updated: new Date().toISOString() };
  let hasChange = false;
  for (const field of ALLOWED_FIELDS) {
    if (data[field] !== undefined) {
      const value = typeof data[field] === 'string' ? data[field].trim() : data[field];
      if (typeof value === 'string' && value.length > 300) {
        throw new HttpsError('invalid-argument', `${field} is too long`);
      }
      if ((field === 'business_email' || field === 'accountant_email') && value && !isValidEmail(value)) {
        throw new HttpsError('invalid-argument', `${field} must be a valid email`);
      }
      updates[field] = value;
      hasChange = true;
    }
  }

  if (!hasChange) {
    throw new HttpsError('invalid-argument', 'No updatable fields provided');
  }

  // BLOCKED fields — vat_number and document_numbers cannot be changed
  if (data.vat_number !== undefined || data.document_numbers !== undefined) {
    throw new HttpsError('permission-denied', 'Cannot modify vat_number or document_numbers');
  }

  if (isSqlPersistenceEnabled()) {
    const businessInfo = await updateCompanyBusinessInfoInSql({ companyId, changes: updates });
    await mirrorLegacyBusinessInfo(companyId, businessInfo);
  } else {
    const businessInfoRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);
    await businessInfoRef.update(updates);
    const cacheRef = admin.firestore().doc(`companies/${companyId}/data/cache`);
    await cacheRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  logger.info('updateBusinessInfoV1: updated', { companyId, uid, fields: Object.keys(updates) });
  return { success: true };
});

/**
 * Callable Function: updateCacheV1
 * Updates cache version fields via Cloud Function.
 * Replaces direct client writes to cache documents.
 * Supports targetUid for cross-user cache writes (manager updating worker cache).
 */
export const updateCacheV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  if (companyId) validateCompanyId(companyId);
  const isCompanyCache = data.isCompanyCache === true;
  const field = typeof data.field === 'string' ? data.field.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : 'increment';
  const targetUid = typeof data.targetUid === 'string' ? data.targetUid.trim() : '';
  if (!['increment', 'delete'].includes(action)) {
    throw new HttpsError('invalid-argument', 'action must be increment or delete');
  }

  if (!field) {
    throw new HttpsError('invalid-argument', 'field is required');
  }

  // Whitelist allowed cache field names to prevent arbitrary field injection
  const ALLOWED_CACHE_FIELDS = [
    'profile', 'inventory', 'subscription', 'lastUpdated',
    'jobsVersion', 'documentsVersion', 'clientsVersion', 'workersVersion',
    'updatedAt',
  ];
  if (!ALLOWED_CACHE_FIELDS.includes(field)) {
    throw new HttpsError('invalid-argument', `Field '${field}' is not an allowed cache field`);
  }

  // Access control
  if (isCompanyCache && companyId) {
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: true,
    });
  }

  // Cross-user cache writes require manager/dev role
  if (targetUid && targetUid !== uid) {
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'companyId is required for cross-user cache updates');
    }
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: false,
    });
    await assertTargetWorkerScopedUserInCompany(targetUid, companyId);
  }

  const resolvedUid = targetUid || uid;

  if (isCompanyCache && companyId && isSqlPersistenceEnabled()) {
    const allowedSqlCompanyFields = [
      'jobsVersion',
      'documentsVersion',
      'clientsVersion',
      'workersVersion',
      'companyInventoryVersion',
      'updatedAt',
    ];
    if (!allowedSqlCompanyFields.includes(field)) {
      throw new HttpsError('invalid-argument', `Field '${field}' is not supported for SQL company cache updates`);
    }
    if (field === 'updatedAt') {
      return { success: true, mode: 'sql-noop' };
    }
    if (action !== 'increment') {
      throw new HttpsError('invalid-argument', 'SQL company cache updates only support increment');
    }

    await bumpCompanySyncStateInSql(companyId, [field]);
    return { success: true, mode: 'sql' };
  }

  const dbRef = admin.firestore();
  const cacheRef = isCompanyCache && companyId
    ? dbRef.doc(`companies/${companyId}/data/cache`)
    : dbRef.doc(`users/${resolvedUid}/data/cache`);

  if (action === 'delete') {
    // Use set+merge instead of update to avoid failure when cache doc doesn't exist yet
    await cacheRef.set({
      [field]: admin.firestore.FieldValue.delete(),
      ...(isCompanyCache ? { updatedAt: admin.firestore.FieldValue.serverTimestamp() } : { lastUpdated: new Date().toISOString() }),
    }, { merge: true });
  } else {
    await cacheRef.set({
      [field]: admin.firestore.FieldValue.increment(1),
      ...(isCompanyCache ? { updatedAt: admin.firestore.FieldValue.serverTimestamp() } : { lastUpdated: new Date().toISOString() }),
    }, { merge: true });
  }

  return { success: true };
});

/**
 * Callable Function: clearPushTokenV1
 * Clears the push token from the user's profile on logout.
 * Prevents stale token delivery to wrong-account on shared devices.
 */
export const clearPushTokenV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const profileRef = admin.firestore().doc(userProfileDocPath(uid));

  if (isSqlPersistenceEnabled()) {
    await clearUserPushTokenInSql({ uid });
  } else {
    await profileRef.set({
      pushToken: admin.firestore.FieldValue.delete(),
      pushTokenUpdatedAt: admin.firestore.FieldValue.delete(),
      pushTokenPlatform: admin.firestore.FieldValue.delete(),
      pushTokenType: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  logger.info('clearPushTokenV1: token cleared', { uid });
  return { success: true };
});
