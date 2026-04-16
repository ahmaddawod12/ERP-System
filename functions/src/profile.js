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

/**
 * Callable Function: updateProfileV1
 */
exports.updateProfileV1 = onCall(async (request) => {
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
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  const profileData = profileSnap.data();
  const companyId = profileData.companyId;
  const wid = profileData.wid;
  const mid = profileData.mid;

  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name !== undefined) updates.name = name;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

  // Keep profile and any denormalized company membership doc in sync atomically.
  if (companyId && (wid || mid)) {
    const workerRef = wid
      ? admin.firestore().doc(companyWorkerDocPath(companyId, String(wid)))
      : null;
    const managerRef = mid
      ? admin.firestore().doc(companyManagerDocPath(companyId, String(mid)))
      : null;
    await admin.firestore().runTransaction(async (tx) => {
      const workerSnap = workerRef ? await tx.get(workerRef) : null;
      const managerSnap = managerRef ? await tx.get(managerRef) : null;
      const membershipUpdates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (name !== undefined) membershipUpdates.name = name;
      if (phoneNumber !== undefined) membershipUpdates.phoneNumber = phoneNumber;

      tx.update(profileRef, updates);

      if (workerRef && workerSnap?.exists) {
        tx.update(workerRef, membershipUpdates);
        logger.info('updateProfileV1: synced worker doc atomically', {
          uid, companyId, wid, fields: Object.keys(membershipUpdates),
        });
      }

      if (managerRef && managerSnap?.exists) {
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
exports.updatePushTokenV1 = onCall(async (request) => {
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
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  // Only update if token has changed
  const currentToken = profileSnap.data().pushToken;
  if (currentToken === pushToken) {
    return { success: true, changed: false };
  }

  const now = new Date().toISOString();
  await profileRef.update({
    pushToken,
    pushTokenUpdatedAt: now,
    pushTokenPlatform,
    pushTokenType,
  });

  logger.info('updatePushTokenV1: push token updated', { uid, platform: pushTokenPlatform });
  return { success: true, changed: true };
});

/**
 * Callable Function: updateBusinessInfoV1
 * Updates business_info fields EXCEPT vat_number and document_numbers.
 * Only manager/dev roles with company access can call this.
 */
exports.updateBusinessInfoV1 = onCall(async (request) => {
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

  const businessInfoRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);
  const bizSnap = await businessInfoRef.get();
  if (!bizSnap.exists) {
    throw new HttpsError('not-found', 'Business info not found');
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

  await businessInfoRef.update(updates);

  // Bump cache
  const cacheRef = admin.firestore().doc(`companies/${companyId}/data/cache`);
  await cacheRef.set({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  logger.info('updateBusinessInfoV1: updated', { companyId, uid, fields: Object.keys(updates) });
  return { success: true };
});

/**
 * Callable Function: updateCacheV1
 * Updates cache version fields via Cloud Function.
 * Replaces direct client writes to cache documents.
 * Supports targetUid for cross-user cache writes (manager updating worker cache).
 */
exports.updateCacheV1 = onCall(async (request) => {
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
exports.clearPushTokenV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const profileSnap = await profileRef.get();

  if (profileSnap.exists) {
    await profileRef.update({
      pushToken: admin.firestore.FieldValue.delete(),
      pushTokenUpdatedAt: admin.firestore.FieldValue.delete(),
      pushTokenPlatform: admin.firestore.FieldValue.delete(),
      pushTokenType: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logger.info('clearPushTokenV1: token cleared', { uid });
  return { success: true };
});
