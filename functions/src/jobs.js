const {
  admin,
  logger,
  onCall,
  HttpsError,
  onDocumentCreated,
  onDocumentUpdated,
  validateCompanyId,
  assertHttpCompanyAccess,
  getUserProfileOrThrow,
  userProfileDocPath,
  sendPushNotification,
  companyWorkerDocPath,
  companyManagerDocPath,
  MAX_JOB_ARRAY_LENGTH,
  HTTP_COMPANY_MANAGER_ROLES,
  HTTP_ALL_APP_ROLES,
} = require('./shared');
const {
  JobMutationError,
  resolveJobMutationPayload,
} = require('./job-mutation-resolver');

const JOB_FILE_DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

function rethrowJobMutationError(error) {
  if (error instanceof HttpsError) {
    throw error;
  }
  if (error instanceof JobMutationError) {
    throw new HttpsError(error.code, error.message);
  }
  throw error;
}

async function loadWorkerIdentity(tx, dbRef, companyId, wid) {
  const normalizedWid = String(wid || '').trim();
  if (!normalizedWid) return null;

  const workerRef = dbRef.doc(`companies/${companyId}/workers/${normalizedWid}`);
  const workerSnap = await tx.get(workerRef);
  if (!workerSnap.exists) return null;
  const workerData = workerSnap.data() || {};

  return {
    wid: normalizedWid,
    name: String(workerData.name || workerData.email || normalizedWid).trim(),
  };
}

async function loadClientIdentity(tx, dbRef, companyId, clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return null;

  const clientRef = dbRef.doc(`companies/${companyId}/clients/${normalizedClientId}`);
  const clientSnap = await tx.get(clientRef);
  if (!clientSnap.exists) return null;
  const clientData = clientSnap.data() || {};

  return {
    id: normalizedClientId,
    name: String(clientData.name || clientData.cname || '').trim(),
    phone: String(clientData.phone || clientData.cphone || '').trim(),
  };
}

function requiresAssignedJobScope(role, isSoloScope) {
  return role === 'worker' || (role === 'user' && !isSoloScope);
}

function normalizeJobFileStoragePath(value) {
  const normalized = String(value || '').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('?')) {
    return '';
  }
  return normalized;
}

function collectJobFileStoragePaths(jobId, jobData) {
  const fileEntries = [];
  const photos = Array.isArray(jobData?.photos) ? jobData.photos : [];
  const signature = jobData?.signature;

  for (const photo of photos) {
    fileEntries.push(photo);
  }
  if (signature) {
    fileEntries.push(signature);
  }

  const storagePaths = new Set();
  for (const entry of fileEntries) {
    const candidate = typeof entry === 'string'
      ? entry
      : (typeof entry?.storagePath === 'string' ? entry.storagePath : '');
    const normalized = normalizeJobFileStoragePath(candidate);
    const parts = normalized.split('/');
    if (parts.length >= 4 && parts[1] === 'jobs' && parts[2] === jobId) {
      storagePaths.add(normalized);
    }
  }

  return Array.from(storagePaths);
}

function normalizePartsUsed(partsUsed) {
  if (!Array.isArray(partsUsed)) return [];
  return partsUsed.map((part, index) => {
    const quantity = Number(part?.quantity);
    if (!part || typeof part !== 'object' || !Number.isFinite(quantity) || quantity < 0) {
      throw new HttpsError('invalid-argument', `partsUsed[${index}].quantity must be a non-negative finite number`);
    }
    if (part.id === undefined || part.id === null || String(part.id).trim() === '') {
      throw new HttpsError('invalid-argument', `partsUsed[${index}].id is required`);
    }
    return { ...part, quantity };
  });
}

