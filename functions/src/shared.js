/**
 * Shared infrastructure module for Smart-Job Cloud Functions.
 *
 * Contains all imports, Firebase initialisation, global options,
 * constants, and helper / utility functions used across the
 * individual function modules.
 */

// ── Core imports ──────────────────────────────────────────────────────────
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const crypto = require("crypto");
const { DOC_TYPE, DOC_SUFFIX, VAT_RATE } = require("@smart-job/contracts");

// ── Pub/Sub topics for document generation ────────────────────────────────
const PREVIEW_TOPIC = 'document-preview';
const GENERATE_TOPIC = 'document-generate';

// N5: Lazy-load PubSub to reduce cold start for functions that don't need it
let _pubsub;
function getPubSub() {
  if (!_pubsub) _pubsub = new (require("@google-cloud/pubsub").PubSub)();
  return _pubsub;
}

// ── Configure axios-retry ─────────────────────────────────────────────────
// Retries on 5xx errors and network errors with exponential backoff
axiosRetry(axios, {
  retries: 5,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           (error.response && error.response.status >= 500);
  },
  onRetry: (retryCount, error, requestConfig) => {
    logger.warn(`Axios retry attempt ${retryCount}/5`, {
      url: requestConfig.url,
      method: requestConfig.method,
      error: error.message,
      code: error.code,
      status: error.response?.status
    });
  },
});

// ── Initialize Firebase Admin SDK ─────────────────────────────────────────
admin.initializeApp();

// ── Document type / suffix / VAT constants ────────────────────────────────
// DOC_TYPE, DOC_SUFFIX, VAT_RATE imported from @smart-job/contracts above.

// ── Role / permission constants ───────────────────────────────────────────
const GENERATE_DOCUMENT_ALLOWED_ROLES = ['manager', 'user', 'basic'];
const HTTP_COMPANY_CLIENT_ROLES = ['manager', 'user', 'basic', 'dev'];
const HTTP_COMPANY_MANAGER_ROLES = ['manager', 'dev'];
const HTTP_ALL_APP_ROLES = ['manager', 'worker', 'user', 'basic', 'dev'];
const MAX_ITEMS_PER_DOCUMENT = 100; // Safety cap — also enforced in Cloud Run PDF service
const MAX_JOB_ARRAY_LENGTH = 200;  // Max entries per array field in a job document
// VAT_RATE imported from @smart-job/contracts above.

// ── Global options ────────────────────────────────────────────────────────
// P1-2: Enable App Check enforcement globally for all callable/onRequest functions
setGlobalOptions({
  maxInstances: 25,
  region: "us-central1",
  enforceAppCheck: true,
});

// ── CORS ──────────────────────────────────────────────────────────────────
function isFunctionsEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
}

const _configuredCorsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];
const CORS_ALLOWED_ORIGINS = _configuredCorsOrigins.length > 0
  ? _configuredCorsOrigins
  : (
    isFunctionsEmulator()
      ? ['http://localhost:3000', 'http://127.0.0.1:3000']
      : (() => {
          logger.warn('CORS_ALLOWED_ORIGINS is empty in production — HTTP endpoints will reject cross-origin requests');
          return [];
        })()
  );

// ── Simple in-memory rate limiter for unauthenticated endpoints ───────────
// NOTE: This limiter is per-instance. With maxInstances=25, the effective
// limit across all instances could be up to RATE_LIMIT_MAX × 25.  This is
// acceptable for low-sensitivity public endpoints (contactRequestV1, invites).
// For stricter enforcement, use a distributed counter (e.g. Firestore or Redis).
const _rateLimitMap = new Map(); // key → { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;            // max requests per window per key per instance
const RATE_LIMIT_MAP_MAX_SIZE = 10_000; // cap to prevent unbounded memory growth

/**
 * Returns true if the caller identified by `key` has exceeded the rate limit.
 */
