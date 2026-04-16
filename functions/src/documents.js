const {
  admin,
  logger,
  onCall,
  HttpsError,
  onDocumentUpdated,
  assertHttpCompanyAccess,
  validateCompanyId,
  GENERATE_DOCUMENT_ALLOWED_ROLES,
  MAX_ITEMS_PER_DOCUMENT,
  VAT_RATE,
  DOC_TYPE,
  DOC_SUFFIX,
  PREVIEW_TOPIC,
  GENERATE_TOPIC,
  getPubSub,
  toDocumentDocId,
  toBaseDocumentId,
  clearCompanyBusyFlag,
  acquireCompanyBusyFlag,
  publishGenerateTaskHelper,
  getUserProfileOrThrow,
} = require('./shared');
const {
  buildArchiveStoragePath,
  filterArchiveItemsForRole,
  normalizeArchiveMonthInput,
  parseArchivePayload,
} = require('./archive-access');

const DOCUMENT_DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

function normalizeDocumentType(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || !Object.values(DOC_TYPE).includes(numeric)) {
    throw new HttpsError('invalid-argument', 'Unsupported document type');
  }
  return numeric;
}

function validateDocumentItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one item is required');
  }
  if (items.length > MAX_ITEMS_PER_DOCUMENT) {
    throw new HttpsError('invalid-argument', `Maximum ${MAX_ITEMS_PER_DOCUMENT} items allowed per document`);
  }
  return items.map((item, index) => {
    const quantity = Number(item?.quantity ?? 1);
    const price = Number(item?.price);
    const description = String(item?.description || item?.name || '').trim();
    if (!description || description.length > 240) {
      throw new HttpsError('invalid-argument', `items[${index}].description is required and must be 240 characters or less`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', `items[${index}].quantity must be a positive finite number`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new HttpsError('invalid-argument', `items[${index}].price must be a non-negative finite number`);
    }
    return { ...item, description, quantity, price };
  });
}

function assertCompanyDocumentStoragePath(companyId, storagePath) {
  const normalized = String(storagePath || '').trim().replace(/^\/+/, '');
  const expectedPrefix = `companies/${companyId}/documents/`;
  if (!normalized || normalized.includes('..') || normalized.includes('?') || !normalized.startsWith(expectedPrefix)) {
    throw new HttpsError('failed-precondition', 'Document file path is invalid');
  }
  return normalized;
}

