const {
  admin,
  logger,
  onCall,
  HttpsError,
  onDocumentCreated,
  onDocumentUpdated,
  validateCompanyId,
  assertHttpCompanyAccess,
  userProfileDocPath,
  sendPushNotification,
  syncJobAssigneeFields,
  toBaseDocumentId,
  MAX_JOB_ARRAY_LENGTH,
  HTTP_COMPANY_MANAGER_ROLES,
  HTTP_ALL_APP_ROLES,
} = require('./shared');

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
    if (!jobData || jobData.status !== 'pending' || !jobData.completedBy) {
      logger.info('Job not eligible for assignment notification', {
        jobId,
        status: jobData?.status,
        hasCompletedBy: !!jobData?.completedBy
      });
      return;
    }

    const workerUserId = jobData.completedBy;
    const jobTitle = jobData.title || 'Untitled Job';
    const managerUserId = jobData.MUser;
    const managerName = jobData.MName;

    logger.info('Job assignment detected', {
      jobId,
      jobTitle,
      workerUserId,
      managerUserId,
      companyId
    });

    // DEDUPLICATION CHECK: Check if notification already sent for this job assignment
    const notificationLogId = `${jobId}_assigned`;
    const notificationLogRef = admin.firestore().doc(`notificationLog/${notificationLogId}`);
    const existingLog = await notificationLogRef.get();

    if (existingLog.exists) {
      logger.info('Notification already sent for this job assignment', {
        jobId,
        notificationLogId,
        originalSentAt: existingLog.data().sentAt
      });
      return;
    }

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

    // Send push notification
    const notificationResult = await sendPushNotification(
      workerPushToken,
      notificationTitle,
      notificationBody,
      notificationData
    );

    // Log notification to prevent duplicates
    if (notificationResult.success) {
      await notificationLogRef.set({
        jobId,
        notificationType: 'assigned',
        workerUserId,
        workerEmail,
        managerUserId,
        managerName,
        jobTitle,
        companyId,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        // TTL: auto-expire after 30 days (configure Firestore TTL policy on this field)
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        messageId: notificationResult.messageId || null,
        duration: Date.now() - startTime
      });
    }

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

    const workerUserId = afterData.completedBy || 'Unknown Worker';
    const jobTitle = afterData.title || 'Untitled Job';
    const managerUserId = afterData.MUser;
    const workerName = afterData.name;

    logger.info('Job submission detected', {
      jobId,
      jobTitle,
      workerUserId,
      managerUserId,
      companyId
    });

    // DEDUPLICATION CHECK: Check if notification already sent for this job submission
    const notificationLogId = `${jobId}_submitted`;
    const notificationLogRef = admin.firestore().doc(`notificationLog/${notificationLogId}`);
    const existingLog = await notificationLogRef.get();

    if (existingLog.exists) {
      logger.info('Notification already sent for this job submission', {
        jobId,
        notificationLogId,
        originalSentAt: existingLog.data().sentAt
      });
      return;
    }

    // Determine manager userId
    if (!managerUserId) {
      logger.warn('No manager userId (MUser) found in job', { jobId, companyId });
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

    // Send push notification
    const notificationResult = await sendPushNotification(
      managerPushToken,
      notificationTitle,
      notificationBody,
      notificationData
    );

    // Log notification to prevent duplicates
    if (notificationResult.success) {
      await notificationLogRef.set({
        jobId,
        notificationType: 'submitted',
        workerUserId,
        workerName,
        managerUserId,
        managerEmail,
        jobTitle,
        companyId,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        // TTL: auto-expire after 30 days (configure Firestore TTL policy on this field)
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        messageId: notificationResult.messageId || null,
        duration: Date.now() - startTime
      });
    }

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
  const rawJobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  // Strip legacy prefixes if present
  const jobId = toBaseDocumentId(rawJobId);

  if (!jobId) {
    throw new HttpsError('invalid-argument', 'jobId is required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_ALL_APP_ROLES,
    allowSoloScope: true,
  });

  const dbRef = admin.firestore();
  const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    throw new HttpsError('not-found', 'Job not found');
  }

  const jobData = jobSnap.data();

  // Only manager/dev can delete pending/waiting jobs
  if (['pending', 'waiting'].includes(jobData.status)) {
    if (!['manager', 'dev'].includes(resolvedRole)) {
      throw new HttpsError('permission-denied', 'Only managers can delete pending jobs');
    }
  }

  // Cannot delete a job with a generated document
  if (jobData.isCert === true) {
    throw new HttpsError('failed-precondition', 'Cannot delete a job that has a generated document (isCert=true)');
  }

  // Worker can only delete their own assigned jobs
  if (resolvedRole === 'worker') {
    if (jobData.workerId !== uid) {
      throw new HttpsError('permission-denied', 'Workers can only delete their own jobs');
    }
  }

  // Basic role cannot delete jobs
  if (resolvedRole === 'basic') {
    throw new HttpsError('permission-denied', 'basic role cannot delete jobs');
  }

  // Batch: delete job + bump cache
  const batch = dbRef.batch();
  batch.delete(jobRef);
  const cacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
  batch.set(cacheRef, {
    jobsVersion: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  logger.info('deleteJobV1: job deleted', { companyId, jobId, uid, status: jobData.status });
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
  const rawJobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  // Strip legacy prefixes if present
  const jobId = toBaseDocumentId(rawJobId);

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

    // Update job status in-place
    tx.update(jobRef, {
      status: 'finished',
      finishedAt: jobData.finishedAt || now,
      isCert: jobData.isCert === true,
      acceptedBy: uid,
      acceptedAt: now,
      updatedAt: now,
    });

    // Deduct worker inventory if partsUsed exists
    const partsUsed = jobData.partsUsed || jobData.parts || [];
    const workerId = jobData.workerId || jobData.completedBy;

    if (Array.isArray(partsUsed) && partsUsed.length > 0 && workerId) {
      const workerInvRef = dbRef.doc(`users/${workerId}/data/inventory`);
      const workerInvSnap = await tx.get(workerInvRef);

      if (workerInvSnap.exists) {
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
        const workerCacheRef = dbRef.doc(`users/${workerId}/data/cache`);
        tx.set(workerCacheRef, {
          inventory: admin.firestore.FieldValue.increment(1),
          lastUpdated: now,
        }, { merge: true });
      }
    }

    // Bump company cache
    const companyCacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(companyCacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { jobId, workerId };
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

  // Solo users (role=user) can only create finished jobs
  if (resolvedRole === 'user' && jobType === 'pending') {
    throw new HttpsError('permission-denied', 'Solo users cannot create pending jobs');
  }

  const dbRef = admin.firestore();
  const companyRef = dbRef.doc(`companies/${companyId}`);

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
      return { success: true, jobId: existingJob.id, jid: existingJob.data()?.jid, duplicate: true };
    }
  }

  const result = await dbRef.runTransaction(async (tx) => {
    const companySnap = await tx.get(companyRef);
    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'Company not found');
    }

    const currentJid = Number(companySnap.data()?.jid || 1);
    tx.set(companyRef, { jid: currentJid + 1 }, { merge: true });

    // No prefix — plain sequential ID
    const jobId = String(currentJid);
    const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);

    const now = new Date().toISOString();

    // Build job document from provided payload — explicit whitelist to prevent field injection
    const ALLOWED_JOB_FIELDS = [
      'title', 'description', 'name', 'clientName', 'clientId',
      'clientPhone', 'clientEmail', 'clientAddress',
      'workerId', 'completedBy', 'MUser', 'MName',
      'parts', 'partsUsed', 'notes', 'priority', 'dueDate',
      'location', 'address', 'category', 'tags', 'images',
      'workerName', 'assignedTo', 'assignedBy',
      'timeFrom', 'timeTo', 'travelDistance',
      'signingPerson', 'photos', 'signature',
      'finishedAt',
    ];
    const jobPayload = {};
    for (const key of ALLOWED_JOB_FIELDS) {
      if (data[key] !== undefined) {
        jobPayload[key] = data[key];
      }
    }

    // Validate array field lengths to prevent oversized documents
    for (const arrField of ['parts', 'partsUsed', 'images', 'photos', 'tags']) {
      if (Array.isArray(jobPayload[arrField]) && jobPayload[arrField].length > MAX_JOB_ARRAY_LENGTH) {
        throw new HttpsError('invalid-argument', `${arrField} exceeds maximum length (${MAX_JOB_ARRAY_LENGTH})`);
      }
    }

    syncJobAssigneeFields(jobPayload);
    if (jobType !== 'finished') {
      delete jobPayload.finishedAt;
    }

    const jobDoc = {
      ...jobPayload,
      id: jobId,
      jid: currentJid,
      status: jobType === 'pending' ? 'pending' : 'finished',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    if (jobType === 'finished') {
      jobDoc.isCert = false;
      jobDoc.workerId = jobPayload.workerId || uid;
      jobDoc.completedBy = jobPayload.completedBy || uid;
      jobDoc.finishedAt = jobPayload.finishedAt || now;
    }

    tx.set(jobRef, jobDoc);

    // Bump company cache
    const companyCacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
    tx.set(companyCacheRef, {
      jobsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { jobId, jid: currentJid };
  });

  // Handle idempotent duplicate detected inside transaction
  if (result.duplicate) {
    return { success: true, jobId: result.jobId, jid: result.jid, duplicate: true };
  }

  logger.info('createJobV1: job created', {
    companyId, jobId: result.jobId, jid: result.jid, uid, jobType,
  });

  return { success: true, jobId: result.jobId, jid: result.jid };
});

