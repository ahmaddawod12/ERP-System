import { isSqlPersistenceEnabled } from './sql-access';

const {
  onRequest,
  HttpsError,
  resolveHttpAuth,
  sendHttpOk,
  sendHttpError,
  parseJsonBody,
  sendCaughtHttpError,
  CORS_ALLOWED_ORIGINS,
  admin,
  validateCompanyId,
  assertHttpCompanyAccess,
  assertTargetWorkerScopedUserInCompany,
  getUserProfileOrThrow,
  HTTP_ALL_APP_ROLES,
} = require('./shared');

function loadDbModule() {
  try {
    return require('@smart-job/db');
  } catch (packageError) {
    try {
      const relativeDbModulePath = '../../packages/db';
      return require(relativeDbModulePath);
    } catch (relativeError) {
      const error = relativeError.code === 'MODULE_NOT_FOUND' ? packageError : relativeError;
      throw new HttpsError('internal', `SQL persistence is enabled but @smart-job/db could not be loaded: ${error.message}`);
    }
  }
}

function emptyInventory() {
  return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
}

function normalizeProfileRole(profile) {
  return String(profile?.role || '').trim().toLowerCase();
}

function shouldScopeJobReads(profile) {
  const role = normalizeProfileRole(profile);
  return role === 'worker' || (role === 'user' && String(profile?.accountType || '').trim().toLowerCase() !== 'solo');
}

function canReadFirestoreJobRecord(profile, jobRecord) {
  if (!jobRecord || !profile) return false;
  const role = normalizeProfileRole(profile);
  if (role === 'basic') return false;
  if (!shouldScopeJobReads(profile)) return true;
  const profileWid = String(profile?.wid || '').trim();
  return Boolean(profileWid) && String(jobRecord?.wid || '').trim() === profileWid;
}

function canReadFirestoreDocumentRecord(profile) {
  return normalizeProfileRole(profile) !== 'worker';
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getItemDate(item, field) {
  const rawValue = item?.[field];
  if (!rawValue) return null;
  if (rawValue instanceof Date) return rawValue;
  if (typeof rawValue?.toDate === 'function') return rawValue.toDate();
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function applyFirestoreDateRangeFilter(items, options: any = {}) {
  const dateField = String(options.dateField || 'createdAt').trim() || 'createdAt';
  const dateFrom = normalizeDate(options.dateFrom);
  const dateTo = normalizeDate(options.dateTo);
  if (!dateFrom && !dateTo) {
    return items;
  }

  return items.filter((item) => {
    const itemDate = getItemDate(item, dateField);
    if (!itemDate) return false;
    if (dateFrom && itemDate.getTime() < dateFrom.getTime()) return false;
    if (dateTo && itemDate.getTime() > dateTo.getTime()) return false;
    return true;
  });
}

async function readFirestoreProfile(uid) {
  const snap = await admin.firestore().doc(`users/${uid}/data/profile`).get();
  return snap.exists ? snap.data() : null;
}

async function readFirestoreSubscription(companyId) {
  if (!companyId) return null;
  const snap = await admin.firestore().doc(`companies/${companyId}/data/subscription`).get();
  return snap.exists ? snap.data() : null;
}

async function readFirestoreBusinessInfo(companyId) {
  if (!companyId) return null;
  const snap = await admin.firestore().doc(`companies/${companyId}/data/business_info`).get();
  return snap.exists ? snap.data() : null;
}

async function readFirestoreWorkers(companyId) {
  if (!companyId) return [];
  const snapshot = await admin.firestore().collection(`companies/${companyId}/workers`).orderBy('createdAt', 'desc').get();
  return snapshot.docs.map((docSnap) => ({ wid: Number(docSnap.id), ...docSnap.data() }));
}

async function readFirestoreClients(companyId) {
  if (!companyId) return [];
  const snapshot = await admin.firestore().collection(`companies/${companyId}/clients`).get();
  return snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      numericId: Number(docSnap.data()?.cid || docSnap.id),
      name: String(docSnap.data()?.name || docSnap.data()?.cname || ''),
      email: docSnap.data()?.email || undefined,
      phone: docSnap.data()?.phone || docSnap.data()?.cphone || undefined,
      address: docSnap.data()?.address || undefined,
      notes: docSnap.data()?.notes || undefined,
      city: docSnap.data()?.city || undefined,
      vatNumber: docSnap.data()?.vatNumber || undefined,
      createdAt: docSnap.data()?.createdAt || new Date().toISOString(),
      updatedAt: docSnap.data()?.updatedAt || undefined,
    }))
    .sort((left, right) => (left.numericId || 0) - (right.numericId || 0));
}