function isRateLimited(key) {
  const now = Date.now();
  let entry = _rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    _rateLimitMap.set(key, entry);
    if (_rateLimitMap.size > RATE_LIMIT_MAP_MAX_SIZE) {
      // Evict expired entries when map gets too large
      for (const [k, v] of _rateLimitMap) {
        if (now > v.resetAt) _rateLimitMap.delete(k);
      }
    }
    return false;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}
// Periodic cleanup so the map doesn't grow indefinitely
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateLimitMap) {
    if (now > v.resetAt) _rateLimitMap.delete(k);
  }
}, 5 * 60_000);

// ── P1-9: PII redaction helper ────────────────────────────────────────────
/**
 * Redact an email address for safe logging: "user@example.com" → "u***@e***.com"
 */
function redactEmail(email) {
  if (!email || typeof email !== 'string') return '[none]';
  const parts = email.split('@');
  if (parts.length !== 2) return '[invalid]';
  const [local, domain] = parts;
  const domainParts = domain.split('.');
  const tld = domainParts.pop();
  const domainName = domainParts.join('.');
  return `${local[0]}***@${domainName[0]}***.${tld}`;
}

/**
 * Basic email shape validation.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function generateInviteCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

function normalizeRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'manager') return 'manager';
  if (raw === 'worker') return 'worker';
  if (raw === 'user') return 'user';
  if (raw === 'basic') return 'basic';
  if (raw === 'dev') return 'dev';
  return '';
}

function toProfileRole(role) {
  return normalizeRole(role);
}

function normalizeAccountType(accountType) {
  const raw = String(accountType || '').trim().toLowerCase();
  if (raw === 'solo') return 'solo';
  if (raw === 'business') return 'business';
  return '';
}

/**
 * Validate companyId format — must be a non-empty alphanumeric string.
 * Prevents path traversal and malformed document paths.
 */
function validateCompanyId(companyId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(companyId)) {
    throw new HttpsError('invalid-argument', 'Invalid companyId format');
  }
  return companyId;
}

// ── N2: Distributed counter helpers ───────────────────────────────────────
const NUM_COUNTER_SHARDS = 5;

function getRandomShardId() {
  return Math.floor(Math.random() * NUM_COUNTER_SHARDS);
}

async function incrementDistributedCounter(tx, companyId, counterName, numShards = NUM_COUNTER_SHARDS) {
  const shardId = getRandomShardId();
  const shardRef = admin.firestore().doc(
    `companies/${companyId}/counters/${counterName}/shards/${shardId}`
  );
  tx.set(shardRef, { count: admin.firestore.FieldValue.increment(1) }, { merge: true });
}

async function getDistributedCounterTotal(companyId, counterName) {
  const shardsSnapshot = await admin.firestore()
    .collection(`companies/${companyId}/counters/${counterName}/shards`)
    .get();
  let total = 0;
  shardsSnapshot.forEach(snap => {
    total += Number(snap.data()?.count || 0);
  });
  return total;
}

// ── Path helpers ──────────────────────────────────────────────────────────
function userDataDocPath(uid, docId) {
  return `users/${uid}/data/${docId}`;
}

function userProfileDocPath(uid) {
  return userDataDocPath(uid, 'profile');
}

function userCacheDocPath(uid) {
  return userDataDocPath(uid, 'cache');
}

function companyWorkerDocPath(companyId, wid) {
  return `companies/${companyId}/workers/${wid}`;
}
function companyManagerDocPath(companyId, mid) {
  return `companies/${companyId}/managers/${mid}`;
}

