import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import admin from 'firebase-admin';
import logger from 'firebase-functions/logger';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import crypto from 'crypto';
import { isSqlPersistenceEnabled } from './sql-access';

/**
 * Shared infrastructure module for Smart-Job Cloud Functions.
 *
 * Contains all imports, Firebase initialisation, global options,
 * constants, and helper / utility functions used across the
 * individual function modules.
 */

// ── Core imports ──────────────────────────────────────────────────────────
const {
  DOC_TYPE,
  DOC_SUFFIX,
  VAT_RATE,
  getSubscriptionTierForRole,
  getEnabledModulesForTier,
} = require("@smart-job/contracts");
const {
  CORS_ALLOWED_ORIGINS: SHARED_CORS_ALLOWED_ORIGINS,
  isFunctionsEmulator: sharedIsFunctionsEmulator,
  parseBearerToken: sharedParseBearerToken,
  resolveHttpAuth: sharedResolveHttpAuth,
  sendHttpOk: sharedSendHttpOk,
  sendHttpError: sharedSendHttpError,
  parseJsonBody: sharedParseJsonBody,
  httpStatusFromHttpsErrorCode: sharedHttpStatusFromHttpsErrorCode,
  sendCaughtHttpError: sharedSendCaughtHttpError,
  requireNonEmptyString: sharedRequireNonEmptyString,
  optionalTrimmedString: sharedOptionalTrimmedString,
  getClientIp: sharedGetClientIp,
} = require('./shared-http');
const {
  userDataDocPath: sharedUserDataDocPath,
  userProfileDocPath: sharedUserProfileDocPath,
  userCacheDocPath: sharedUserCacheDocPath,
  companyWorkerDocPath: sharedCompanyWorkerDocPath,
  companyManagerDocPath: sharedCompanyManagerDocPath,
  normalizeRole: sharedNormalizeRole,
  toProfileRole: sharedToProfileRole,
  normalizeAccountType: sharedNormalizeAccountType,
  validateCompanyId: sharedValidateCompanyId,
  getUserProfileOrThrow: sharedGetUserProfileOrThrow,
  assertTargetUserInCompany: sharedAssertTargetUserInCompany,
  assertTargetWorkerScopedUserInCompany: sharedAssertTargetWorkerScopedUserInCompany,
  assertHttpCompanyAccess: sharedAssertHttpCompanyAccess,
  verifyManagerAuth: sharedVerifyManagerAuth,
  getAuthenticatedUserProfile: sharedGetAuthenticatedUserProfile,
} = require('./shared-access');
const {
  createDocumentTaskInSql,
  markDocumentTaskFailedInSql,
  markDocumentTaskQueuedInSql,
} = require('./sql-document-tasks');

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
  return process.env.FUNCTIONS_EMULATOR === 'true' ||
    !!process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NODE_ENV === 'test' ||
    String(process.env.npm_lifecycle_event || '').startsWith('test');
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

// ── Firestore-backed rate limiter for HTTP endpoints ──────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;            // max requests per window per key across all function instances
const RATE_LIMIT_COLLECTION = 'rate_limits';

/**
 * Returns true if the caller identified by `key` has exceeded the rate limit.
 */
async function isRateLimited(key, options: any = {}) {
  const rawKey = String(key || '').trim();
  if (!rawKey) return false;

  const windowMs = Math.max(1_000, Number(options.windowMs || RATE_LIMIT_WINDOW_MS) || RATE_LIMIT_WINDOW_MS);
  const maxRequests = Math.max(1, Number(options.maxRequests || RATE_LIMIT_MAX) || RATE_LIMIT_MAX);
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const bucketStartMs = bucket * windowMs;
  const resetAtMs = bucketStartMs + windowMs;
  const docId = crypto.createHash('sha256').update(`${rawKey}:${windowMs}:${maxRequests}:${bucket}`).digest('hex');
  const rateLimitRef = admin.firestore().collection(RATE_LIMIT_COLLECTION).doc(docId);

  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const nextCount = snap.exists ? Number(snap.data()?.count || 0) + 1 : 1;

    tx.set(rateLimitRef, {
      keyHash: docId,
      count: nextCount,
      windowStartedAt: new Date(bucketStartMs).toISOString(),
      resetAt: new Date(resetAtMs).toISOString(),
      expireAt: new Date(resetAtMs + RATE_LIMIT_WINDOW_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return nextCount > maxRequests;
  });
}

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
  // Rejection sampling to eliminate modulo bias
  const max = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < length) {
    const bytes = crypto.randomBytes(length - code.length);
    for (let i = 0; i < bytes.length && code.length < length; i += 1) {
      if (bytes[i] < max) {
        code += alphabet[bytes[i] % alphabet.length];
      }
    }
  }
  return code;
}