async function readFirestoreJobs(companyId, profile, options: any = {}) {
  if (!companyId || !profile) return [];
  const role = String(profile.role || '').trim().toLowerCase();
  if (role === 'basic') return [];
  const requestedStatuses = normalizeStringList(options.status);
  const rawLimit = Number(options.limit);
  const hasServerSideLikeFilters = requestedStatuses.length > 0 || Boolean(options.dateFrom || options.dateTo);
  const effectiveLimit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 10000)
    : (hasServerSideLikeFilters ? 10000 : 200);

  const jobsRef = admin.firestore().collection(`companies/${companyId}/jobs`);
  let snapshot;
  if (role === 'worker' || (role === 'user' && String(profile.accountType || '') !== 'solo')) {
    const wid = String(profile.wid || '').trim();
    snapshot = wid ? await jobsRef.where('wid', '==', wid).get() : { docs: [] };
  } else {
    snapshot = await jobsRef.orderBy('createdAt', 'desc').limit(effectiveLimit).get();
  }

  let jobs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  if (requestedStatuses.length > 0) {
    const allowedStatuses = new Set(requestedStatuses);
    jobs = jobs.filter((job) => allowedStatuses.has(String(job?.status || '').trim()));
  }
  jobs = applyFirestoreDateRangeFilter(jobs, options);
  return jobs.slice(0, effectiveLimit);
}

async function readFirestoreDocuments(companyId, profile, options: any = {}) {
  if (!companyId || !profile) return [];
  const role = String(profile.role || '').trim().toLowerCase();
  if (role === 'worker') return [];
  const requestedStatuses = normalizeStringList(options.status);
  const requestedCreatedByUid = String(options.createdByUid || '').trim();
  const requestedDocumentType = Number(options.documentType);
  const rawLimit = Number(options.limit);
  const hasServerSideLikeFilters =
    requestedStatuses.length > 0 ||
    Boolean(options.dateFrom || options.dateTo) ||
    Number.isInteger(requestedDocumentType) ||
    Boolean(requestedCreatedByUid);
  const effectiveLimit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 10000)
    : (hasServerSideLikeFilters ? 10000 : 200);
  const snapshot = await admin.firestore().collection(`companies/${companyId}/documents`).orderBy('createdAt', 'desc').limit(effectiveLimit).get();

  let documents = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  if (requestedStatuses.length > 0) {
    const allowedStatuses = new Set(requestedStatuses);
    documents = documents.filter((document) => allowedStatuses.has(String(document?.status || '').trim()));
  }
  if (Number.isInteger(requestedDocumentType)) {
    documents = documents.filter((document) => Number(document?.documentType ?? document?.type) === requestedDocumentType);
  }
  if (requestedCreatedByUid) {
    documents = documents.filter((document) => String(document?.createdByUid || '').trim() === requestedCreatedByUid);
  }
  documents = applyFirestoreDateRangeFilter(documents, options);
  return documents.slice(0, effectiveLimit);
}

async function readFirestoreInventory(companyId, scope, targetUid) {
  const ref = scope === 'company'
    ? admin.firestore().doc(`companies/${companyId}/data/inventory`)
    : admin.firestore().doc(`users/${targetUid}/data/inventory`);
  const snap = await ref.get();
  if (!snap.exists) return emptyInventory();
  const data = snap.data() || {};
  return {
    parts: Array.isArray(data.parts) ? data.parts : [],
    nextId: Number(data.nextId || 1),
    lastUpdated: data.lastUpdated || new Date().toISOString(),
  };
}

async function readFirestoreDocumentTask(taskId, uid) {
  const snap = await admin.firestore().doc(`documentTasks/${taskId}`).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const ownerUid = String(data.uid || data.createdBy || '').trim();
  if (ownerUid && ownerUid !== uid) {
    return null;
  }
  return {
    taskId,
    status: data.status || null,
    taskType: data.taskType || data.type || null,
    previewURL: data.previewURL || null,
    downloadURL: data.downloadURL || null,
    documentId: data.documentId || null,
    pdfSize: data.pdfSize || null,
    error: data.error || null,
  };
}