exports.updateJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const rawJobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  // Strip legacy prefixes if present
  const jobId = toBaseDocumentId(rawJobId);
  if (!companyId || !jobId) {
    throw new HttpsError('invalid-argument', 'companyId and jobId are required');
  }

  const { resolvedRole, isSoloScope } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: ['manager', 'worker', 'user', 'dev'],
    allowSoloScope: true,
  });

  const dbRef = admin.firestore();
  const jobRef = dbRef.doc(`companies/${companyId}/jobs/${jobId}`);
  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    throw new HttpsError('not-found', 'Job not found');
  }

  const existingJob = jobSnap.data();

  // Worker can only update their own assigned jobs
  if (resolvedRole === 'worker') {
    if (existingJob.workerId !== uid && existingJob.completedBy !== uid) {
      throw new HttpsError('permission-denied', 'Workers can only update their own assigned jobs');
    }
  }

  // Backward compatibility: old clients may send { updates: {...} }.
  const nestedUpdates = (data.updates && typeof data.updates === 'object' && !Array.isArray(data.updates))
    ? data.updates
    : null;

  const raw = nestedUpdates ? { ...nestedUpdates } : { ...data };

  // Positive field whitelist — only allow known job-data fields through
  const ALLOWED_UPDATE_FIELDS = [
    'title', 'description', 'name', 'clientName', 'clientId',
    'clientPhone', 'clientEmail', 'clientAddress',
    'workerId', 'completedBy', 'MUser', 'MName',
    'parts', 'partsUsed', 'notes', 'priority', 'dueDate',
    'location', 'address', 'category', 'tags', 'images',
    'workerName', 'assignedTo', 'assignedBy',
    'timeFrom', 'timeTo', 'travelDistance',
    'signingPerson', 'photos', 'signature',
    'finishedAt', 'status', 'isCert', 'deniedAt', 'deniedBy',
  ];
  const updates = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (raw[key] !== undefined) {
      updates[key] = raw[key];
    }
  }

  // Role-specific restrictions for workers
  if (resolvedRole === 'worker') {
    delete updates.workerId;
    delete updates.completedBy;
    delete updates.isCert;
    delete updates.deniedAt;
    delete updates.deniedBy;
    // Workers cannot set status to finished or denied — must go through acceptJobV1
    const CANONICAL_STATUSES = ['pending', 'waiting'];
    if (updates.status && !CANONICAL_STATUSES.includes(updates.status)) {
      throw new HttpsError('permission-denied', 'Workers cannot set status to ' + updates.status);
    }
  } else {
    syncJobAssigneeFields(updates);
  }

  // Validate status is canonical if provided
  const VALID_STATUSES = ['pending', 'waiting', 'finished', 'denied'];
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    throw new HttpsError('invalid-argument', `Invalid status: ${updates.status}. Valid: ${VALID_STATUSES.join(', ')}`);
  }
  // Prevent direct status transitions that should go through acceptJobV1
  if (existingJob.status !== 'finished' && updates.status === 'finished') {
    throw new HttpsError('failed-precondition', 'Cannot transition directly to finished. Use acceptJobV1.');
  }
  if (existingJob.status === 'finished' && (updates.status === 'pending' || updates.status === 'waiting')) {
    throw new HttpsError('failed-precondition', 'Finished job cannot transition back to pending/waiting.');
  }

  // Validate array field lengths to prevent oversized documents on updates
  for (const arrField of ['parts', 'partsUsed', 'images', 'photos', 'tags']) {
    if (Array.isArray(updates[arrField]) && updates[arrField].length > MAX_JOB_ARRAY_LENGTH) {
      throw new HttpsError('invalid-argument', `${arrField} exceeds maximum length (${MAX_JOB_ARRAY_LENGTH})`);
    }
  }

  updates.updatedAt = new Date().toISOString();

  // Batch: update job + bump cache
  const batch = dbRef.batch();
  batch.update(jobRef, updates);
  const cacheRef = dbRef.doc(`companies/${companyId}/data/cache`);
  batch.set(cacheRef, {
    jobsVersion: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  logger.info('updateJobV1: job updated', { companyId, jobId, uid, role: resolvedRole });
  return { success: true, jobId };
});

module.exports = exports;