// ── Auth / HTTP helpers ───────────────────────────────────────────────────
function parseBearerToken(value) {
  const header = String(value || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

async function resolveHttpAuth(req) {
  const token = parseBearerToken(req.get('authorization') || req.headers?.authorization || '');
  if (token) {
    try {
      // P1-3: Check token revocation for sensitive operations
      const decoded = await admin.auth().verifyIdToken(token, true /* checkRevoked */);
      return {
        uid: decoded.uid,
        token: decoded,
        source: 'token',
      };
    } catch (error) {
      if (error.code === 'auth/id-token-revoked') {
        throw new HttpsError('unauthenticated', 'Token has been revoked. Please sign in again.');
      }
      throw new HttpsError('unauthenticated', 'Invalid or expired auth token');
    }
  }

  throw new HttpsError('unauthenticated', 'Missing Authorization bearer token');
}

function sendHttpOk(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function sendHttpError(res, status, code, message, details = undefined) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    payload.error.details = details;
  }
  res.status(status).json(payload);
}

function parseJsonBody(req) {
  if (!req.body) {
    throw new HttpsError('invalid-argument', 'Request body is required');
  }
  return req.body;
}

function httpStatusFromHttpsErrorCode(code) {
  if (code === 'invalid-argument') return 400;
  if (code === 'unauthenticated') return 401;
  if (code === 'permission-denied') return 403;
  if (code === 'not-found') return 404;
  if (code === 'already-exists') return 409;
  if (code === 'failed-precondition') return 412;
  if (code === 'resource-exhausted') return 429;
  if (code === 'unavailable') return 503;
  return 500;
}

function sendCaughtHttpError(res, error) {
  if (error instanceof HttpsError) {
    return sendHttpError(
      res,
      httpStatusFromHttpsErrorCode(error.code),
      error.code,
      error.message,
      error.details
    );
  }

  logger.error('Unhandled HTTP function error', {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });

  return sendHttpError(res, 500, 'internal', 'Unexpected server error');
}

// ── Validation helpers ────────────────────────────────────────────────────
function requireNonEmptyString(value, fieldName, min = 1, max = 2000) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new HttpsError('invalid-argument', `${fieldName} is required`);
  }
  if (trimmed.length < min) {
    throw new HttpsError('invalid-argument', `${fieldName} is too short`);
  }
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', `${fieldName} is too long`);
  }
  return trimmed;
}

function optionalTrimmedString(value, max = 2000) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', `Field is too long`);
  }
  return trimmed;
}

// ── Profile / company access helpers ──────────────────────────────────────
async function getUserProfileOrThrow(uid) {
  const ref = admin.firestore().doc(userProfileDocPath(uid));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  return snap.data() || {};
}

async function assertTargetUserInCompany(targetUid, companyId) {
  const targetProfile = await getUserProfileOrThrow(targetUid);
  if (String(targetProfile.companyId || '') !== companyId) {
    throw new HttpsError('permission-denied', 'Target user is not in this company');
  }

  const targetRole = normalizeRole(targetProfile.role);
  if (targetRole === 'manager') {
    const targetMid = String(targetProfile.mid || '').trim();
    let managerSnap = null;
    if (targetMid) {
      managerSnap = await admin.firestore().doc(companyManagerDocPath(companyId, targetMid)).get();
    }
    if (!managerSnap || !managerSnap.exists) {
      const managerQuery = await admin.firestore()
        .collection(`companies/${companyId}/managers`)
        .where('uid', '==', targetUid)
        .limit(1)
        .get();
      if (managerQuery.empty) {
        throw new HttpsError('permission-denied', 'Target manager membership record not found');
      }
    }
    return;
  }

  const targetWid = String(targetProfile.wid || '').trim();
  if (!targetWid) {
    throw new HttpsError('permission-denied', 'Target user has no wid membership key');
  }

  const membershipSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, targetWid)).get();
  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'Target worker membership record not found');
  }
}

