const {
  admin,
  logger,
  onCall,
  HttpsError,
  onRequest,
  onDocumentUpdated,
  validateCompanyId,
  getAuthenticatedUserProfile,
  assertHttpCompanyAccess,
  resolveHttpAuth,
  sendHttpOk,
  sendHttpError,
  parseJsonBody,
  sendCaughtHttpError,
  CORS_ALLOWED_ORIGINS,
  GENERATE_DOCUMENT_ALLOWED_ROLES,
  HTTP_COMPANY_MANAGER_ROLES,
  DOC_TYPE,
  DOC_SUFFIX,
  PREVIEW_TOPIC,
  GENERATE_TOPIC,
  getPubSub,
  requireNonEmptyString,
  optionalTrimmedString,
  toDocumentDocId,
  toBaseDocumentId,
} = require('./shared');

// ── Local helpers (not in shared) ─────────────────────────────────────────

async function clearCompanyBusyFlag(companyId, documentType) {
  const busyRef = admin.firestore().doc(`companies/${companyId}/documentLocks/${documentType}`);
  await busyRef.delete();
}

/**
 * Atomically acquire a company busy flag.
 * Prevents race conditions between check + set across concurrent requests.
 */
async function acquireCompanyBusyFlag(companyId, documentType, uid, taskId) {
  const busyRef = admin.firestore().doc(`companies/${companyId}/documentLocks/${documentType}`);
  const staleAfterMs = 5 * 60 * 1000;

  await admin.firestore().runTransaction(async (tx) => {
    const busyDoc = await tx.get(busyRef);
    if (busyDoc.exists) {
      const data = busyDoc.data() || {};
      const lockTime = data.lockedAt?.toMillis?.() || 0;
      const now = Date.now();
      const isFreshLock = lockTime && (now - lockTime < staleAfterMs);

      if (isFreshLock) {
        throw new HttpsError(
          'failed-precondition',
          'Another document is being generated. Please wait a few seconds and try again.',
          { lockedBy: data.lockedBy || 'unknown' }
        );
      }
    }

    tx.set(busyRef, {
      lockedBy: uid,
      taskId,
      lockedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

/**
 * SHARED HELPER: Publish Generate Task to Pub/Sub
 * 
 * This helper is used by both publishGenerateTask and getInvoiceApproval
 * to avoid code duplication and ensure consistency.
 * 
 * @param {Object} params - Task parameters
 * @param {string} params.documentType - Type of document (taxInvoice, priceProposal, etc.)
 * @param {string} params.documentId - Pre-generated document ID
 * @param {number} params.documentNumber - Pre-assigned document number
 * @param {Object} params.completeDocumentData - Complete document data with all fields
 * @param {Object} params.documentData - Document data (for taxInvoice)
 * @param {string} params.uid - uid
 * @param {string} params.companyId - Company name
 * @param {string} params.createdByUid - User's Firebase UID
 * @param {string} [params.userRole] - Role for cache path determination
 * 
 * @returns {Object} { taskId, messageId, published: true }
 */
async function publishGenerateTaskHelper({
  documentType,
  documentId,
  documentNumber,
  completeDocumentData,
  documentData,
  uid,
  companyId,
  createdByUid,
  userRole
}) {
  const lockType = `generate_${documentType}`;
  const taskId = `generate_${documentType}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let lockAcquired = false;

  // Acquire lock atomically to avoid check/set race under concurrent requests.
  await acquireCompanyBusyFlag(companyId, lockType, uid, taskId);
  lockAcquired = true;

  try {
    // Create task document in Firestore for tracking
    const taskRef = admin.firestore().doc(`documentTasks/${taskId}`);
    await taskRef.set({
      taskId: taskId,
      type: 'generate',
      taskType: 'generate',
      documentType: documentType,
      companyId: companyId,
      documentId: documentId,
      documentNumber: documentNumber,
      uid: uid,
      createdBy: createdByUid,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      documentData: completeDocumentData
    });

    // Prepare message with ALL data - Cloud Run does NO fetching
    const messageData = {
      taskId: taskId,
      documentType: documentType,
      documentId: documentId,
      documentNumber: documentNumber,
      documentData: completeDocumentData,
      uid: uid,
      companyId: companyId,
      legacyDocumentData: documentData || null,
      userRole: userRole || null,
      // Pass confirmation number at top level for easy access in Cloud Run
      confirmationNumber: completeDocumentData?.taxAuthorityConfirmationNumber || null,
    };

    // Publish to Pub/Sub
    const topic = getPubSub().topic(GENERATE_TOPIC);
    const messageBuffer = Buffer.from(JSON.stringify(messageData));
    const messageId = await topic.publishMessage({ data: messageBuffer });

    logger.info('Generate task published via helper', { taskId, messageId, documentType, documentId });

    // Update task with message ID
    await taskRef.update({
      status: 'queued',
      pubsubMessageId: messageId,
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      taskId: taskId,
      messageId: messageId,
      published: true
    };
  } catch (error) {
    if (lockAcquired) {
      try {
        await clearCompanyBusyFlag(companyId, lockType);
      } catch (unlockError) {
        logger.error('Failed to clear busy flag after publishGenerateTaskHelper error', {
          lockType,
          companyId,
          error: unlockError.message
        });
      }
    }
    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Exported Cloud Functions
// ════════════════════════════════════════════════════════════════════════════

exports.generateDocumentV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const companyId = validateCompanyId(requireNonEmptyString(body.companyId, 'companyId', 3, 80));
    const type = requireNonEmptyString(body.type, 'type', 2, 100);
    const jobId = optionalTrimmedString(body.jobId, 120) || 'manual';

    // S3: Restricted to manager/dev only (previously open to all app roles)
    await assertHttpCompanyAccess({
      uid: auth.uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: true,
    });

    logger.warn('generateDocumentV1: Legacy endpoint called — migrate to Pub/Sub pipeline', {
      uid: auth.uid, companyId, type,
    });

    const documentsRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('documents');
    const taskRef = documentsRef.doc();
    const nowIso = new Date().toISOString();
    const placeholderUrl = `/downloads/${taskRef.id}.pdf`;

    await taskRef.set({
      id: taskRef.id,
      type,
      jobId,
      status: 'queued',
      createdAt: nowIso,
      createdBy: auth.uid,
      downloadUrl: placeholderUrl,
    });

    const cloudRunUrl = process.env.CLOUDRUN_PDF_URL;
    let status = 'queued';
    let resolvedDownloadUrl = placeholderUrl;

    if (cloudRunUrl) {
      try {
        const cloudRunResponse = await fetch(cloudRunUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: taskRef.id,
            uid: auth.uid,
            companyId,
            type,
            jobId,
          }),
        });

        if (cloudRunResponse.ok) {
          const cloudPayload = await cloudRunResponse.json();
          resolvedDownloadUrl = cloudPayload?.downloadUrl || placeholderUrl;
          status = 'generated';
        } else {
          status = 'failed';
        }
      } catch (error) {
        status = 'failed';
      }

      await taskRef.set({
        status,
        downloadUrl: resolvedDownloadUrl,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    return sendHttpOk(res, {
      id: taskRef.id,
      downloadUrl: resolvedDownloadUrl,
      status,
    });
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

exports.publishPreviewTask = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30
}, async (request) => {
  let lockAcquired = false;
  let lockType = '';
  let companyIdForUnlock = '';
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('Publishing preview task', { uid });

    const { documentType, documentData, companyId } = request.data || {};
    companyIdForUnlock = companyId;
    lockType = `preview_${documentType}`;

    // Validate required fields
    if (!documentType) {
      throw new HttpsError('invalid-argument', 'Document type is required');
    }
    if (!documentData) {
      throw new HttpsError('invalid-argument', 'Document data is required');
    }
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'Company ID is required');
    }

    // Validate document data
    if (!documentData.client || !documentData.client.name) {
      throw new HttpsError('invalid-argument', 'Client name is required');
    }
    if (!documentData.items || !Array.isArray(documentData.items) || documentData.items.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one item is required');
    }

    const { role } = await getAuthenticatedUserProfile(request.auth, {
      allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES,
      requireCompany: true,
      companyId,
    });
    logger.info('User authorized for preview task', { uid, role, companyId, documentType });

    // Always fetch business info from Firestore (never trust frontend cache for security)
    let businessInfo;
    const businessInfoRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);
    const businessInfoDoc = await businessInfoRef.get();
    if (!businessInfoDoc.exists) {
      throw new HttpsError('failed-precondition', 'Business information not found. Please complete business registration.');
    }
    businessInfo = businessInfoDoc.data();

    // Build company data from business_info
    const companyData = {
      name: businessInfo.he_name || businessInfo.en_name || companyId,
      email: businessInfo.business_email || '',
      phone: businessInfo.business_phone || '',
      address: businessInfo.address || '',
      vatNumber: businessInfo.vat_number || '',
    };

    // Get preview document number (current counter value, not incremented)
    // Convert documentType to number for consistency
    const numericDocType = typeof documentType === 'number' ? documentType : Number(documentType);
    const documentNumbers = businessInfo.document_numbers || {};
    const previewDocumentNumber = documentNumbers[numericDocType] || 1;

    // Calculate totals
    let totalBeforeVat = 0;
    documentData.items.forEach(item => {
      totalBeforeVat += (item.quantity || 1) * (item.price || 0);
    });
    const vatAmount = totalBeforeVat * 0.18;
    const totalWithVat = totalBeforeVat + vatAmount;

    // Prepare complete document data for Cloud Run
    const completeDocumentData = {
      ...documentData,
      company: companyData,
      documentNumber: previewDocumentNumber,
      totals: {
        totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
        vatAmount: Math.round(vatAmount * 100) / 100,
        totalWithVat: Math.round(totalWithVat * 100) / 100,
      }
    };

    // Generate task ID
    const taskId = `preview_${documentType}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Acquire lock atomically to avoid concurrent duplicate previews.
    await acquireCompanyBusyFlag(companyId, lockType, uid, taskId);
    lockAcquired = true;

    // Create task document in Firestore for tracking
    const taskRef = admin.firestore().doc(`documentTasks/${taskId}`);
    await taskRef.set({
      taskId: taskId,
      type: 'preview',
      documentType: documentType,
      uid: uid,
      companyId: companyId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
      documentData: completeDocumentData
    });

    // Prepare message for Pub/Sub - complete data, no fetching needed
    const messageData = {
      taskId: taskId,
      documentType: documentType,
      documentData: completeDocumentData,
      uid: uid,
      companyId: companyId
    };

    // Publish to Pub/Sub
    const topic = getPubSub().topic(PREVIEW_TOPIC);
    const messageBuffer = Buffer.from(JSON.stringify(messageData));
    const messageId = await topic.publishMessage({ data: messageBuffer });

    logger.info('Preview task published', { taskId, messageId });

    // Update task with message ID
    await taskRef.update({
      status: 'queued',
      pubsubMessageId: messageId,
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      taskId: taskId,
      messageId: messageId,
      message: 'Preview task queued successfully. Listen to task document for completion.'
    };

  } catch (error) {
    if (lockAcquired) {
      try {
        await clearCompanyBusyFlag(companyIdForUnlock, lockType);
      } catch (unlockError) {
        logger.error('Failed to clear preview busy flag after error', {
          companyId: companyIdForUnlock,
          lockType,
          error: unlockError.message
        });
      }
    }

    logger.error('Error publishing preview task:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to publish preview task: ${error.message}`);
  }
});

exports.publishGenerateTask = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('Publishing generate task', { uid });

    const { documentType, documentData: requestDocumentData, companyId, documentId: providedDocId } = request.data || {};

    // Validate required fields
    if (!documentType) {
      throw new HttpsError('invalid-argument', 'Document type is required');
    }
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'Company ID is required');
    }

    // Convert documentType to number for consistency
    const numericDocType = typeof documentType === 'number' ? documentType : Number(documentType);

    // Validate based on document type
    if (numericDocType === DOC_TYPE.TAX_INVOICE) {
      if (!providedDocId) {
        throw new HttpsError('invalid-argument', 'Document ID is required for tax invoice');
      }
    } else {
      if (!requestDocumentData) {
        throw new HttpsError('invalid-argument', 'Document data is required');
      }
      if (!requestDocumentData.client || !requestDocumentData.client.name) {
        throw new HttpsError('invalid-argument', 'Client name is required');
      }
      if (!requestDocumentData.items || !Array.isArray(requestDocumentData.items) || requestDocumentData.items.length === 0) {
        throw new HttpsError('invalid-argument', 'At least one item is required');
      }
    }

    const { role } = await getAuthenticatedUserProfile(request.auth, {
      allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES,
      requireCompany: true,
      companyId,
    });
    logger.info('User authorized for generate task', { uid, role, companyId, documentType: numericDocType });

    if (numericDocType === DOC_TYPE.TAX_INVOICE && role !== 'manager' && role !== 'user') {
      throw new HttpsError('permission-denied', 'Only managers and users can generate tax invoices');
    }

    // Always fetch business info from Firestore (never trust frontend cache for security)
    let businessInfo;
    const businessInfoRef2 = admin.firestore().doc(`companies/${companyId}/data/business_info`);
    const businessInfoDoc2 = await businessInfoRef2.get();
    if (!businessInfoDoc2.exists) {
      throw new HttpsError('failed-precondition', 'Business information not found. Please complete business registration.');
    }
    businessInfo = businessInfoDoc2.data();

    // Build company data from business_info
    const companyData = {
      name: businessInfo.he_name || businessInfo.en_name || companyId,
      email: businessInfo.business_email || '',
      phone: businessInfo.business_phone || '',
      address: businessInfo.address || '',
      vatNumber: businessInfo.vat_number || '',
    };

    let documentId;
    let documentNumber;
    let completeDocumentData;
    let existingDocumentData = null;

    // Handle tax invoice vs other types
    if (numericDocType === DOC_TYPE.TAX_INVOICE) {
      // Tax invoice - document already exists (approved via getInvoiceApproval)
      const documentDocId = toDocumentDocId(providedDocId);
      documentId = toBaseDocumentId(providedDocId);
      
      // Fetch existing document to get all data
      const documentRef = admin.firestore().doc(`companies/${companyId}/documents/${documentDocId}`);
      const documentDoc = await documentRef.get();
      
      if (!documentDoc.exists) {
        throw new HttpsError('not-found', `Document ${documentDocId} not found`);
      }
      
      existingDocumentData = documentDoc.data();
      documentNumber = existingDocumentData.documentNumber;
      
      // Build complete data from existing document
      completeDocumentData = {
        client: {
          name: existingDocumentData.clientName,
          email: existingDocumentData.clientEmail || '',
          phone: existingDocumentData.clientPhone || '',
          address: existingDocumentData.clientAddress || '',
        },
        items: existingDocumentData.items,
        company: companyData,
        language: existingDocumentData.language || 'he',
        date: existingDocumentData.date,
        notes: existingDocumentData.notes,
        totals: {
          totalBeforeVat: existingDocumentData.totalBeforeVat,
          vatAmount: existingDocumentData.vatAmount,
          totalWithVat: existingDocumentData.totalWithVat,
        }
      };
      
    } else {
      // Other document types - prepare everything here
      const { client, items, language, date, notes } = requestDocumentData;
      
      // Atomically read + increment document number to prevent race conditions
      const docNumResult = await admin.firestore().runTransaction(async (tx) => {
        const bizRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);
        const bizSnap = await tx.get(bizRef);
        const bizData = bizSnap.data() || {};
        const docNums = bizData.document_numbers || {};
        const num = docNums[numericDocType] || 1;
        tx.update(bizRef, {
          [`document_numbers.${numericDocType}`]: admin.firestore.FieldValue.increment(1),
          last_updated: new Date().toISOString(),
        });
        return num;
      });
      documentNumber = docNumResult;
      
      // Generate document ID using suffix
      const typeSuffix = DOC_SUFFIX[numericDocType] || 'XX';
      
      documentId = `${typeSuffix}${documentNumber}-${companyId}`;
      
      // Calculate totals
      let totalBeforeVat = 0;
      items.forEach(item => {
        totalBeforeVat += (item.quantity || 1) * (item.price || 0);
      });
      const vatAmount = totalBeforeVat * 0.18;
      const totalWithVat = totalBeforeVat + vatAmount;
      
      // Prepare complete document data
      completeDocumentData = {
        client: client,
        items: items,
        company: companyData,
        language: language || 'he',
        date: date || todayDate,
        notes: notes || null,
        totals: {
          totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          totalWithVat: Math.round(totalWithVat * 100) / 100,
        }
      };
    }

    // Use shared helper to publish task
    const result = await publishGenerateTaskHelper({
      documentType: numericDocType, // Pass numeric type
      documentId,
      documentNumber,
      completeDocumentData,
      documentData: existingDocumentData || requestDocumentData,
      uid,
      companyId,
      createdByUid: request.auth.uid,
      userRole: role,
    });

    return {
      success: true,
      taskId: result.taskId,
      messageId: result.messageId,
      documentId: documentId,
      message: 'Generate task queued successfully. Listen to task document for completion.'
    };

  } catch (error) {
    logger.error('Error publishing generate task:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to publish generate task: ${error.message}`);
  }
});