// ════════════════════════════════════════════════════════════════════════════
// Exported Cloud Functions
// ════════════════════════════════════════════════════════════════════════════

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
    const numericDocType = normalizeDocumentType(documentType);
    const normalizedItems = validateDocumentItems(documentData.items);

    const { resolvedRole: role } = await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES,
      allowSoloScope: true,
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
    const documentNumbers = businessInfo.document_numbers || {};
    const previewDocumentNumber = documentNumbers[numericDocType] || 1;

    // Calculate totals
    let totalBeforeVat = 0;
    normalizedItems.forEach(item => {
      totalBeforeVat += (item.quantity || 1) * (item.price || 0);
    });
    const vatAmount = totalBeforeVat * VAT_RATE;
    const totalWithVat = totalBeforeVat + vatAmount;

    // Prepare complete document data for Cloud Run
    const completeDocumentData = {
      ...documentData,
      items: normalizedItems,
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
      documentData: completeDocumentData,
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // TTL: auto-delete after 30 days
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
    
    throw new HttpsError('internal', 'Failed to publish preview task');
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
    const numericDocType = normalizeDocumentType(documentType);

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
      if (requestDocumentData.items.length > MAX_ITEMS_PER_DOCUMENT) {
        throw new HttpsError('invalid-argument', `Maximum ${MAX_ITEMS_PER_DOCUMENT} items allowed per document`);
      }
    }

    const { resolvedRole: role } = await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES,
      allowSoloScope: true,
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
          name: existingDocumentData.cname || existingDocumentData.clientName,
          phone: existingDocumentData.cphone || existingDocumentData.clientPhone || '',
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
      const { client, language, date, notes } = requestDocumentData;
      const items = validateDocumentItems(requestDocumentData.items);
      
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
      const typeSuffix = DOC_SUFFIX[numericDocType];
      
      documentId = `${typeSuffix}${documentNumber}-${companyId}`;
      
      // Calculate totals
      let totalBeforeVat = 0;
      items.forEach(item => {
        totalBeforeVat += (item.quantity || 1) * (item.price || 0);
      });
      const vatAmount = totalBeforeVat * VAT_RATE;
      const totalWithVat = totalBeforeVat + vatAmount;
      
      // Prepare complete document data
      completeDocumentData = {
        client: client,
        items: items,
        company: companyData,
        language: language || 'he',
        date: date || new Date().toISOString().slice(0, 10),
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
    
    throw new HttpsError('internal', 'Failed to publish generate task');
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

  const storagePath = typeof documentDataRecord.storagePath === 'string'
    ? documentDataRecord.storagePath.trim()
    : '';
  if (storagePath) {
    const canonicalStoragePath = assertCompanyDocumentStoragePath(companyId, storagePath);
    await admin.storage().bucket().file(canonicalStoragePath).delete({ ignoreNotFound: true });
  }

  await dbRef.runTransaction(async (tx) => {
    tx.delete(documentRef);
    tx.set(dbRef.doc(`companies/${companyId}/data/cache`), {
      documentsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('deleteDocumentV1: document deleted', { companyId, documentId, rawDocumentId, uid });
  return { success: true, documentId };
});

exports.createDocumentDownloadUrlV1 = onCall(async (request) => {
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
    allowedRoles: GENERATE_DOCUMENT_ALLOWED_ROLES,
    allowSoloScope: true,
  });

  const documentRef = admin.firestore().doc(`companies/${companyId}/documents/${documentId}`);
  const documentSnap = await documentRef.get();
  if (!documentSnap.exists) {
    throw new HttpsError('not-found', 'Document not found');
  }

  const storagePath = typeof documentSnap.data()?.storagePath === 'string'
    ? documentSnap.data().storagePath.trim()
    : '';
  if (!storagePath) {
    throw new HttpsError('failed-precondition', 'Document file is not available');
  }
  const canonicalStoragePath = assertCompanyDocumentStoragePath(companyId, storagePath);

  const [downloadURL] = await admin.storage().bucket().file(canonicalStoragePath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + DOCUMENT_DOWNLOAD_URL_TTL_MS,
  });

  return {
    success: true,
    documentId,
    downloadURL,
    expiresAt: new Date(Date.now() + DOCUMENT_DOWNLOAD_URL_TTL_MS).toISOString(),
  };
});

exports.fetchArchiveMonthV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);

  const { archiveKey, dataType } = normalizeArchiveMonthInput(
    data.year,
    data.month,
    data.dataType,
  );

  const allowedRoles = dataType === 'documents'
    ? ['manager', 'user', 'basic', 'dev']
    : ['manager', 'worker', 'user', 'dev'];

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles,
    allowSoloScope: true,
  });
  const profile = await getUserProfileOrThrow(uid);
  const storagePath = buildArchiveStoragePath(companyId, archiveKey);
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    return { success: true, archiveKey, dataType, items: [] };
  }

  const [contents] = await file.download();
  const items = parseArchivePayload(contents, archiveKey);
  const filteredItems = filterArchiveItemsForRole(items, dataType, resolvedRole, {
    uid,
    wid: profile?.wid,
  });

  return {
    success: true,
    archiveKey,
    dataType,
    items: filteredItems,
  };
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
  publishPreviewTask: exports.publishPreviewTask,
  publishGenerateTask: exports.publishGenerateTask,
  deleteDocumentV1: exports.deleteDocumentV1,
  createDocumentDownloadUrlV1: exports.createDocumentDownloadUrlV1,
  fetchArchiveMonthV1: exports.fetchArchiveMonthV1,
  onTaskCompleted: exports.onTaskCompleted,
};
