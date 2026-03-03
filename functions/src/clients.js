const {
  onCall,
  HttpsError,
  admin,
  logger,
  isValidEmail,
  validateCompanyId,
  assertHttpCompanyAccess,
  HTTP_COMPANY_CLIENT_ROLES,
} = require('./shared');

exports.addClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    throw new HttpsError('invalid-argument', 'name is required');
  }

  const email     = typeof data.email     === 'string' ? data.email.trim()     : '';
  const phone     = typeof data.phone     === 'string' ? data.phone.trim()     : '';
  const address   = typeof data.address   === 'string' ? data.address.trim()   : '';
  const city      = typeof data.city      === 'string' ? data.city.trim()      : '';
  const vatNumber = typeof data.vatNumber === 'string' ? data.vatNumber.trim() : '';
  const notes     = typeof data.notes     === 'string' ? data.notes.trim()     : '';

  if (email && !isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_CLIENT_ROLES,
    allowSoloScope: true,
  });

  const db = admin.firestore();
  const cnextRef = db.doc(`companies/${companyId}/counters/cnext`);

  const newClient = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(cnextRef);
    if (!counterSnap.exists) {
      throw new HttpsError('failed-precondition', 'Company client counter not initialized');
    }
    const cid = Number(counterSnap.data()?.next || 1);

    const clientId = String(cid);
    const clientRef = db.doc(`companies/${companyId}/clients/${clientId}`);
    const now = new Date().toISOString();

    // Build client doc — only cid, cname, cphone + optional extras
    const clientDoc = { cid, cname: name, createdAt: now };
    if (phone)     clientDoc.cphone   = phone;
    if (email)     clientDoc.email     = email;
    if (address)   clientDoc.address   = address;
    if (city)      clientDoc.city      = city;
    if (vatNumber) clientDoc.vatNumber = vatNumber;
    if (notes)     clientDoc.notes     = notes;

    tx.set(cnextRef, { next: cid + 1 });
    tx.set(clientRef, clientDoc);

    // Bump cache version inside transaction for atomicity
    const cacheRef = db.doc(`companies/${companyId}/data/cache`);
    tx.set(cacheRef, {
      clientsVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { id: clientId, ...clientDoc };
  });

  logger.info('addClientV1: client created', { companyId, clientId: newClient.id, uid });
  return { success: true, client: newClient };
});

/**
 * Callable Function: deleteClientV1
 * Deletes a client document and increments the company cache version so phone app
 * users automatically detect the change and invalidate their local cache.
 * Used by both the phone app and the website.
 */
exports.deleteClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const { companyId, clientId } = request.data || {};

  if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    throw new HttpsError('invalid-argument', 'clientId is required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_CLIENT_ROLES,
    allowSoloScope: true,
  });

  const db = admin.firestore();
  const clientRef = db.doc(`companies/${companyId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();

  if (!clientSnap.exists) {
    throw new HttpsError('not-found', 'Client not found');
  }

  // Delete client and bump the company cache version in one atomic batch
  const cacheRef = db.doc(`companies/${companyId}/data/cache`);

  const batch = db.batch();
  batch.delete(clientRef);
  batch.set(cacheRef, {
    clientsVersion: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  logger.info('deleteClientV1: client deleted', { companyId, clientId, uid });
  return { success: true, clientId };
});

exports.updateClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : '';
  if (!companyId || !clientId) {
    throw new HttpsError('invalid-argument', 'companyId and clientId are required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_CLIENT_ROLES,
    allowSoloScope: true,
  });

  const dbRef = admin.firestore();
  const clientRef = dbRef.doc(`companies/${companyId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();

  if (!clientSnap.exists) {
    throw new HttpsError('not-found', 'Client not found');
  }

  // Build update payload — strip metadata
  const updates = {};
  if (data.name !== undefined) {
    const trimmedName = String(data.name || '').trim();
    if (!trimmedName) {
      throw new HttpsError('invalid-argument', 'name cannot be empty');
    }
    updates.name = trimmedName;
  }
  if (data.email !== undefined) {
    const email = String(data.email || '').trim();
    if (email && !isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    updates.email = email;
  }
  if (data.phone !== undefined) updates.phone = String(data.phone || '').trim();
  if (data.address !== undefined) updates.address = String(data.address || '').trim();
  if (data.city !== undefined) updates.city = String(data.city || '').trim();
  if (data.vatNumber !== undefined) updates.vatNumber = String(data.vatNumber || '').trim();
  if (data.notes !== undefined) updates.notes = String(data.notes || '').trim();
  updates.updatedAt = new Date().toISOString();

  // Atomic batch: update client + bump cache version
  const cacheRef = dbRef.doc(`companies/${companyId}/data/cache`);

  const batch = dbRef.batch();
  batch.update(clientRef, updates);
  batch.set(cacheRef, {
    clientsVersion: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  logger.info('updateClientV1: client updated', { companyId, clientId, uid });
  return { success: true, clientId };
});

module.exports = {
  addClientV1: exports.addClientV1,
  deleteClientV1: exports.deleteClientV1,
  updateClientV1: exports.updateClientV1,
};
