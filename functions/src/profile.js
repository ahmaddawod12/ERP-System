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
  requireNonEmptyString,
  optionalTrimmedString,
  normalizeRole,
  validateCompanyId,
  assertHttpCompanyAccess,
  assertTargetUserInCompany,
  HTTP_COMPANY_MANAGER_ROLES,
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

  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name !== undefined) updates.name = name;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

  // If user belongs to a company with a wid, use a transaction to keep
  // the profile and worker docs in sync atomically.
  if (companyId && wid) {
    const workerRef = admin.firestore().doc(companyWorkerDocPath(companyId, String(wid)));
    await admin.firestore().runTransaction(async (tx) => {
      const workerSnap = await tx.get(workerRef);
      tx.update(profileRef, updates);
      if (workerSnap.exists) {
        const workerUpdates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (name !== undefined) workerUpdates.name = name;
        if (phoneNumber !== undefined) workerUpdates.phoneNumber = phoneNumber;
        tx.update(workerRef, workerUpdates);
        logger.info('updateProfileV1: synced worker doc atomically', { uid, companyId, wid, fields: Object.keys(workerUpdates) });
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
 * Only manager/user/basic roles with company access can call this.
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
      updates[field] = typeof data[field] === 'string' ? data[field].trim() : data[field];
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
    await assertTargetUserInCompany(targetUid, companyId);
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