exports.onJobAssignTrigger = onDocumentCreated({
  document: 'companies/{companyId}/jobs/{jobId}',
  region: 'us-central1'
}, async (event) => {
  const startTime = Date.now();
  
  try {
    const snapshot = event.data;
    const jobData = snapshot.data();
    const companyId = event.params.companyId;
    const jobId = event.params.jobId;

    // Only proceed if status is 'pending' and job is assigned to a worker
    if (!jobData || jobData.status !== 'pending' || !jobData.wid) {
      logger.info('Job not eligible for assignment notification', {
        jobId,
        status: jobData?.status,
        hasWid: !!jobData?.wid
      });
      return;
    }

    // Look up the worker's uid from the workers collection using wid
    const workerDocRef = admin.firestore().doc(companyWorkerDocPath(companyId, jobData.wid));
    const workerDocSnap = await workerDocRef.get();
    if (!workerDocSnap.exists) {
      logger.warn('Worker doc not found for job assignment notification', { wid: jobData.wid, companyId });
      return;
    }
    const workerUserId = workerDocSnap.data()?.uid;
    if (!workerUserId) {
      logger.warn('Worker doc missing uid field', { wid: jobData.wid });
      return;
    }

    const jobTitle = jobData.title || 'Untitled Job';
    const managerName = jobData.mname;
    let managerUserId = null;
    const managerMid = jobData.mid;
    if (managerMid) {
      const managerDocRef = admin.firestore().doc(companyManagerDocPath(companyId, managerMid));
      const managerDocSnap = await managerDocRef.get();
      if (managerDocSnap.exists) {
        managerUserId = managerDocSnap.data()?.uid || null;
      }
    }

    logger.info('Job assignment detected', {
      jobId,
      jobTitle,
      workerUserId,
      managerUserId,
      companyId
    });

    // DEDUPLICATION: use create() which fails if doc already exists, preventing
    // race conditions where two trigger executions both read "not exists"
    const notificationLogId = `${jobId}_assigned`;
    const notificationLogRef = admin.firestore().doc(`notificationLog/${notificationLogId}`);

    // Get worker profile for email and push token (using UID-based path)
    const workerProfileRef = admin.firestore().doc(userProfileDocPath(workerUserId));
    const workerProfile = await workerProfileRef.get();

    if (!workerProfile.exists) {
      logger.warn('Worker profile not found', { workerUserId });
      return;
    }

    const workerData = workerProfile.data();
    const workerEmail = workerData?.email;
    const workerPushToken = workerData?.pushToken;

    if (!workerEmail) {
      logger.warn('No email found in worker profile', { workerUserId });
      return;
    }

    if (!workerPushToken) {
      logger.info('No push token for worker - notification skipped', {
        workerUserId,
        workerEmail,
        message: 'Worker will see job when they login'
      });
      return;
    }

    // Prepare notification content
    const notificationTitle = '🔔 New Job Assigned!';
    const notificationBody = `${managerName} assigned you: "${jobTitle}"`;
    const notificationData = {
      type: 'job_assigned',
      jobId,
      companyId,
      screen: 'Workerjob',
      timestamp: new Date().toISOString()
    };

    // Claim the dedup slot before sending the external push side effect.
    try {
      await notificationLogRef.create({
        jobId,
        notificationType: 'assigned',
        workerUserId,
        workerEmail,
        managerUserId,
        managerName,
        jobTitle,
        companyId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: null,
        notificationSent: false,
        status: 'claimed',
        // TTL: auto-expire after 30 days (configure Firestore TTL policy on this field)
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (dedupErr) {
      if (dedupErr.code === 6 /* ALREADY_EXISTS */) {
        logger.info('Notification already claimed (dedup race caught)', { jobId, notificationLogId });
        return;
      }
      throw dedupErr;
    }

    // Send push notification (with retry)
    let notificationResult = { success: false };
    const MAX_NOTIFICATION_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_NOTIFICATION_RETRIES; attempt++) {
      notificationResult = await sendPushNotification(
        workerPushToken,
        notificationTitle,
        notificationBody,
        notificationData,
        workerUserId
      );
      if (notificationResult.success) break;
      if (attempt < MAX_NOTIFICATION_RETRIES) {
        logger.warn('Push notification failed, retrying', { attempt: attempt + 1, jobId });
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }

    // Atomically claim the dedup slot — create() fails if doc already exists
    await notificationLogRef.update({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      notificationSent: notificationResult.success,
      status: notificationResult.success ? 'sent' : 'failed',
      messageId: notificationResult.messageId || null,
      duration: Date.now() - startTime
    });

    logger.info('Job assignment notification sent', {
      jobId,
      workerUserId,
      notificationSent: notificationResult.success,
      messageId: notificationResult.messageId,
      duration: Date.now() - startTime
    });

  } catch (error) {
    logger.error('Error in onJobAssignTrigger', {
      error: error.message,
      stack: error.stack,
      jobId: event.params.jobId,
      companyId: event.params.companyId
    });
  }
});

exports.onJobSubmitTrigger = onDocumentUpdated({
  document: 'companies/{companyId}/jobs/{jobId}',
  region: 'us-central1'
}, async (event) => {
  const startTime = Date.now();
  
  try {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const companyId = event.params.companyId;
    const jobId = event.params.jobId;

    // Only proceed if status changed to 'waiting'
    if (!afterData || afterData.status !== 'waiting' || beforeData.status === 'waiting') {
      logger.info('Job not eligible for submission notification', {
        jobId,
        beforeStatus: beforeData?.status,
        afterStatus: afterData?.status
      });
      return;
    }

    let workerUserId = null;
    if (afterData.wid) {
      const workerDocRef = admin.firestore().doc(companyWorkerDocPath(companyId, String(afterData.wid)));
      const workerDocSnap = await workerDocRef.get();
      if (workerDocSnap.exists) {
        workerUserId = workerDocSnap.data()?.uid || null;
      }
    }
    const jobTitle = afterData.title || 'Untitled Job';
    const workerName = afterData.wname;

    // Look up manager uid from their mid
    const managerMid = afterData.mid;
    let managerUserId = null;
    if (managerMid) {
      const managerDocRef = admin.firestore().doc(companyManagerDocPath(companyId, managerMid));
      const managerDocSnap = await managerDocRef.get();
      if (managerDocSnap.exists) {
        managerUserId = managerDocSnap.data()?.uid;
      }
    }

    logger.info('Job submission detected', {
      jobId,
      jobTitle,
      workerWid: afterData.wid,
      managerMid,
      companyId
    });

    // DEDUPLICATION: use create() which fails if doc already exists, preventing
    // race conditions where two trigger executions both read "not exists"
    const notificationLogId = `${jobId}_submitted`;
    const notificationLogRef = admin.firestore().doc(`notificationLog/${notificationLogId}`);

    // Determine manager userId
    if (!managerUserId) {
      logger.warn('No manager uid resolved from mid', { jobId, companyId, mid: afterData.mid });
      return;
    }

    // Get manager profile for email and push token (using UID-based path)
    const managerProfileRef = admin.firestore().doc(userProfileDocPath(managerUserId));
    const managerProfile = await managerProfileRef.get();

    if (!managerProfile.exists) {
      logger.warn('Manager profile not found', { managerUserId });
      return;
    }

    const managerData = managerProfile.data();
    const managerEmail = managerData?.email;
    const managerPushToken = managerData?.pushToken;

    if (!managerEmail) {
      logger.warn('No email found in manager profile', { managerUserId });
      return;
    }

    if (!managerPushToken) {
      logger.info('No push token for manager - notification skipped', {
        managerUserId,
        managerEmail,
        message: 'Manager will see job when they login'
      });
      return;
    }

    // Prepare notification content
    const notificationTitle = '✅ Job Submitted for Review';
    const notificationBody = `${workerName} submitted: "${jobTitle}"`;
    const notificationData = {
      type: 'job_submitted',
      jobId,
      companyId,
      screen: 'ManageJobs',
      timestamp: new Date().toISOString()
    };

    // Claim the dedup slot before sending the external push side effect.
    try {
      await notificationLogRef.create({
        jobId,
        notificationType: 'submitted',
        workerUserId,
        workerName,
        managerUserId,
        managerEmail,
        jobTitle,
        companyId,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: null,
        notificationSent: false,
        status: 'claimed',
        // TTL: auto-expire after 30 days (configure Firestore TTL policy on this field)
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (dedupErr) {
      if (dedupErr.code === 6 /* ALREADY_EXISTS */) {
        logger.info('Notification already claimed (dedup race caught)', { jobId, notificationLogId });
        return;
      }
      throw dedupErr;
    }

    // Send push notification
    const notificationResult = await sendPushNotification(
      managerPushToken,
      notificationTitle,
      notificationBody,
      notificationData,
      managerUserId
    );

    // Atomically claim the dedup slot — create() fails if doc already exists
    await notificationLogRef.update({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      notificationSent: notificationResult.success,
      status: notificationResult.success ? 'sent' : 'failed',
      messageId: notificationResult.messageId || null,
      duration: Date.now() - startTime
    });

    logger.info('Job submission notification sent', {
      jobId,
      managerUserId,
      workerUserId,
      notificationSent: notificationResult.success,
      messageId: notificationResult.messageId,
      duration: Date.now() - startTime
    });

  } catch (error) {
    logger.error('Error in onJobSubmitTrigger', {
      error: error.message,
      stack: error.stack,
      jobId: event.params.jobId,
      companyId: event.params.companyId
    });
  }
});

exports.deleteJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'jobId is required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_ALL_APP_ROLES,
    allowSoloScope: true,
  });

  // Basic role cannot delete jobs
  if (resolvedRole === 'basic') {
    throw new HttpsError('permission-denied', 'basic role cannot delete jobs');
  }

  // Look up worker wid once before transaction (profile is immutable within request)
  let callerWid = '';
  if (resolvedRole === 'worker' || resolvedRole === 'user') {
    const callerProfile = await admin.firestore().doc(userProfileDocPath(uid)).get();
    callerWid = callerProfile.exists ? String(callerProfile.data()?.wid || '') : '';
  }

  const dbRef = admin.firestore();
  const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);

  // Use a transaction for atomic read-check-delete to prevent race conditions
  const deleteResult = await dbRef.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);

    if (!jobSnap.exists) {
      throw new HttpsError('not-found', 'Job not found');
    }

    const jobData = jobSnap.data();

    // Cannot delete a job with a generated document
    if (jobData.isCert === true) {
      throw new HttpsError('failed-precondition', 'Cannot delete a job that has a generated document (isCert=true)');
    }

    // Only manager/dev can delete pending/waiting jobs
    if (['pending', 'waiting'].includes(jobData.status)) {
      if (!['manager', 'dev'].includes(resolvedRole)) {
        throw new HttpsError('permission-denied', 'Only managers can delete pending jobs');
      }
    }

    // Worker can only delete their own assigned jobs
    if (resolvedRole === 'worker') {
      if (String(jobData.wid || '') !== callerWid) {
        throw new HttpsError('permission-denied', 'Workers can only delete their own jobs');
      }
    }

    // User (solo) can only delete their own assigned jobs
    if (resolvedRole === 'user') {
      if (String(jobData.wid || '') !== callerWid) {
        throw new HttpsError('permission-denied', 'Users can only delete their own jobs');
      }
    }

    let ownerUid = '';
    const assignedWid = String(jobData.wid || '').trim();
    if (assignedWid) {
      const workerRef = dbRef.doc(companyWorkerDocPath(companyId, assignedWid));
      const workerSnap = await tx.get(workerRef);
      ownerUid = workerSnap.exists ? String(workerSnap.data()?.uid || '').trim() : '';
    }

    const storagePaths = collectJobFileStoragePaths(jobId, jobData);

    tx.delete(jobRef);

    // Bump cache inside transaction
    const cacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(cacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { status: jobData.status, ownerUid, storagePaths };
  });

  const bucket = admin.storage().bucket();
  for (const storagePath of deleteResult.storagePaths) {
    try {
      await bucket.file(storagePath).delete({ ignoreNotFound: true });
    } catch (storageError) {
      logger.error('deleteJobV1: failed to delete canonical job file', {
        companyId,
        jobId,
        storagePath,
        error: storageError.message,
      });
    }
  }

  if (deleteResult.ownerUid) {
    try {
      const [files] = await bucket.getFiles({ prefix: `${deleteResult.ownerUid}/jobs/${jobId}/` });
      await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
    } catch (storageError) {
      logger.error('deleteJobV1: failed to delete legacy job file folder', {
        companyId,
        jobId,
        ownerUid: deleteResult.ownerUid,
        error: storageError.message,
      });
    }
  }

  logger.info('deleteJobV1: job deleted', { companyId, jobId, uid, status: deleteResult.status });
  return { success: true, jobId };
});