async function assertHttpCompanyAccess(params) {
  const {
    uid,
    companyId,
    allowedRoles = [],
    allowSoloScope = false,
    preloadedProfile = null,
  } = params;

  const profile = preloadedProfile || await getUserProfileOrThrow(uid);
  const profileRole = normalizeRole(profile.role);
  if (!profileRole) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  const profileAccountType = normalizeAccountType(profile.accountType);
  const profileCompanyId = String(profile.companyId || '');
  const isSoloScope = allowSoloScope && profileAccountType === 'solo' && profileCompanyId === companyId;

  let resolvedRole = profileRole;
  let workerSnap = null;

  if (!isSoloScope) {
    if (profileCompanyId !== companyId && profileRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Company mismatch');
    }

    const profileWid = String(profile.wid || '').trim();
    const profileMid = String(profile.mid || '').trim();

    if (profileWid) {
      workerSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, profileWid)).get();
    }

    if (workerSnap && workerSnap.exists) {
      const workerRole = normalizeRole(workerSnap.data()?.role);
      if (workerRole) {
        resolvedRole = workerRole;
      }
    }

    if ((!workerSnap || !workerSnap.exists) && profileRole === 'manager') {
      let managerSnap = null;
      if (profileMid) {
        managerSnap = await admin.firestore().doc(companyManagerDocPath(companyId, profileMid)).get();
      }
      if ((!managerSnap || !managerSnap.exists) && profileRole !== 'dev') {
        const managerQuery = await admin.firestore()
          .collection(`companies/${companyId}/managers`)
          .where('uid', '==', uid)
          .limit(1)
          .get();
        if (!managerQuery.empty) {
          managerSnap = managerQuery.docs[0];
        }
      }
      if (managerSnap && managerSnap.exists) {
        const managerRole = normalizeRole(managerSnap.data()?.role);
        if (managerRole) {
          resolvedRole = managerRole;
        }
      } else if (profileRole !== 'dev') {
        throw new HttpsError('permission-denied', 'Company manager membership record not found');
      }
    } else if ((!workerSnap || !workerSnap.exists) && profileRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Company worker membership record not found');
    }
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(resolvedRole)) {
    throw new HttpsError('permission-denied', 'Role is not allowed for this action');
  }

  return {
    profile,
    resolvedRole,
    isSoloScope,
    workerSnap,
  };
}

// ── Document ID helpers ───────────────────────────────────────────────────
function toDocumentDocId(documentId) {
  return String(documentId || '').trim();
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || 'unknown';
}

function toBaseDocumentId(documentId) {
  return String(documentId || '').trim();
}

// ── Job field helpers ─────────────────────────────────────────────────────
// Legacy syncJobAssigneeFields removed — jobs now use clean wid/wname/mid/mname
// fields with no duplication.

// ── Push notifications ────────────────────────────────────────────────────
/**
 * Send push notification via Firebase Cloud Messaging (FCM).
 */
async function sendPushNotification(pushToken, title, body, data = {}, userId = '') {
  try {
    logger.info('sendPushNotification called', {
      token: pushToken ? pushToken.substring(0, 30) + '...' : 'null',
      title,
      body
    });

    if (!pushToken) {
      logger.warn('No push token provided');
      return { success: false, reason: 'no_token', error: 'No push token provided' };
    }

    logger.info(`Sending FCM notification to ${userId || 'unknown user'}`);

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, String(value)])
        ),
        timestamp: Date.now().toString(),
      },
      token: pushToken,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'smart_job_default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          color: '#00ACC1',
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.info(`Successfully sent FCM notification to ${userId}`, { messageId: response });

    return { success: true, messageId: response };

  } catch (error) {
    logger.error(`Error sending notification to ${userId}:`, error);

    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-argument') {

      if (userId) {
        try {
          await admin.firestore().doc(userProfileDocPath(userId)).update({
            pushToken: admin.firestore.FieldValue.delete(),
            pushTokenType: admin.firestore.FieldValue.delete(),
          });
          logger.info(`Removed invalid FCM token for ${userId}`);
        } catch (updateError) {
          logger.error(`Failed to remove invalid token for ${userId}:`, updateError);
        }
      }

      return { success: false, reason: 'fcm_invalid_token', error: error.message };
    }

    return { success: false, reason: 'fcm_send_failed', error: error.message };
  }
}

// ── Manager / auth verification ───────────────────────────────────────────
/**
 * Verify manager authorization.
 * Uses Firebase Auth UID for document paths.
 */