async function readFirestoreCompanySyncState(companyId) {
  if (!companyId) {
    return {
      jobsVersion: 0,
      documentsVersion: 0,
      clientsVersion: 0,
      workersVersion: 0,
      companyInventoryVersion: 0,
      updatedAt: '',
    };
  }
  const snap = await admin.firestore().doc(`companies/${companyId}/data/cache`).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    jobsVersion: Number(data.jobsVersion || 0),
    documentsVersion: Number(data.documentsVersion || 0),
    clientsVersion: Number(data.clientsVersion || 0),
    workersVersion: Number(data.workersVersion || 0),
    companyInventoryVersion: Number(data.companyInventoryVersion || 0),
    updatedAt: data.updatedAt || '',
  };
}

async function readFirestoreUserSyncState(uid) {
  const snap = await admin.firestore().doc(`users/${uid}/data/cache`).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    profile: Number(data.profile || 0),
    inventory: Number(data.inventory || 0),
    subscription: Number(data.subscription || 0),
    updatedAt: data.lastUpdated || '',
  };
}

async function readFirestoreRecord(companyId, recordId, profile) {
  const jobSnap = await admin.firestore().doc(`companies/${companyId}/jobs/${recordId}`).get();
  if (jobSnap.exists) {
    const jobRecord = { id: recordId, ...jobSnap.data() };
    return canReadFirestoreJobRecord(profile, jobRecord) ? jobRecord : null;
  }
  const documentSnap = await admin.firestore().doc(`companies/${companyId}/documents/${recordId}`).get();
  if (!documentSnap.exists) return null;
  const documentRecord = { id: recordId, ...documentSnap.data() };
  return canReadFirestoreDocumentRecord(profile) ? documentRecord : null;
}

async function buildSqlBootstrap(uid, companyId, includeCollections) {
  const dbModule = loadDbModule();
  return dbModule.getBootstrapReadModel(uid, companyId || null, { includeCollections });
}