exports.acceptJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'jobId is required');
  }

  // Only manager/dev can accept jobs
  await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
    allowSoloScope: false,
  });

  const dbRef = admin.firestore();

  // Use a transaction for atomicity
  const result = await dbRef.runTransaction(async (tx) => {
    const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);
    const jobSnap = await tx.get(jobRef);

    if (!jobSnap.exists) {
      throw new HttpsError('not-found', 'Job not found');
    }

    const jobData = jobSnap.data();

    // Validate source status — only accept from valid transition states
    const validSourceStatuses = ['pending', 'waiting'];
    if (jobData.status && !validSourceStatuses.includes(jobData.status)) {
      throw new HttpsError('failed-precondition',
        `Cannot accept job with status "${jobData.status}". Expected: ${validSourceStatuses.join(', ')}`);
    }

    const now = new Date().toISOString();

    // Deduct worker inventory if partsUsed exists
    const partsUsed = normalizePartsUsed(jobData.partsUsed || jobData.parts || []);
    const jobWid = jobData.wid;

    // Resolve worker UID from wid for inventory deduction
    let workerUid = null;
    let workerInvRef = null;
    let workerInvSnap = null;
    if (jobWid) {
      const workerDocRef = dbRef.doc(companyWorkerDocPath(companyId, jobWid));
      const workerDocSnap = await tx.get(workerDocRef);
      if (workerDocSnap.exists) {
        workerUid = workerDocSnap.data()?.uid;
      }
    }

    if (Array.isArray(partsUsed) && partsUsed.length > 0 && workerUid) {
      workerInvRef = dbRef.doc(`users/${workerUid}/data/inventory`);
      workerInvSnap = await tx.get(workerInvRef);
    }

    // Update job status in-place after all reads; Firestore transactions reject read-after-write.
    tx.update(jobRef, {
      status: 'finished',
      finishedAt: jobData.finishedAt || now,
      isCert: jobData.isCert === true,
      acceptedBy: uid,
      acceptedAt: now,
      updatedAt: now,
    });

    if (workerInvRef && workerInvSnap?.exists) {
        const invData = workerInvSnap.data() || {};
        const currentParts = Array.isArray(invData.parts) ? invData.parts : [];

        const updatedParts = currentParts.map((p) => {
          const usedPart = partsUsed.find((u) => u.id === p.id);
          if (usedPart && typeof usedPart.quantity === 'number') {
            const newQty = Math.max(0, (p.quantity || 0) - usedPart.quantity);
            return { ...p, quantity: newQty };
          }
          return p;
        });

        tx.update(workerInvRef, {
          parts: updatedParts,
          lastUpdated: now,
        });

        // Bump worker cache version
        const workerCacheRef = dbRef.doc(`users/${workerUid}/data/cache`);
        tx.set(workerCacheRef, {
          inventory: admin.firestore.FieldValue.increment(1),
          lastUpdated: now,
        }, { merge: true });
    }

    // Bump company cache
    const companyCacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(companyCacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { jobId, wid: jobWid };
  });

  logger.info('acceptJobV1: job accepted', {
    companyId, jobId, uid,
  });

  return { success: true, jobId: result.jobId };
});