async function verifyManagerAuth(auth, targetWorkerUid, companyId) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const managerUid = auth.uid;

  const managerProfileRef = admin.firestore().doc(userProfileDocPath(managerUid));
  const managerProfile = await managerProfileRef.get();

  if (!managerProfile.exists) {
    throw new HttpsError('not-found', 'Manager profile not found');
  }

  const managerData = managerProfile.data();
  const managerRole = normalizeRole(managerData.role);

  if (!['manager', 'dev'].includes(managerRole)) {
    throw new HttpsError('permission-denied', 'Only managers can perform this action');
  }

  if (managerRole !== 'dev' && managerData.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Manager can only manage workers from their own company');
  }

  if (targetWorkerUid) {
    const workerProfileRef = admin.firestore().doc(userProfileDocPath(targetWorkerUid));
    const workerProfile = await workerProfileRef.get();

    if (!workerProfile.exists) {
      throw new HttpsError('not-found', 'Worker profile not found');
    }

    const workerData = workerProfile.data();
    const workerRole = normalizeRole(workerData.role);

    if (['manager', 'dev'].includes(workerRole) && managerRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Cannot manage a user with manager or dev role');
    }

    if (workerData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Worker is not from the same company');
    }
  }

  return { managerUid, managerEmail: auth.token.email };
}

/**
 * Resolve and validate the authenticated user's profile from Firestore.
 * Never trust role/company data from request payloads.
 */
async function getAuthenticatedUserProfile(auth, options = {}) {
  const {
    allowedRoles = null,
    requireCompany = false,
    companyId = null,
  } = options;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = auth.uid;
  const userProfileRef = admin.firestore().doc(userProfileDocPath(uid));
  const userProfileDoc = await userProfileRef.get();

  if (!userProfileDoc.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  const userData = userProfileDoc.data() || {};
  const role = normalizeRole(userData.role);

  if (!role) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'User role is not allowed for this action');
  }

  if (requireCompany && !userData.companyId) {
    throw new HttpsError('failed-precondition', 'User has no company assigned');
  }

  if (companyId && userData.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Company name mismatch');
  }

  return { uid, userData, role };
}

// ── Audit logging ─────────────────────────────────────────────────────────
/**
 * Save an audit log entry for a company action.
 */
async function saveAuditLog(companyId, action, performedBy, documentId, documentType) {
  try {
    const auditLogRef = admin.firestore().collection(`companies/${companyId}/auditLogs`).doc();
    await auditLogRef.set({
      action: action,
      performedBy: performedBy,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      documentId: documentId || null,
      documentType: documentType || null,
    });
    logger.info('Audit log saved', {
      action,
      performedBy,
      companyId,
      documentId: documentId || null,
      documentType: documentType || null,
    });
  } catch (error) {
    logger.error('Failed to save audit log', {
      action,
      performedBy,
      companyId,
      documentId: documentId || null,
      error: error.message,
      stack: error.stack,
    });
  }
}

// ── Recursive delete & user data cleanup ──────────────────────────────────
async function recursiveDelete(path) {
  const collectionRef = admin.firestore().collection(path);
  const snapshot = await collectionRef.listDocuments();

  for (const docRef of snapshot) {
    const subcollections = await docRef.listCollections();

    for (const subcollection of subcollections) {
      await recursiveDelete(`${path}/${docRef.id}/${subcollection.id}`);
    }

    await docRef.delete();
  }
}

async function deleteUserData(uid) {
  const collectionPaths = [
    `users/${uid}/data`,
    `users/${uid}/jobs`,
    `users/${uid}/personal_inventory`,
  ];

  for (const path of collectionPaths) {
    try {
      await recursiveDelete(path);
    } catch (error) {
      logger.warn('deleteUserData skipped path', { uid, path, error: error.message });
    }
  }
}

// ── Document busy-flag & Pub/Sub helpers ──────────────────────────────────

/**
 * Clear a company busy flag (document lock).
 */
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
 * Publish a Generate Task to Pub/Sub.
 * Shared by documents.js (publishGenerateTask) and tax.js (getInvoiceApproval).
 */