exports.deleteDocumentV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);
  const rawDocumentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';
  const documentId = toDocumentDocId(rawDocumentId);

  if (!documentId) {
    throw new HttpsError('invalid-argument', 'documentId is required');
  }

  await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES, // manager, user, basic
    allowSoloScope: true,
  });

  const dbRef = admin.firestore();
  const documentRef = dbRef.doc(`companies/${companyId}/documents/${documentId}`);
  const documentSnap = await documentRef.get();

  if (!documentSnap.exists) {
    throw new HttpsError('not-found', 'Document not found');
  }

  const documentDataRecord = documentSnap.data();

  // Prevent deleting tax invoices that have been approved by the Tax Authority
  if (documentDataRecord.type === DOC_TYPE.TAX_INVOICE && documentDataRecord.taxAuthorityResponseData) {
    throw new HttpsError(
      'failed-precondition',
      'Cannot delete a Tax Authority approved invoice'
    );
  }

  await documentRef.delete();
  const storagePath = typeof documentDataRecord.storagePath === 'string'
    ? documentDataRecord.storagePath.trim()
    : '';
  if (storagePath) {
    try {
      await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
    } catch (storageError) {
      logger.error('deleteDocumentV1: failed to delete storage object', {
        companyId,
        documentId,
        storagePath,
        error: storageError.message,
      });
    }
  }

  logger.info('deleteDocumentV1: document deleted', { companyId, documentId, rawDocumentId, uid });
  return { success: true, documentId };
});

exports.onTaskCompleted = onDocumentUpdated({
  document: 'documentTasks/{taskId}',
  region: 'us-central1'
}, async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  
  // Check if status changed to completed or failed
  if (beforeData.status !== afterData.status && 
      (afterData.status === 'completed' || afterData.status === 'failed')) {
    
    const { companyId, type, documentType } = afterData;
    const lockType = `${type}_${documentType}`;
    
    try {
      await clearCompanyBusyFlag(companyId, lockType);
      logger.info('Busy flag cleared for task', { 
        taskId: afterData.taskId, 
        status: afterData.status 
      });
    } catch (error) {
      logger.error('Failed to clear busy flag:', error);
    }
  }
});

module.exports = {
  generateDocumentV1: exports.generateDocumentV1,
  publishPreviewTask: exports.publishPreviewTask,
  publishGenerateTask: exports.publishGenerateTask,
  deleteDocumentV1: exports.deleteDocumentV1,
  onTaskCompleted: exports.onTaskCompleted,
};
