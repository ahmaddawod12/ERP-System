/**
 * Auth domain module – manageWorker & registerBusinessV1
 */

const {
  admin,
  logger,
  onCall,
  HttpsError,
  isValidEmail,
  redactEmail,
  normalizeRole,
  toProfileRole,
  normalizeAccountType,
  validateCompanyId,
  verifyManagerAuth,
  getAuthenticatedUserProfile,
  getUserProfileOrThrow,
  userProfileDocPath,
  userCacheDocPath,
  companyWorkerDocPath,
  companyManagerDocPath,
  saveAuditLog,
  deleteUserData,
  sendPushNotification,
  requireNonEmptyString,
  optionalTrimmedString,
} = require('./shared');

// ─── manageWorker ────────────────────────────────────────────────────────────

exports.manageWorker = onCall(async (request) => {
  try {
    const {
      action,
      email,
      password,
      name,
      phoneNumber,
      companyId,
      workerUid: providedWorkerUid, // For delete/edit action (UID-based)
      wid: providedWid,             // For delete/edit action (company worker wid)
      newPassword
    } = request.data || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    logger.info('manageWorker called', { 
      action,
      email: redactEmail(normalizedEmail),
      companyId,
      hasAuth: !!request.auth,
      authEmail: request.auth?.token?.email ? redactEmail(request.auth.token.email) : undefined
    });

    // Validate action
    if (!action || !['add', 'edit', 'delete'].includes(action)) {
      throw new HttpsError('invalid-argument', "Action must be 'add', 'edit', or 'delete'");
    }

    // Validate required parameters
    if (!normalizedEmail || !companyId) {
      throw new HttpsError('invalid-argument', 'Email and company name are required');
    }
    validateCompanyId(companyId);
    if (!isValidEmail(normalizedEmail)) {
      throw new HttpsError('invalid-argument', 'Invalid worker email format');
    }
    if (password && password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
    }
    if (newPassword && newPassword.length < 8) {
      throw new HttpsError('invalid-argument', 'New password must be at least 8 characters');
    }

    // ========== ADD WORKER ==========
    if (action === 'add') {
      if (!password) {
        throw new HttpsError('invalid-argument', 'Password is required for adding a worker');
      }
      await verifyManagerAuth(request.auth, null, companyId);

      const wnextRef = admin.firestore().doc(`companies/${companyId}/counters/wnext`);
      const workerSerial = await admin.firestore().runTransaction(async (tx) => {
        const counterSnap = await tx.get(wnextRef);
        const currentWid = Number(counterSnap.data()?.next || 1);
        tx.set(wnextRef, { next: currentWid + 1 });
        return currentWid;
      });

      // I8: Create Firebase Auth user and Firestore docs with orphan cleanup on failure
      let userRecord;
      try {
        userRecord = await admin.auth().createUser({
          email: normalizedEmail,
          password: password,
          ...(name ? { displayName: String(name).trim() } : {}),
        });
      } catch (authError) {
        logger.error('Failed to create Auth user for worker', { error: authError.message });
        throw new HttpsError('internal', `Failed to create worker Auth account: ${authError.message}`);
      }
      const workerUid = userRecord.uid;

      logger.info(`Created Authentication user for worker: ${redactEmail(normalizedEmail)}`, { uid: workerUid });

      // Canonical worker paths (worker doc now keyed by wid)
      const workerProfileRef = admin.firestore().doc(userProfileDocPath(workerUid));
      const workerCacheRef = admin.firestore().doc(userCacheDocPath(workerUid));
      const workerListRef = admin.firestore().doc(companyWorkerDocPath(companyId, String(workerSerial)));

      try {
        const batch = admin.firestore().batch();
        batch.set(workerProfileRef, {
          uid: workerUid,
          role: 'worker',
          email: normalizedEmail,
          companyId: companyId,
          name: String(name || '').trim(),
          phoneNumber: String(phoneNumber || ''),
          wid: workerSerial,
          accountType: 'business',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(workerCacheRef, {
          profile: 1,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        batch.set(workerListRef, {
          uid: workerUid,
          email: normalizedEmail,
          name: String(name || '').trim(),
          phoneNumber: String(phoneNumber || ''),
          wid: workerSerial,
          role: 'worker',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await batch.commit();
      } catch (batchError) {
        // I8: Clean up orphaned Auth user if Firestore batch fails
        logger.error('Firestore batch failed after Auth user creation, cleaning up orphan', {
          uid: workerUid,
          error: batchError.message,
        });
        try {
          await admin.auth().deleteUser(workerUid);
          logger.info('Orphaned Auth user cleaned up successfully', { uid: workerUid });
        } catch (cleanupErr) {
          logger.error('Failed to clean up orphaned Auth user — manual intervention required', {
            uid: workerUid,
            email: normalizedEmail,
            cleanupError: cleanupErr.message,
          });
          // Write a marker document so orphaned users can be reconciled later
          try {
            await admin.firestore().doc(`system/orphaned_users/pending/${workerUid}`).set({
              uid: workerUid,
              email: normalizedEmail,
              companyId,
              reason: 'firestore_batch_failed',
              cleanupError: cleanupErr.message,
              createdAt: new Date().toISOString(),
            });
          } catch (_markerErr) {
            // Best effort — already logged above
          }
        }
        throw new HttpsError('internal', 'Failed to create worker Firestore documents');
      }

      logger.info(`Created Firestore profile for worker: ${redactEmail(normalizedEmail)} (uid: ${workerUid})`);

      logger.info(`Added worker to company list: ${companyId}`);
      await saveAuditLog(companyId, 'addWorker', request.auth.uid);

      return {
        success: true,
        uid: workerUid,
        wid: workerSerial,
        message: 'Worker account created successfully'
      };
    }

    let workerUid = providedWorkerUid || null;
    let wid = providedWid || null;

    // P0-7: Require workerUid for edit/delete — email-based lookup is deprecated
    if (!workerUid) {
      throw new HttpsError('invalid-argument', 'workerUid is required for edit/delete operations');
    }

    await verifyManagerAuth(request.auth, workerUid, companyId);

    // Look up the worker's wid from their profile if not provided
    if (!wid) {
      const workerProfile = await admin.firestore().doc(userProfileDocPath(workerUid)).get();
      if (workerProfile.exists) {
        wid = workerProfile.data()?.wid ?? null;
      }
    }
    // Also try to find by querying workers collection by uid
    if (!wid) {
      const workersColRef = admin.firestore().collection(`companies/${companyId}/workers`);
      const workerDocSnap = await workersColRef.where('uid', '==', workerUid).limit(1).get();
      if (!workerDocSnap.empty) {
        wid = workerDocSnap.docs[0].data()?.wid ?? workerDocSnap.docs[0].id;
      }
    }

    if (!wid) {
      throw new HttpsError('not-found', 'Worker record not found in company workers list');
    }

    // ========== DELETE WORKER ==========
    if (action === 'delete') {
      // Delete Authentication user
      try {
        await admin.auth().deleteUser(workerUid);
      } catch (deleteAuthError) {
        if (deleteAuthError.code !== 'auth/user-not-found') {
          throw deleteAuthError;
        }
      }
      logger.info(`Deleted Authentication user for worker: ${redactEmail(normalizedEmail)} (uid: ${workerUid})`);

      logger.info(`Starting user data delete for worker uid: ${workerUid}`);
      await deleteUserData(workerUid);

      const workerBatch = admin.firestore().batch();
      workerBatch.delete(admin.firestore().doc(companyWorkerDocPath(companyId, String(wid))));
      await workerBatch.commit();
      logger.info(`Removed worker from company list: ${companyId}`);

      // Cleanup pending jobs assigned to the deleted worker
      try {
        const jobsRef = admin.firestore().collection(`companies/${companyId}/jobs`);
        const assignedJobsSnap = await jobsRef
          .where('wid', '==', String(wid))
          .where('status', 'in', ['pending', 'waiting'])
          .get();
        if (!assignedJobsSnap.empty) {
          const cleanupBatch = admin.firestore().batch();
          let cleanupCount = 0;
          assignedJobsSnap.docs.forEach((doc) => {
            // Unassign the worker from the job rather than deleting it
            cleanupBatch.update(doc.ref, {
              wid: admin.firestore.FieldValue.delete(),
              wname: admin.firestore.FieldValue.delete(),
              status: 'pending',
              updatedAt: new Date().toISOString(),
            });
            cleanupCount++;
          });
          await cleanupBatch.commit();
          logger.info(`Unassigned ${cleanupCount} pending jobs from deleted worker: ${workerUid}`);

          // Bump jobs cache version
          const companyCacheRef = admin.firestore().doc(`companies/${companyId}/data/cache`);
          await companyCacheRef.set({
            jobsVersion: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      } catch (cleanupErr) {
        // Log but don't fail the entire delete operation
        logger.warn('Failed to cleanup pending jobs for deleted worker', { workerUid, error: cleanupErr.message });
      }

      await saveAuditLog(companyId, 'deleteWorker', request.auth.uid);

      return {
        success: true,
        message: 'Worker account deleted successfully'
      };
    }

    // ========== EDIT WORKER ==========
    if (action === 'edit') {
      if (!newPassword && name === undefined && phoneNumber === undefined && !request.data?.role) {
        throw new HttpsError('invalid-argument', 'At least one field must be provided for update');
      }

      // Validate role if provided — hard-whitelist to prevent privilege escalation
      const EDITABLE_ROLES = ['worker', 'user', 'basic'];
      const newRole = request.data?.role ? toProfileRole(normalizeRole(request.data.role)) : null;
      if (request.data?.role && !newRole) {
        throw new HttpsError('invalid-argument', 'Invalid role value');
      }
      if (newRole && !EDITABLE_ROLES.includes(newRole)) {
        throw new HttpsError('permission-denied', `Cannot assign role "${newRole}". Allowed roles: ${EDITABLE_ROLES.join(', ')}`);
      }

      // Read worker profile (using UID-based path)
      const workerProfileRef = admin.firestore().doc(userProfileDocPath(workerUid));
      const workerProfile = await workerProfileRef.get();

      if (!workerProfile.exists) {
        throw new HttpsError('not-found', 'Worker profile not found');
      }

      // Prepare Authentication updates
      const authUpdates = {};
      if (newPassword) {
        authUpdates.password = newPassword;
      }
      if (name !== undefined) {
        authUpdates.displayName = String(name || '').trim();
      }

      // Update Firebase Authentication
      if (Object.keys(authUpdates).length > 0) {
        await admin.auth().updateUser(workerUid, authUpdates);
        logger.info(`Updated Authentication for worker: ${redactEmail(normalizedEmail)}`, {
          updatedFields: Object.keys(authUpdates),
        });
      }

      // Prepare Firestore updates
      const existingRole = toProfileRole(workerProfile.data()?.role || 'worker') || 'worker';
      const firestoreUpdates = {};
      if (name !== undefined) {
        firestoreUpdates.name = String(name || '').trim();
      }
      if (phoneNumber !== undefined) {
        firestoreUpdates.phoneNumber = String(phoneNumber || '');
      }
      if (newRole) {
        firestoreUpdates.role = newRole;
      }
      firestoreUpdates.email = normalizedEmail;
      firestoreUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      // Update worker profile in Firestore
      if (Object.keys(firestoreUpdates).length > 0) {
        await workerProfileRef.set(firestoreUpdates, { merge: true });
        logger.info(`Updated Firestore profile for worker: ${redactEmail(normalizedEmail)} (uid: ${workerUid})`);
      }

      // Update company's worker list (keyed by wid)
      const workerListRef = admin.firestore().doc(companyWorkerDocPath(companyId, String(wid)));
      const updateData = {};
      updateData.uid = workerUid;
      updateData.email = normalizedEmail;
      updateData.wid = Number(wid);
      updateData.role = newRole || existingRole;
      updateData.password = admin.firestore.FieldValue.delete(); // Remove legacy plaintext password field
      if (name !== undefined) {
        updateData.name = String(name || '').trim();
      }
      if (phoneNumber !== undefined) {
        updateData.phoneNumber = String(phoneNumber || '');
      }
      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      if (Object.keys(updateData).length > 0) {
        await workerListRef.set(updateData, { merge: true });
        logger.info(`Updated worker in company list: ${companyId}`);
      }

      await saveAuditLog(companyId, 'editWorker', request.auth.uid);

      return {
        success: true,
        message: 'Worker account updated successfully'
      };
    }

  } catch (error) {
    const requestedAction = request?.data?.action || 'unknown';
    logger.error(`Error managing worker (${requestedAction}):`, error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email already in use');
    }
    if (error.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    if (error.code === 'auth/weak-password') {
      throw new HttpsError('invalid-argument', 'Password is too weak');
    }
    
    throw new HttpsError('internal', `Failed to ${requestedAction} worker: ` + error.message);
  }
});

// ─── registerBusinessV1 ──────────────────────────────────────────────────────

exports.registerBusinessV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email;
  const data = request.data || {};

  // Validate role
  const rawRole = typeof data.role === 'string' ? data.role.trim() : '';
  const role = normalizeRole(rawRole);
  if (!role || !['manager', 'user', 'basic'].includes(role)) {
    throw new HttpsError('invalid-argument', 'role must be manager, user, or basic');
  }

  // Validate account type
  const rawAccountType = typeof data.accountType === 'string' ? data.accountType.trim() : '';
  const accountType = normalizeAccountType(rawAccountType);
  if (!accountType) {
    throw new HttpsError('invalid-argument', 'accountType must be solo or business');
  }

  // Validate name
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : '';

  // Validate business info fields
  // Solo users (user/basic) don't require business fields; managers do.
  const isSoloRole = (role === 'user' || role === 'basic');
  const heName = isSoloRole
    ? optionalTrimmedString(data.he_name || data.name || '', 200)
    : requireNonEmptyString(data.he_name || '', 'he_name', 1, 200);
  const enName = optionalTrimmedString(data.en_name || '', 200);
  const vatNumber = isSoloRole
    ? optionalTrimmedString(data.vat_number || '', 50)
    : requireNonEmptyString(data.vat_number || '', 'vat_number', 1, 50);
  const businessType = isSoloRole
    ? optionalTrimmedString(data.business_type || 'solo', 100)
    : requireNonEmptyString(data.business_type || '', 'business_type', 1, 100);
  const city = optionalTrimmedString(data.city || '', 200);
  const address = optionalTrimmedString(data.address || '', 500);

  // Optional fields
  const businessEmail = optionalTrimmedString(data.business_email || '', 200);
  const businessPhone = optionalTrimmedString(data.business_phone || '', 30);
  const businessFax = optionalTrimmedString(data.business_fax || '', 30);
  const accountantName = optionalTrimmedString(data.accountant_name || '', 200);
  const accountantEmail = optionalTrimmedString(data.accountant_email || '', 200);
  const accountantPhone = optionalTrimmedString(data.accountant_phone || '', 30);

  // Document numbers — server sets starting values (always 1)
  const documentNumbers = {
    305: 1, 400: 1, 330: 1, 210: 1, 10: 1, 200: 1,
  };

  // P1-1: Use transaction with create-if-absent to prevent concurrent registration race
  const dbRef = admin.firestore();
  const profileRole = toProfileRole(role);

  let companyId = '';

  const now = new Date().toISOString();

  // Build business info data
  const businessData = {
    he_name: heName,
    en_name: enName,
    vat_number: vatNumber,
    business_type: businessType,
    city,
    address,
    document_numbers: documentNumbers,
    registered_at: now,
    registered_by: uid,
    registered_by_role: profileRole,
    last_updated: now,
  };
  if (businessEmail) businessData.business_email = businessEmail;
  if (businessPhone) businessData.business_phone = businessPhone;
  if (businessFax) businessData.business_fax = businessFax;
  if (accountantName) businessData.accountant_name = accountantName;
  if (accountantEmail) businessData.accountant_email = accountantEmail;
  if (accountantPhone) businessData.accountant_phone = accountantPhone;

  // Determine subscription tier
  const tierMap = { manager: 'Team', user: 'Solo', basic: 'Basic' };
  const tier = tierMap[role] || 'Basic';
  const enabledModules = {
    team: tier === 'Team' || tier === 'Enterprise',
    solojob: tier !== 'Basic',
    documents: true,
    teaminventory: tier === 'Team' || tier === 'Enterprise',
    companyinventory: tier === 'Team' || tier === 'Enterprise',
    inventory: tier !== 'Basic',
  };

  // Transactional registration — prevents race where concurrent calls both pass precheck
  await dbRef.runTransaction(async (tx) => {
    const profileRef = dbRef.doc(userProfileDocPath(uid));
    const companyCounterRef = dbRef.doc('system/data/comid');
    const [existingProfile, companyCounterSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(companyCounterRef),
    ]);

    if (existingProfile.exists && existingProfile.data()?.companyId) {
      throw new HttpsError('already-exists', 'User is already registered with a company');
    }

    const companyCounterData = companyCounterSnap.exists ? (companyCounterSnap.data() || {}) : {};
    const rawNextCompanyId = companyCounterData.comid;
    const nextCompanyId = companyCounterSnap.exists ? Number(rawNextCompanyId) : 1;

    if (!Number.isInteger(nextCompanyId) || nextCompanyId < 1) {
      throw new HttpsError(
        'failed-precondition',
        'system/data/comid must contain a positive integer field "comid"'
      );
    }

    companyId = String(nextCompanyId);
    tx.set(companyCounterRef, {
      comid: nextCompanyId + 1,
      updatedAt: now,
      lastAllocatedCompanyId: companyId,
      lastAllocatedBy: uid,
    }, { merge: true });

    // 1. Profile
    tx.set(profileRef, {
      uid,
      email,
      role: profileRole,
      companyId,
      accountType,
      name,
      phoneNumber,
      ...(role === 'manager' ? { mid: 1 } : {}),
      ...(role !== 'manager' ? { wid: 1 } : {}),
      createdAt: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. User cache
    tx.set(dbRef.doc(userCacheDocPath(uid)), {
      profile: 1,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (role === 'manager' && accountType === 'business') {
      // 3. Company root doc (clean — no counters on root)
      tx.set(dbRef.doc(`companies/${companyId}`), {
        companyId,
        createdBy: uid,
        createdAt: now,
      });

      // 4. Counter documents (each in its own doc for safe concurrent writes)
      tx.set(dbRef.doc(`companies/${companyId}/counters/wnext`), { next: 1 });
      tx.set(dbRef.doc(`companies/${companyId}/counters/mnext`), { next: 2 }); // manager 1 is the creator
      tx.set(dbRef.doc(`companies/${companyId}/counters/cnext`), { next: 1 });
      tx.set(dbRef.doc(`companies/${companyId}/counters/jnext`), { next: 1 });

      // 5. Manager record in workers collection (keyed by mid=1)
      tx.set(dbRef.doc(companyManagerDocPath(companyId, '1')), {
        uid,
        mid: 1,
        role: profileRole,
        email,
        name,
        phoneNumber,
        createdAt: now,
        updatedAt: now,
      });

      // 6. Business info
      tx.set(dbRef.doc(`companies/${companyId}/data/business_info`), businessData);

      // 7. Subscription
      tx.set(dbRef.doc(`companies/${companyId}/data/subscription`), {
        tier,
        status: 'active',
        enabledModules,
        updatedAt: now,
      });

      // 8. Empty inventory
      tx.set(dbRef.doc(`companies/${companyId}/data/inventory`), {
        parts: [],
        nextId: 1,
        lastUpdated: now,
      });

      // 9. Company cache (summary-based)
      tx.set(dbRef.doc(`companies/${companyId}/data/cache`), {
        jobsVersion: 0,
        documentsVersion: 0,
        clientsVersion: 0,
        workersVersion: 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Non-manager/single-user workspace uses companyId allocated from system/data/comid
      const hasWorkerMembership = role !== 'manager';

      tx.set(dbRef.doc(`companies/${companyId}`), {
        companyId,
        createdBy: uid,
        createdAt: now,
      });

      // Counter documents (all roles get counters for upgrade compatibility)
      tx.set(dbRef.doc(`companies/${companyId}/counters/wnext`), { next: hasWorkerMembership ? 2 : 1 });
      tx.set(dbRef.doc(`companies/${companyId}/counters/mnext`), { next: 1 });
      tx.set(dbRef.doc(`companies/${companyId}/counters/cnext`), { next: 1 });
      tx.set(dbRef.doc(`companies/${companyId}/counters/jnext`), { next: 1 });

      tx.set(dbRef.doc(`companies/${companyId}/data/business_info`), businessData);

      tx.set(dbRef.doc(`companies/${companyId}/data/subscription`), {
        tier,
        status: 'active',
        enabledModules,
        updatedAt: now,
      });

      if (hasWorkerMembership) {
        // Canonical non-manager membership record keyed by wid.
        tx.set(dbRef.doc(companyWorkerDocPath(companyId, '1')), {
          uid,
          wid: 1,
          role: profileRole,
          email,
          name,
          phoneNumber,
          createdAt: now,
          updatedAt: now,
        });
      }

      tx.set(dbRef.doc(`companies/${companyId}/data/inventory`), {
        parts: [],
        nextId: 1,
        lastUpdated: now,
      });

      // Company cache (summary-based)
      tx.set(dbRef.doc(`companies/${companyId}/data/cache`), {
        jobsVersion: 0,
        documentsVersion: 0,
        clientsVersion: 0,
        workersVersion: hasWorkerMembership ? 1 : 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  logger.info('registerBusinessV1: registered', { uid, companyId, role, accountType });

  return {
    success: true,
    companyId,
    role: profileRole,
    tier,
  };
});

module.exports = {
  manageWorker: exports.manageWorker,
  registerBusinessV1: exports.registerBusinessV1,
};