exports.createJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);

  // N3: Optional idempotency key to prevent duplicate job creation on retries
  const idempotencyKey = typeof data.idempotencyKey === 'string' ? data.idempotencyKey.trim() : '';

  // type: 'pending' | 'finished' — determines initial status
  const jobType = typeof data.type === 'string' ? data.type.trim() : 'pending';
  if (!['pending', 'finished'].includes(jobType)) {
    throw new HttpsError('invalid-argument', 'type must be pending or finished');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: ['manager', 'user', 'dev'],
    allowSoloScope: true,
  });
  const callerProfile = await getUserProfileOrThrow(uid);

  // Solo users (role=user) can only create finished jobs
  if (resolvedRole === 'user' && jobType === 'pending') {
    throw new HttpsError('permission-denied', 'Solo users cannot create pending jobs');
  }

  const dbRef = admin.firestore();
  const jnextRef = dbRef.doc(`companies/${companyId}/counters/jnext`);

  // N3: Pre-transaction idempotency check — serialized by Firestore transaction below
  if (idempotencyKey) {
    const existingQuery = await dbRef
      .collection(`companies/${companyId}/jobs`)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingQuery.empty) {
      const existingJob = existingQuery.docs[0];
      logger.info('createJobV1: idempotent duplicate detected', { idempotencyKey, existingJobId: existingJob.id });
      return { success: true, jobId: existingJob.id, duplicate: true };
    }
  }

  const result = await dbRef.runTransaction(async (tx) => {
    if (idempotencyKey) {
      const existingQuery = dbRef
        .collection(`companies/${companyId}/jobs`)
        .where('idempotencyKey', '==', idempotencyKey)
        .limit(1);
      const existingSnap = await tx.get(existingQuery);
      if (!existingSnap.empty) {
        return { jobId: existingSnap.docs[0].id, duplicate: true };
      }
    }

    const counterSnap = await tx.get(jnextRef);
    if (!counterSnap.exists) {
      throw new HttpsError('failed-precondition', 'Company job counter not initialized');
    }

    const currentJid = Number(counterSnap.data()?.next || 1);

    // No prefix — plain sequential ID
    const jobId = String(currentJid);
    const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);

    const now = new Date().toISOString();

    let jobPayload;
    try {
      jobPayload = await resolveJobMutationPayload({
        input: data,
        resolvedRole,
        callerProfile,
        jobType,
        isCreate: true,
        maxArrayLength: MAX_JOB_ARRAY_LENGTH,
        loadWorkerByWid: (wid) => loadWorkerIdentity(tx, dbRef, companyId, wid),
        loadClientById: (clientId) => loadClientIdentity(tx, dbRef, companyId, clientId),
        expectedFileJobId: jobId,
        expectedFileOwnerUid: resolvedRole === 'user' ? uid : undefined,
      });
    } catch (error) {
      rethrowJobMutationError(error);
    }

    let userInventoryUpdate = null;
    if (resolvedRole === 'user' && jobType === 'finished') {
      const usedParts = normalizePartsUsed(jobPayload.partsUsed || []);
      if (usedParts.length > 0) {
        const inventoryRef = dbRef.doc(`users/${uid}/data/inventory`);
        const inventorySnap = await tx.get(inventoryRef);
        const inventoryData = inventorySnap.exists ? (inventorySnap.data() || {}) : {};
        const currentParts = Array.isArray(inventoryData.parts) ? inventoryData.parts : [];
        userInventoryUpdate = {
          inventoryRef,
          parts: currentParts.map((part) => {
            const usedPart = usedParts.find((entry) => entry.id === part.id);
            if (!usedPart) return part;
            const currentQuantity = Number(part.quantity || 0);
            return { ...part, quantity: Math.max(0, currentQuantity - usedPart.quantity) };
          }),
        };
      }
    }

    const jobDoc = {
      ...jobPayload,
      status: jobType === 'pending' ? 'pending' : 'finished',
      createdAt: now,
      updatedAt: now,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    if (jobType === 'finished') {
      jobDoc.isCert = false;
      jobDoc.finishedAt = jobPayload.finishedAt || now;
    }

    tx.set(jnextRef, { next: currentJid + 1 });
    tx.set(jobRef, jobDoc);
    if (userInventoryUpdate) {
      tx.set(userInventoryUpdate.inventoryRef, {
        parts: userInventoryUpdate.parts,
        lastUpdated: now,
      }, { merge: true });
      tx.set(dbRef.doc(`users/${uid}/data/cache`), {
        inventory: admin.firestore.FieldValue.increment(1),
        lastUpdated: now,
      }, { merge: true });
    }

    // Bump company cache
    const companyCacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(companyCacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { jobId };
  });

  // Handle idempotent duplicate detected inside transaction
  if (result.duplicate) {
    return { success: true, jobId: result.jobId, duplicate: true };
  }

  logger.info('createJobV1: job created', {
    companyId, jobId: result.jobId, uid, jobType,
  });

  return { success: true, jobId: result.jobId };
});