function normalizeRole(role) {
  return sharedNormalizeRole(role);
}

function toProfileRole(role) {
  return sharedToProfileRole(role);
}

function normalizeAccountType(accountType) {
  return sharedNormalizeAccountType(accountType);
}

/**
 * Validate companyId format — must be a non-empty alphanumeric string.
 * Prevents path traversal and malformed document paths.
 */
function validateCompanyId(companyId) {
  return sharedValidateCompanyId(companyId);
}

// ── Path helpers ──────────────────────────────────────────────────────────
function userDataDocPath(uid, docId) {
  return sharedUserDataDocPath(uid, docId);
}

function userProfileDocPath(uid) {
  return sharedUserProfileDocPath(uid);
}

function userCacheDocPath(uid) {
  return sharedUserCacheDocPath(uid);
}

function companyWorkerDocPath(companyId, wid) {
  return sharedCompanyWorkerDocPath(companyId, wid);
}
function companyManagerDocPath(companyId, mid) {
  return sharedCompanyManagerDocPath(companyId, mid);
}

// ── Auth / HTTP helpers ───────────────────────────────────────────────────
function parseBearerToken(value) {
  return sharedParseBearerToken(value);
}

async function resolveHttpAuth(req) {
  return sharedResolveHttpAuth(req);
}

function sendHttpOk(res, data, status = 200) {
  return sharedSendHttpOk(res, data, status);
}

function sendHttpError(res, status, code, message, details = undefined) {
  return sharedSendHttpError(res, status, code, message, details);
}

function parseJsonBody(req) {
  return sharedParseJsonBody(req);
}

function httpStatusFromHttpsErrorCode(code) {
  return sharedHttpStatusFromHttpsErrorCode(code);
}

function sendCaughtHttpError(res, error) {
  return sharedSendCaughtHttpError(res, error);
}

// ── Validation helpers ────────────────────────────────────────────────────
function requireNonEmptyString(value, fieldName, min = 1, max = 2000) {
  return sharedRequireNonEmptyString(value, fieldName, min, max);
}

function optionalTrimmedString(value, max = 2000) {
  return sharedOptionalTrimmedString(value, max);
}

// ── Profile / company access helpers ──────────────────────────────────────
async function getUserProfileOrThrow(uid) {
  return sharedGetUserProfileOrThrow(uid);
}

async function assertTargetUserInCompany(targetUid, companyId) {
  return sharedAssertTargetUserInCompany(targetUid, companyId);
}

async function assertTargetWorkerScopedUserInCompany(targetUid, companyId) {
  return sharedAssertTargetWorkerScopedUserInCompany(targetUid, companyId);
}

async function assertHttpCompanyAccess(params) {
  return sharedAssertHttpCompanyAccess(params);
}

// ── Document ID helpers ───────────────────────────────────────────────────
function toDocumentDocId(documentId) {
  return String(documentId || '').trim();
}

