import { isSqlPersistenceEnabled } from './sql-access';
import { addClientInSql, deleteClientInSql, updateClientInSql } from './sql-clients';
import { bumpCompanySyncStateInSql } from './sql-company-sync';

const {
  onCall,
  HttpsError,
  admin,
  logger,
  isValidEmail,
  validateCompanyId,
  assertHttpCompanyAccess,
} = require('./shared');

const CLIENT_MUTATION_ROLES = ['manager', 'user', 'dev'];

function trimBounded(value, fieldName, max, required = false) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (required && !trimmed) {
    throw new HttpsError('invalid-argument', `${fieldName} is required`);
  }
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', `${fieldName} exceeds ${max} characters`);
  }
  return trimmed;
}

export const addClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  validateCompanyId(companyId);

  const name = trimBounded(data.name, 'name', 160, true);

  const email     = trimBounded(data.email, 'email', 320);
  const phone     = trimBounded(data.phone, 'phone', 40);
  const address   = trimBounded(data.address, 'address', 240);
  const city      = trimBounded(data.city, 'city', 120);
  const vatNumber = trimBounded(data.vatNumber, 'vatNumber', 40);
  const notes     = trimBounded(data.notes, 'notes', 1000);

  if (email && !isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: CLIENT_MUTATION_ROLES,
    allowSoloScope: true,
  });

  if (isSqlPersistenceEnabled()) {
    const client = await addClientInSql({
      companyId,
      createdByUserId: uid,
      name,
      email,
      phone,
      address,
      city,
      vatNumber,
      notes,
    });

    await bumpCompanySyncStateInSql(companyId, ['clientsVersion']);

    logger.info('addClientV1: client created in SQL', { companyId, clientId: client.id, uid });
    return { success: true, client };
  }

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

    // Build client doc — canonical fields: cid, cname, cphone + optional extras
    const clientDoc: any = { cid, cname: name, createdAt: now };
    if (phone) {
      clientDoc.cphone = phone;
    }
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
export const deleteClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const { companyId, clientId } = request.data || {};

  if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }
  validateCompanyId(companyId.trim());
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    throw new HttpsError('invalid-argument', 'clientId is required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: CLIENT_MUTATION_ROLES,
    allowSoloScope: true,
  });

  if (isSqlPersistenceEnabled()) {
    const result = await deleteClientInSql({ companyId, clientId });
    await bumpCompanySyncStateInSql(companyId, ['clientsVersion']);
    logger.info('deleteClientV1: client deleted in SQL', { companyId, clientId, uid });
    return { success: true, clientId: result.clientId };
  }

  const db = admin.firestore();
  const clientRef = db.doc(`companies/${companyId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();

  if (!clientSnap.exists) {
    throw new HttpsError('not-found', 'Client not found');
  }
  const [jobRefSnap, documentRefSnap] = await Promise.all([
    db.collection(`companies/${companyId}/jobs`).where('cid', '==', clientId).limit(1).get(),
    db.collection(`companies/${companyId}/documents`).where('cid', '==', clientId).limit(1).get(),
  ]);
  if (!jobRefSnap.empty || !documentRefSnap.empty) {
    throw new HttpsError('failed-precondition', 'Client is referenced by jobs or documents and cannot be deleted');
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

export const updateClientV1 = onCall(async (request) => {
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
  validateCompanyId(companyId);

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: CLIENT_MUTATION_ROLES,
    allowSoloScope: true,
  });

  if (isSqlPersistenceEnabled()) {
    const incomingName = data.name !== undefined ? data.name : data.cname;
    const updateResult = await updateClientInSql({
      companyId,
      clientId,
      name: incomingName !== undefined ? trimBounded(incomingName, 'name', 160, true) : undefined,
      email: data.email !== undefined ? trimBounded(data.email, 'email', 320) : undefined,
      phone: data.phone !== undefined ? trimBounded(data.phone, 'phone', 40) : (data.cphone !== undefined ? trimBounded(data.cphone, 'phone', 40) : undefined),
      address: data.address !== undefined ? trimBounded(data.address, 'address', 240) : undefined,
      city: data.city !== undefined ? trimBounded(data.city, 'city', 120) : undefined,
      vatNumber: data.vatNumber !== undefined ? trimBounded(data.vatNumber, 'vatNumber', 40) : undefined,
      notes: data.notes !== undefined ? trimBounded(data.notes, 'notes', 1000) : undefined,
    });
    await bumpCompanySyncStateInSql(companyId, ['clientsVersion']);
    logger.info('updateClientV1: client updated in SQL', { companyId, clientId, uid });
    return { success: true, clientId: updateResult.clientId };
  }

  const dbRef = admin.firestore();
  const clientRef = dbRef.doc(`companies/${companyId}/clients/${clientId}`);
  const clientSnap = await clientRef.get();

  if (!clientSnap.exists) {
    throw new HttpsError('not-found', 'Client not found');
  }

  // Build update payload — strip metadata
  const updates: any = {};
  const incomingName = data.name !== undefined ? data.name : data.cname;
  if (incomingName !== undefined) {
    updates.cname = trimBounded(incomingName, 'name', 160, true);
  }
  if (data.email !== undefined) {
    const email = trimBounded(data.email, 'email', 320);
    if (email && !isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    updates.email = email;
  }
  const incomingPhone = data.phone !== undefined ? data.phone : data.cphone;
  if (incomingPhone !== undefined) {
    updates.cphone = trimBounded(incomingPhone, 'phone', 40);
  }
  if (data.address !== undefined) updates.address = trimBounded(data.address, 'address', 240);
  if (data.city !== undefined) updates.city = trimBounded(data.city, 'city', 120);
  if (data.vatNumber !== undefined) updates.vatNumber = trimBounded(data.vatNumber, 'vatNumber', 40);
  if (data.notes !== undefined) updates.notes = trimBounded(data.notes, 'notes', 1000);
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