exports.updateJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  if (!companyId || !jobId) {
    throw new HttpsError('invalid-argument', 'companyId and jobId are required');
  }

  const { resolvedRole, isSoloScope } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: ['manager', 'worker', 'user', 'dev'],
    allowSoloScope: true,
  });
  const callerProfile = await getUserProfileOrThrow(uid);

  // Pre-compute caller wid before transaction (profile is immutable for this request)
  let callerWid = '';
  if (requiresAssignedJobScope(resolvedRole, isSoloScope)) {
    callerWid = String(callerProfile?.wid || '');
  }

  const raw = { ...data };

  const updates = {};
  for (const key of [
    'title', 'description', 'notes', 'location', 'address',
    'category', 'priority', 'dueDate', 'tags', 'images',
    'wid', 'cid', 'cname', 'cphone',
    'parts', 'partsUsed',
    'timeFrom', 'timeTo', 'travelDistance',
    'signingPerson', 'photos', 'signature',
    'finishedAt', 'status', 'deniedAt', 'deniedBy',
  ]) {
    if (raw[key] !== undefined) {
      updates[key] = raw[key];
    }
  }

  // Role-specific restrictions for workers
  if (resolvedRole === 'worker') {
    delete updates.wid;
    delete updates.cid;
    delete updates.cname;
    delete updates.cphone;
    delete updates.deniedAt;
    delete updates.deniedBy;
    // Workers cannot set status to finished or denied — must go through acceptJobV1
    const CANONICAL_STATUSES = ['pending', 'waiting'];
    if (updates.status && !CANONICAL_STATUSES.includes(updates.status)) {
      throw new HttpsError('permission-denied', 'Workers cannot set status to ' + updates.status);
    }
  }

  // Validate status is canonical if provided
  const VALID_STATUSES = ['pending', 'waiting', 'finished', 'denied'];
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    throw new HttpsError('invalid-argument', `Invalid status: ${updates.status}. Valid: ${VALID_STATUSES.join(', ')}`);
  }
  if (raw.isCert !== undefined) {
    throw new HttpsError('permission-denied', 'isCert is server-managed and cannot be updated directly');
  }
  const dbRef = admin.firestore();
  const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);

  // Use a transaction for atomic read-check-update to prevent race conditions
  await dbRef.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);

    if (!jobSnap.exists) {
      throw new HttpsError('not-found', 'Job not found');
    }

    const existingJob = jobSnap.data();

    // Worker can only update their own assigned jobs
    if (requiresAssignedJobScope(resolvedRole, isSoloScope)) {
      if (String(existingJob.wid || '') !== callerWid) {
        throw new HttpsError('permission-denied', 'You can only update your assigned jobs');
      }
    }

    // Prevent direct status transitions that should go through acceptJobV1
    if (existingJob.status !== 'finished' && updates.status === 'finished') {
      throw new HttpsError('failed-precondition', 'Cannot transition directly to finished. Use acceptJobV1.');
    }
    if (existingJob.status === 'finished' && (updates.status === 'pending' || updates.status === 'waiting')) {
      throw new HttpsError('failed-precondition', 'Finished job cannot transition back to pending/waiting.');
    }
    // Denied jobs cannot be reopened — they are terminal
    if (existingJob.status === 'denied' && updates.status && updates.status !== 'denied') {
      throw new HttpsError('failed-precondition', 'Denied job cannot be reopened. Create a new job instead.');
    }

    let resolvedUpdates;
    try {
      resolvedUpdates = await resolveJobMutationPayload({
        input: updates,
        existingJob,
        resolvedRole,
        callerProfile,
        jobType: existingJob.status === 'finished' ? 'finished' : 'pending',
        isCreate: false,
        maxArrayLength: MAX_JOB_ARRAY_LENGTH,
        loadWorkerByWid: (wid) => loadWorkerIdentity(tx, dbRef, companyId, wid),
        loadClientById: (clientId) => loadClientIdentity(tx, dbRef, companyId, clientId),
        expectedFileJobId: jobId,
        expectedFileOwnerUid: requiresAssignedJobScope(resolvedRole, isSoloScope) ? uid : undefined,
      });
    } catch (error) {
      rethrowJobMutationError(error);
    }

    resolvedUpdates.updatedAt = new Date().toISOString();
    if (updates.status) {
      resolvedUpdates.status = updates.status;
    }
    if (updates.deniedAt !== undefined) {
      resolvedUpdates.deniedAt = updates.deniedAt;
    }
    if (updates.deniedBy !== undefined) {
      resolvedUpdates.deniedBy = updates.deniedBy;
    }

    tx.update(jobRef, resolvedUpdates);

    // Bump cache inside transaction
    const cacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(cacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('updateJobV1: job updated', { companyId, jobId, uid, role: resolvedRole });
  return { success: true, jobId };
});