async function publishGenerateTaskHelper({
  documentType,
  documentId,
  documentNumber,
  completeDocumentData,
  uid,
  companyId,
  createdByUid,
  userRole
}) {
  const lockType = `generate_${documentType}`;
  const taskId = `generate_${documentType}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let lockAcquired = false;

  await acquireCompanyBusyFlag(companyId, lockType, uid, taskId);
  lockAcquired = true;

  try {
    const taskRef = admin.firestore().doc(`documentTasks/${taskId}`);
    await taskRef.set({
      taskId,
      type: 'generate',
      taskType: 'generate',
      documentType,
      companyId,
      documentId,
      documentNumber,
      uid,
      createdBy: createdByUid,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      documentData: completeDocumentData,
      expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // TTL: auto-delete after 30 days
    });

    const messageData = {
      taskId,
      documentType,
      documentId,
      documentNumber,
      documentData: completeDocumentData,
      uid,
      companyId,
      userRole: userRole || null,
      confirmationNumber: completeDocumentData?.taxAuthorityConfirmationNumber || null,
    };

    const topic = getPubSub().topic(GENERATE_TOPIC);
    const messageBuffer = Buffer.from(JSON.stringify(messageData));
    const messageId = await topic.publishMessage({ data: messageBuffer });

    logger.info('Generate task published via helper', { taskId, messageId, documentType, documentId });

    await taskRef.update({
      status: 'queued',
      pubsubMessageId: messageId,
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { taskId, messageId, published: true };
  } catch (error) {
    if (lockAcquired) {
      try {
        await clearCompanyBusyFlag(companyId, lockType);
      } catch (unlockError) {
        logger.error('Failed to clear busy flag after publishGenerateTaskHelper error', {
          lockType, companyId, error: unlockError.message
        });
      }
    }
    throw error;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
  // Firebase / third-party references
  admin,
  logger,
  axios,
  crypto,

  // firebase-functions triggers & helpers
  onCall,
  HttpsError,
  onRequest,
  onDocumentCreated,
  onDocumentUpdated,

  // Pub/Sub
  PREVIEW_TOPIC,
  GENERATE_TOPIC,
  getPubSub,

  // Document type constants
  DOC_TYPE,
  DOC_SUFFIX,

  // Role / permission constants
  GENERATE_DOCUMENT_ALLOWED_ROLES,
  HTTP_COMPANY_CLIENT_ROLES,
  HTTP_COMPANY_MANAGER_ROLES,
  HTTP_ALL_APP_ROLES,
  MAX_ITEMS_PER_DOCUMENT,
  MAX_JOB_ARRAY_LENGTH,
  VAT_RATE,

  // CORS
  CORS_ALLOWED_ORIGINS,

  // Distributed counter helpers
  NUM_COUNTER_SHARDS,
  getRandomShardId,
  incrementDistributedCounter,
  getDistributedCounterTotal,

  // Rate limiting
  isRateLimited,

  // PII / validation helpers
  redactEmail,
  isValidEmail,
  generateInviteCode,
  normalizeRole,
  toProfileRole,
  normalizeAccountType,
  validateCompanyId,

  // Path helpers
  userDataDocPath,
  userProfileDocPath,
  userCacheDocPath,
  companyWorkerDocPath,
  companyManagerDocPath,

  // Environment helpers
  isFunctionsEmulator,

  // Auth / HTTP helpers
  parseBearerToken,
  resolveHttpAuth,
  sendHttpOk,
  sendHttpError,
  parseJsonBody,
  httpStatusFromHttpsErrorCode,
  sendCaughtHttpError,

  // Validation helpers
  requireNonEmptyString,
  optionalTrimmedString,

  // Profile / company access helpers
  getUserProfileOrThrow,
  assertTargetUserInCompany,
  assertHttpCompanyAccess,

  // Document ID helpers
  toDocumentDocId,
  getClientIp,
  toBaseDocumentId,

  // Push notifications
  sendPushNotification,

  // Manager / auth verification
  verifyManagerAuth,
  getAuthenticatedUserProfile,

  // Audit logging
  saveAuditLog,

  // Recursive delete & user data cleanup
  recursiveDelete,
  deleteUserData,

  // Document busy-flag & Pub/Sub helpers (shared by documents.js & tax.js)
  clearCompanyBusyFlag,
  acquireCompanyBusyFlag,
  publishGenerateTaskHelper,
};