function getClientIp(req) {
  return sharedGetClientIp(req);
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
async function sendPushNotification(pushToken, title, body, data = {} as any, userId = '') {
  try {
    logger.info('sendPushNotification called', {
      hasToken: !!pushToken,
      userId: userId || null,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
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
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'smart_job_default',
          priority: 'high' as const,
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

    if ((error as any).code === 'messaging/invalid-registration-token' ||
        (error as any).code === 'messaging/registration-token-not-registered' ||
        (error as any).code === 'messaging/invalid-argument') {

      if (userId) {
        try {
          if (isSqlPersistenceEnabled()) {
            const { clearUserPushTokenInSql } = require('./sql-user-profile');
            await clearUserPushTokenInSql({ uid: userId });
          } else {
            await admin.firestore().doc(userProfileDocPath(userId)).update({
              pushToken: admin.firestore.FieldValue.delete(),
              pushTokenType: admin.firestore.FieldValue.delete(),
            });
          }
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
  return sharedVerifyManagerAuth(auth, targetWorkerUid, companyId);
}

/**
 * Resolve and validate the authenticated user's profile from Firestore.
 * Never trust role/company data from request payloads.
 */
async function getAuthenticatedUserProfile(auth, options: any = {}) {
  return sharedGetAuthenticatedUserProfile(auth, options);
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

  for (const prefix of [`${uid}/jobs/`, `${uid}/inventory/`, `previews/${uid}/`]) {
    try {
      const [files] = await admin.storage().bucket().getFiles({ prefix });
      await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
    } catch (error) {
      logger.warn('deleteUserData skipped storage prefix', { uid, prefix, error: error.message });
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
  taskId: providedTaskId,
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
  const taskId = providedTaskId || `generate_${documentType}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const useSqlTasks = isSqlPersistenceEnabled();
  let lockAcquired = false;
  let sqlTaskCreated = Boolean(providedTaskId);

  if (!useSqlTasks) {
    await acquireCompanyBusyFlag(companyId, lockType, uid, taskId);
    lockAcquired = true;
  }

  try {
    if (useSqlTasks) {
      if (!providedTaskId) {
        await createDocumentTaskInSql({
          taskId,
          companyId,
          uid,
          taskType: 'generate',
          documentType,
          status: 'pending',
          requestPayload: {
            documentData: completeDocumentData,
            publicDocumentId: documentId || null,
            documentNumber: documentNumber || null,
          },
        });
        sqlTaskCreated = true;
      }
    } else {
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
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

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

    if (useSqlTasks) {
      await markDocumentTaskQueuedInSql(taskId, {
        pubsubMessageId: messageId,
        publicDocumentId: documentId || null,
      });
    } else {
      const taskRef = admin.firestore().doc(`documentTasks/${taskId}`);
      await taskRef.update({
        status: 'queued',
        pubsubMessageId: messageId,
        queuedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return { taskId, messageId, published: true };
  } catch (error) {
    if (useSqlTasks && sqlTaskCreated) {
      try {
        await markDocumentTaskFailedInSql(taskId, error.message);
      } catch (sqlTaskError) {
        logger.error('Failed to mark SQL generate task as failed after publish error', {
          taskId,
          companyId,
          error: sqlTaskError.message,
        });
      }
    }
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

export { // Firebase / third-party references
  admin, logger, axios, crypto, // firebase-functions triggers & helpers
  onCall, HttpsError, onRequest, onDocumentCreated, onDocumentUpdated, // Pub/Sub
  PREVIEW_TOPIC, GENERATE_TOPIC, getPubSub, // Document type constants
  DOC_TYPE, DOC_SUFFIX, // Role / permission constants
  GENERATE_DOCUMENT_ALLOWED_ROLES, HTTP_COMPANY_CLIENT_ROLES, HTTP_COMPANY_MANAGER_ROLES, HTTP_ALL_APP_ROLES, MAX_ITEMS_PER_DOCUMENT, MAX_JOB_ARRAY_LENGTH, VAT_RATE, // CORS
  CORS_ALLOWED_ORIGINS, // Rate limiting
  isRateLimited, // PII / validation helpers
  redactEmail, isValidEmail, generateInviteCode, normalizeRole, toProfileRole, normalizeAccountType, getSubscriptionTierForRole, getEnabledModulesForTier, validateCompanyId, // Path helpers
  userDataDocPath, userProfileDocPath, userCacheDocPath, companyWorkerDocPath, companyManagerDocPath, // Environment helpers
  isFunctionsEmulator, // Auth / HTTP helpers
  parseBearerToken, resolveHttpAuth, sendHttpOk, sendHttpError, parseJsonBody, httpStatusFromHttpsErrorCode, sendCaughtHttpError, // Validation helpers
  requireNonEmptyString, optionalTrimmedString, // Profile / company access helpers
  getUserProfileOrThrow, assertTargetUserInCompany, assertTargetWorkerScopedUserInCompany, assertHttpCompanyAccess, // Document ID helpers
  toDocumentDocId, getClientIp, toBaseDocumentId, // Push notifications
  sendPushNotification, // Manager / auth verification
  verifyManagerAuth, getAuthenticatedUserProfile, // Audit logging
  saveAuditLog, // Recursive delete & user data cleanup
  recursiveDelete, deleteUserData, // Document busy-flag & Pub/Sub helpers (shared by documents.js & tax.js)
  clearCompanyBusyFlag, acquireCompanyBusyFlag, publishGenerateTaskHelper };