exports.createJobFileDownloadUrlV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  const storagePath = normalizeJobFileStoragePath(data.storagePath);

  if (!companyId || !jobId || !storagePath) {
    throw new HttpsError('invalid-argument', 'companyId, jobId, and storagePath are required');
  }

  const pathParts = storagePath.split('/');
  if (pathParts.length < 4 || pathParts[1] !== 'jobs' || pathParts[2] !== jobId) {
    throw new HttpsError('invalid-argument', 'storagePath does not match the requested job');
  }

  const ownerUid = pathParts[0];
  const { resolvedRole, isSoloScope } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: ['manager', 'worker', 'user', 'dev'],
    allowSoloScope: true,
  });

  const callerProfile = await getUserProfileOrThrow(uid);
  const jobRef = admin.firestore().doc(`companies/${companyId}/jobs/${jobId}`);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError('not-found', 'Job not found');
  }

  const jobData = jobSnap.data() || {};
  const canonicalPaths = collectJobFileStoragePaths(jobId, jobData);
  if (!canonicalPaths.includes(storagePath)) {
    throw new HttpsError('permission-denied', 'Requested file is not attached to this job');
  }

  if (requiresAssignedJobScope(resolvedRole, isSoloScope)) {
    const callerWid = String(callerProfile?.wid || '');
    if (!callerWid || String(jobData.wid || '') !== callerWid || ownerUid !== uid) {
      throw new HttpsError('permission-denied', 'You can only access files for your assigned jobs');
    }
  } else {
    const assignedWid = String(jobData.wid || '').trim();
    if (!assignedWid) {
      throw new HttpsError('permission-denied', 'Job file owner could not be resolved');
    }
    const workerSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, assignedWid)).get();
    const assignedUid = workerSnap.exists ? String(workerSnap.data()?.uid || '') : '';
    if (!assignedUid || assignedUid !== ownerUid) {
      throw new HttpsError('permission-denied', 'Job file owner does not match the assigned worker');
    }
  }

  const [downloadURL] = await admin.storage().bucket().file(storagePath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + JOB_FILE_DOWNLOAD_URL_TTL_MS,
  });

  return {
    success: true,
    downloadURL,
    expiresAt: new Date(Date.now() + JOB_FILE_DOWNLOAD_URL_TTL_MS).toISOString(),
  };
});

module.exports = exports;