export const readModelV1 = onRequest({
  region: 'us-central1',
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req);
    const kind = String(body.kind || '').trim();
    if (!kind) {
      throw new HttpsError('invalid-argument', 'kind is required');
    }

    const baseProfile = await getUserProfileOrThrow(auth.uid);
    const requestedCompanyId = body.companyId ? validateCompanyId(String(body.companyId).trim()) : String(baseProfile.companyId || '').trim();
    const includeCollections = body.includeCollections !== false;
    const requestedLimit = Number(body.limit);
    const requestedStatuses = normalizeStringList(body.status);
    const requestedDateField = String(body.dateField || '').trim();
    const requestedDateFrom = normalizeDate(body.dateFrom);
    const requestedDateTo = normalizeDate(body.dateTo);
    const requestedDocumentType = Number(body.documentType);
    const requestedCreatedByUid = String(body.createdByUid || '').trim();
    const listOptions: any = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? { limit: Math.min(requestedLimit, 10000) }
      : {};
    if (requestedStatuses.length > 0) {
      listOptions.status = requestedStatuses;
    }
    if (requestedDateField) {
      listOptions.dateField = requestedDateField;
    }
    if (requestedDateFrom) {
      listOptions.dateFrom = requestedDateFrom.toISOString();
    }
    if (requestedDateTo) {
      listOptions.dateTo = requestedDateTo.toISOString();
    }
    if (Number.isInteger(requestedDocumentType)) {
      listOptions.documentType = requestedDocumentType;
    }
    if (requestedCreatedByUid) {
      listOptions.createdByUid = requestedCreatedByUid;
    }

    if (requestedCompanyId) {
      await assertHttpCompanyAccess({
        uid: auth.uid,
        companyId: requestedCompanyId,
        allowedRoles: HTTP_ALL_APP_ROLES,
        allowSoloScope: true,
        preloadedProfile: baseProfile,
      });
    }

    if (kind === 'bootstrap') {
      if (isSqlPersistenceEnabled()) {
        const bootstrap = await buildSqlBootstrap(auth.uid, requestedCompanyId || null, includeCollections);
        if (!bootstrap) {
          throw new HttpsError('failed-precondition', 'SQL bootstrap profile not found for authenticated user');
        }
        return sendHttpOk(res, bootstrap);
      }

      return sendHttpOk(res, {
        profile: baseProfile,
        subscription: await readFirestoreSubscription(requestedCompanyId),
        businessInfo: await readFirestoreBusinessInfo(requestedCompanyId),
        inventory: requestedCompanyId ? await readFirestoreInventory(requestedCompanyId, 'user', auth.uid) : emptyInventory(),
        companyInventory: requestedCompanyId ? await readFirestoreInventory(requestedCompanyId, 'company', auth.uid) : emptyInventory(),
        workers: includeCollections ? await readFirestoreWorkers(requestedCompanyId) : [],
        clients: includeCollections ? await readFirestoreClients(requestedCompanyId) : [],
        jobs: includeCollections ? await readFirestoreJobs(requestedCompanyId, baseProfile) : [],
        documents: includeCollections ? await readFirestoreDocuments(requestedCompanyId, baseProfile) : [],
      });
    }

    if (!requestedCompanyId && kind !== 'documentTask' && kind !== 'userSyncState') {
      throw new HttpsError('failed-precondition', 'companyId is required for this read');
    }

    if (kind === 'userSyncState') {
      return sendHttpOk(res, await readFirestoreUserSyncState(auth.uid));
    }

    if (kind === 'workers') {
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.listCompanyWorkers(requestedCompanyId));
      }
      return sendHttpOk(res, await readFirestoreWorkers(requestedCompanyId));
    }

    if (kind === 'clients') {
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.listCompanyClients(requestedCompanyId));
      }
      return sendHttpOk(res, await readFirestoreClients(requestedCompanyId));
    }

    if (kind === 'jobs') {
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.listCompanyJobs(requestedCompanyId, baseProfile, listOptions));
      }
      return sendHttpOk(res, await readFirestoreJobs(requestedCompanyId, baseProfile, listOptions));
    }

    if (kind === 'documents') {
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.listCompanyDocuments(requestedCompanyId, baseProfile, listOptions));
      }
      return sendHttpOk(res, await readFirestoreDocuments(requestedCompanyId, baseProfile, listOptions));
    }

    if (kind === 'inventory') {
      const scope = String(body.scope || 'user').trim().toLowerCase();
      const targetUid = scope === 'company' ? auth.uid : String(body.targetUid || auth.uid).trim();
      if (scope !== 'company' && targetUid !== auth.uid) {
        await assertHttpCompanyAccess({
          uid: auth.uid,
          companyId: requestedCompanyId,
          allowedRoles: ['manager', 'dev'],
          allowSoloScope: false,
          preloadedProfile: baseProfile,
        });
        await assertTargetWorkerScopedUserInCompany(targetUid, requestedCompanyId);
      }
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        if (scope === 'company') {
          const bootstrap = await dbModule.getBootstrapReadModel(auth.uid, requestedCompanyId, { includeCollections: false });
          if (!bootstrap) {
            throw new HttpsError('failed-precondition', 'SQL bootstrap profile not found for authenticated user');
          }
          return sendHttpOk(res, bootstrap.companyInventory || emptyInventory());
        }
        if (targetUid === auth.uid) {
          const bootstrap = await dbModule.getBootstrapReadModel(auth.uid, requestedCompanyId, { includeCollections: false });
          if (!bootstrap) {
            throw new HttpsError('failed-precondition', 'SQL bootstrap profile not found for authenticated user');
          }
          return sendHttpOk(res, bootstrap.inventory || emptyInventory());
        }
        return sendHttpOk(res, await dbModule.getUserInventorySnapshot(requestedCompanyId, targetUid));
      }
      return sendHttpOk(res, await readFirestoreInventory(requestedCompanyId, scope, targetUid));
    }

    if (kind === 'companySyncState') {
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.getCompanySyncState(requestedCompanyId));
      }
      return sendHttpOk(res, await readFirestoreCompanySyncState(requestedCompanyId));
    }

    if (kind === 'recordById') {
      const recordId = String(body.recordId || '').trim();
      if (!recordId) {
        throw new HttpsError('invalid-argument', 'recordId is required');
      }
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.getRecordById(requestedCompanyId, recordId, baseProfile));
      }
      return sendHttpOk(res, await readFirestoreRecord(requestedCompanyId, recordId, baseProfile));
    }

    if (kind === 'documentTask') {
      const taskId = String(body.taskId || '').trim();
      if (!taskId) {
        throw new HttpsError('invalid-argument', 'taskId is required');
      }
      if (isSqlPersistenceEnabled()) {
        const dbModule = loadDbModule();
        return sendHttpOk(res, await dbModule.getDocumentTaskStatus(taskId, auth.uid));
      }
      return sendHttpOk(res, await readFirestoreDocumentTask(taskId, auth.uid));
    }

    throw new HttpsError('invalid-argument', 'Unsupported read model kind');
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});
