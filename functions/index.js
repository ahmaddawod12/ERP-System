/**
 * Cloud Functions for Smart-Job Application
 * Secure worker management functions for iOS and Android platforms
 * Includes push notification support via FCM
 * Document generation using Cloud Run + Pub/Sub for scalability
 */

const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const { PubSub } = require("@google-cloud/pubsub");
const crypto = require("crypto");

// Pub/Sub topics for document generation
const PREVIEW_TOPIC = 'document-preview';
const GENERATE_TOPIC = 'document-generate';

// Configure axios-retry for all axios instances
// Retries on 5xx errors and network errors with exponential backoff
axiosRetry(axios, {
  retries: 5, // Maximum 5 retries
  retryDelay: axiosRetry.exponentialDelay, // Exponential backoff: ~1s, 2s, 4s, 8s, 16s (industry standard)
  retryCondition: (error) => {
    // Retry on network errors and 5xx server errors
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

// Initialize Firebase Admin SDK
admin.initializeApp();
const pubsub = new PubSub();

/**
 * Document Type Codes (numeric)
 * 10 = Price Proposal (הצעת מחיר)
 * 200 = Delivery Note (תעודת משלוח)
 * 210 = Return Certificate (תעודת החזרה)
 * 305 = Tax Invoice (חשבונית מס)
 * 330 = Refund (זיכוי)
 * 400 = Receipt (קבלה)
 */
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400
};

/**
 * Document ID suffix codes
 * TI = Tax Invoice
 * PP = Price Proposal
 * RD = Refund
 * RC = Return Certificate
 * DN = Delivery Note
 * RT = Receipt
 */
const DOC_SUFFIX = {
  [DOC_TYPE.TAX_INVOICE]: 'TI',
  [DOC_TYPE.PRICE_PROPOSAL]: 'PP',
  [DOC_TYPE.REFUND]: 'RD',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC',
  [DOC_TYPE.DELIVERY_NOTE]: 'DN',
  [DOC_TYPE.RECEIPT]: 'RT'
};

const GENERATE_DOCUMENT_ALLOWED_ROLES = ['manager', 'user', 'basic'];
const HTTP_COMPANY_CLIENT_ROLES = ['manager', 'user', 'basic', 'dev'];
const HTTP_COMPANY_MANAGER_ROLES = ['manager', 'dev'];
const HTTP_ALL_APP_ROLES = ['manager', 'worker', 'user', 'basic', 'dev'];


// For cost control, set maximum concurrent instances
// P1-2: Enable App Check enforcement globally for all callable/onRequest functions
setGlobalOptions({ 
  maxInstances: 10,
  region: "us-central1", // Change to your preferred region
  enforceAppCheck: true, // Reject requests without valid App Check token
});

// ── Simple in-memory rate limiter for unauthenticated endpoints ───────────
const _rateLimitMap = new Map(); // key → { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;            // max requests per window per key

/**
 * Returns true if the caller identified by `key` has exceeded the rate limit.
 * Call this at the top of public endpoints (e.g. contactRequestV1).
 */
function isRateLimited(key) {
  const now = Date.now();
  let entry = _rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    _rateLimitMap.set(key, entry);
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateInviteCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
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

function userDataDocPath(uid, docId) {
  return `users/${uid}/data/${docId}`;
}

function userProfileDocPath(uid) {
  return userDataDocPath(uid, 'profile');
}

function userCacheDocPath(uid) {
  return userDataDocPath(uid, 'cache');
}

function companyWorkerDocPath(companyId, uid) {
  return `companies/${companyId}/workers/${uid}`;
}

function isFunctionsEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
}

function parseBearerToken(value) {
  const header = String(value || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

async function resolveHttpAuth(req, body = {}) {
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

  if (isFunctionsEmulator()) {
    const fallbackUid = String(body.uid || '').trim();
    if (fallbackUid) {
      return {
        uid: fallbackUid,
        token: null,
        source: 'dev_fallback',
      };
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

async function getUserProfileOrThrow(uid) {
  const ref = admin.firestore().doc(userProfileDocPath(uid));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  return snap.data() || {};
}

async function assertHttpCompanyAccess(params) {
  const {
    uid,
    companyId,
    allowedRoles = [],
    allowSoloScope = false,
  } = params;

  const profile = await getUserProfileOrThrow(uid);
  const profileRole = normalizeRole(profile.role);
  if (!profileRole) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  const profileAccountType = normalizeAccountType(profile.accountType);
  const profileCompanyId = String(profile.companyId || '');
  const isSoloScope = allowSoloScope && profileAccountType === 'solo' && uid === companyId;

  let resolvedRole = profileRole;
  let workerSnap = null;

  if (!isSoloScope) {
    if (profileCompanyId !== companyId && profileRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Company mismatch');
    }

    workerSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, uid)).get();
    if (!workerSnap.exists && profileRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Company membership record not found');
    }
    if (workerSnap.exists) {
      const workerRole = normalizeRole(workerSnap.data()?.role);
      if (workerRole) {
        resolvedRole = workerRole;
      }
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

/**
 * Normalize certification document IDs.
 * Firestore certification docs are stored with "c_" prefix.
 */
function toCertificationDocId(documentId) {
  const raw = String(documentId || '').trim();
  if (!raw) return '';
  return raw.startsWith('c_') ? raw : `c_${raw}`;
}

function toBaseDocumentId(documentId) {
  const raw = String(documentId || '').trim();
  return raw.startsWith('c_') ? raw.slice(2) : raw;
}

/**
 * Helper function to send push notification via Firebase Cloud Messaging (FCM)
 * Only supports native FCM tokens (not Expo push tokens)
 * 
 * @param {string} pushToken - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {Object} data - Custom data payload
 * @param {string} userEmail - User's email (for logging and token cleanup)
 * @returns {Promise<{success: boolean, messageId?: string, reason?: string, error?: string}>}
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
    
    // Check if it's an old Expo push token (legacy - should not happen with new system)
    const isExpoToken = pushToken.startsWith('ExponentPushToken[') || 
                       pushToken.startsWith('ExpoToken[') || 
                       pushToken.startsWith('ExpoPushToken[');
    
    if (isExpoToken) {
      logger.warn('Expo push token detected - this is a legacy token. User needs to update app.');
      return { 
        success: false, 
        reason: 'expo_token_deprecated', 
        error: 'Expo push tokens are no longer supported. User needs to update app.' 
      };
    }
    
    // Send via FCM for native tokens
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
    
    // If token is invalid or expired, remove it from user profile
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


/**
 * Helper function to verify manager authorization
 * Uses Firebase Auth UID for document paths.
 * @param {Object} auth - Firebase auth context (request.auth)
 * @param {string|null} targetWorkerUid - Worker's UID (null for add action)
 * @param {string} companyId - Company name
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

  if (managerRole !== 'manager') {
    throw new HttpsError('permission-denied', 'Only managers can perform this action');
  }

  if (managerData.companyId !== companyId) {
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

    if (workerRole !== 'worker') {
      throw new HttpsError('permission-denied', 'Target user is not a worker');
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

/**
 * Helper function to save audit logs
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
    logger.info(`Audit log saved for ${action} by ${performedBy} in company ${companyId}`);
  } catch (error) {
    logger.error(`Failed to save audit log for ${action}:`, error);
  }
}

/**
 * Helper function to recursively delete all documents and subcollections
 */
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
    uid, // legacy top-level uid collection path
  ];

  for (const path of collectionPaths) {
    try {
      await recursiveDelete(path);
    } catch (error) {
      logger.warn('deleteUserData skipped path', { uid, path, error: error.message });
    }
  }
}

/**
 * Cloud Function: Manage Worker (Combined)
 * Handles add, edit, and delete operations for workers in a single function
 * 
 * Usage:
 * - action: 'add' | 'edit' | 'delete'
 * - email: worker's email (required)
 * - companyId: company name (required)
 * - password: required for 'add'
 * - name: optional
 * - phoneNumber: optional
 * - newEmail: currently not supported for 'edit'
 * - newPassword: optional for 'edit'
 */
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
      workerId: providedWorkerId, // For delete/edit action (company worker doc ID)
      newPassword
    } = request.data || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    logger.info('manageWorker called', { 
      action,
      email: normalizedEmail,
      companyId,
      hasAuth: !!request.auth,
      authEmail: request.auth?.token?.email
    });

    // Validate action
    if (!action || !['add', 'edit', 'delete'].includes(action)) {
      throw new HttpsError('invalid-argument', "Action must be 'add', 'edit', or 'delete'");
    }

    // Validate required parameters
    if (!normalizedEmail || !companyId) {
      throw new HttpsError('invalid-argument', 'Email and company name are required');
    }
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

      const companyRef = admin.firestore().doc(`companies/${companyId}`);
      const workerSerial = await admin.firestore().runTransaction(async (tx) => {
        const companySnap = await tx.get(companyRef);
        const currentWorkerId = Number(companySnap.data()?.wid || 1);
        tx.set(companyRef, { wid: currentWorkerId + 1 }, { merge: true });
        return currentWorkerId;
      });

      // Create Firebase Authentication user
      const userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        password: password,
        ...(name ? { displayName: String(name).trim() } : {}),
      });
      const workerUid = userRecord.uid;

      logger.info(`Created Authentication user for worker: ${redactEmail(normalizedEmail)}`, { uid: workerUid });

      // Canonical worker paths (UID-keyed)
      const workerProfileRef = admin.firestore().doc(userProfileDocPath(workerUid));
      const workerCacheRef = admin.firestore().doc(userCacheDocPath(workerUid));
      const workerListRef = admin.firestore().doc(companyWorkerDocPath(companyId, workerUid));

      const batch = admin.firestore().batch();
      batch.set(workerProfileRef, {
        uid: workerUid,
        role: 'worker',
        email: normalizedEmail,
        companyId: companyId,
        name: String(name || '').trim(),
        phoneNumber: String(phoneNumber || ''),
        workerId: workerUid,
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
        workerId: workerUid,
        uid: workerUid,
        email: normalizedEmail,
        name: String(name || '').trim(),
        phoneNumber: String(phoneNumber || ''),
        Uid: workerUid,
        Wid: workerSerial,
        wid: workerSerial,
        role: 'worker',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();

      logger.info(`Created Firestore profile for worker: ${redactEmail(normalizedEmail)} (uid: ${workerUid})`);

      logger.info(`Added worker to company list: ${companyId}`);
      await saveAuditLog(companyId, 'addWorker', request.auth.uid);

      return {
        success: true,
        uid: workerUid,
        workerId: workerUid,
        wid: workerSerial,
        message: 'Worker account created successfully'
      };
    }

    let workerUid = providedWorkerUid || null;
    let workerId = providedWorkerId || null;

    // P0-7: Require workerUid for edit/delete — email-based lookup is deprecated
    if (!workerUid) {
      throw new HttpsError('invalid-argument', 'workerUid is required for edit/delete operations');
    }

    await verifyManagerAuth(request.auth, workerUid, companyId);

    const canonicalWorkerRef = admin.firestore().doc(companyWorkerDocPath(companyId, workerUid));
    const canonicalWorkerSnap = await canonicalWorkerRef.get();
    if (canonicalWorkerSnap.exists) {
      workerId = workerUid;
    }

    if (!workerId) {
      const workersColRef = admin.firestore().collection(`companies/${companyId}/workers`);
      let workerDocSnap = await workersColRef.where('Uid', '==', workerUid).limit(1).get();
      if (workerDocSnap.empty) {
        workerDocSnap = await workersColRef.where('uid', '==', workerUid).limit(1).get();
      }
      if (workerDocSnap.empty && providedWorkerId) {
        workerDocSnap = await workersColRef.where('Wid', '==', Number(providedWorkerId)).limit(1).get();
      }
      if (workerDocSnap.empty) {
        workerDocSnap = await workersColRef.where('email', '==', normalizedEmail).limit(1).get();
      }
      if (!workerDocSnap.empty) {
        workerId = workerDocSnap.docs[0].id;
      }
    }

    if (!workerId) {
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
      workerBatch.delete(admin.firestore().doc(companyWorkerDocPath(companyId, workerUid)));
      if (workerId && workerId !== workerUid) {
        workerBatch.delete(admin.firestore().doc(`companies/${companyId}/workers/${workerId}`));
      }
      await workerBatch.commit();
      logger.info(`Removed worker from company list: ${companyId}`);

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
      firestoreUpdates.workerId = workerUid;
      const numericWorkerId = Number(workerId);
      if (Number.isFinite(numericWorkerId)) {
        firestoreUpdates.wid = numericWorkerId;
      }
      firestoreUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      // Update worker profile in Firestore
      if (Object.keys(firestoreUpdates).length > 0) {
        await workerProfileRef.set(firestoreUpdates, { merge: true });
        logger.info(`Updated Firestore profile for worker: ${redactEmail(normalizedEmail)} (uid: ${workerUid})`);
      }

      // Update company's worker list (canonical UID key)
      const workerListRef = admin.firestore().doc(companyWorkerDocPath(companyId, workerUid));
      const updateData = {};
      updateData.workerId = workerUid;
      updateData.uid = workerUid;
      updateData.email = normalizedEmail;
      updateData.Uid = workerUid;
      if (Number.isFinite(numericWorkerId)) {
        updateData.Wid = numericWorkerId;
        updateData.wid = numericWorkerId;
      }
      updateData.role = newRole || 'worker';
      updateData.password = admin.firestore.FieldValue.delete(); // Remove legacy plaintext password field
      if (name !== undefined) {
        updateData.name = String(name || '').trim();
      }
      if (phoneNumber !== undefined) {
        updateData.phoneNumber = String(phoneNumber || '');
      }
      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      if (Object.keys(updateData).length > 0) {
        const workerBatch = admin.firestore().batch();
        workerBatch.set(workerListRef, updateData, { merge: true });
        if (workerId && workerId !== workerUid) {
          workerBatch.delete(admin.firestore().doc(`companies/${companyId}/workers/${workerId}`));
        }
        await workerBatch.commit();
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

/**
 * Callable Function: addClientV1
 * Creates a new client using the phone-app-compatible cid counter pattern:
 * - Reads `cid` from companies/{companyId} document
 * - Uses String(cid) as the client document ID (matches phone app exactly)
 * - Increments cid atomically in a transaction
 * - Bumps the appropriate cache version based on caller role
 *   (company cache for manager, user cache for everyone else)
 * Used by both the phone app and the website.
 */
exports.addClientV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }

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
  const companyRef = db.doc(`companies/${companyId}`);

  const newClient = await db.runTransaction(async (tx) => {
    const companySnap = await tx.get(companyRef);
    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'Company not found');
    }
    const cid = companySnap.data().cid;
    if (typeof cid !== 'number') {
      throw new HttpsError('failed-precondition', 'Company not initialized — missing cid counter');
    }

    const clientId = String(cid);
    const clientRef = db.doc(`companies/${companyId}/clients/${clientId}`);
    const now = new Date().toISOString();

    // Build client doc — only include fields that have a value (matches phone app)
    const clientDoc = { name, createdAt: now };
    if (email)     clientDoc.email     = email;
    if (phone)     clientDoc.phone     = phone;
    if (address)   clientDoc.address   = address;
    if (city)      clientDoc.city      = city;
    if (vatNumber) clientDoc.vatNumber = vatNumber;
    if (notes)     clientDoc.notes     = notes;

    tx.set(companyRef, { cid: cid + 1 }, { merge: true });
    tx.set(clientRef, clientDoc);

    return { id: clientId, ...clientDoc };
  });

  // Bump cache version so other devices detect the change and refetch
  // Manager → company cache; everyone else → their own user cache
  const isManagerRole = resolvedRole === 'manager';
  const cacheRef = isManagerRole
    ? db.doc(`companies/${companyId}/business_data/cache`)
    : db.doc(`users/${uid}/data/cache`);
  await cacheRef.set({
    clients: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

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

  // Delete client and bump the appropriate cache version in one atomic batch
  // Manager → company cache; everyone else → their own user cache
  const isManagerRole = resolvedRole === 'manager';
  const cacheRef = isManagerRole
    ? db.doc(`companies/${companyId}/business_data/cache`)
    : db.doc(`users/${uid}/data/cache`);

  const batch = db.batch();
  batch.delete(clientRef);
  batch.set(cacheRef, {
    clients: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();

  logger.info('deleteClientV1: client deleted', { companyId, clientId, uid });
  return { success: true, clientId };
});

/**
 * HTTP Function: createInviteV1
 * Canonical privileged endpoint for invite creation.
 */
exports.createInviteV1 = onRequest({
  region: "us-central1",
  cors: true,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // P1-4: Rate limit invite creation per IP
  const inviteIp = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  if (isRateLimited(`invite_${inviteIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const companyId = requireNonEmptyString(body.companyId, 'companyId', 3, 80);
    const rawTargetRole = String(body.targetRole || 'worker').trim();
    const targetRole = toProfileRole(rawTargetRole);
    if (!['worker', 'user', 'basic'].includes(targetRole)) {
      throw new HttpsError('invalid-argument', 'targetRole must be worker, user, or basic');
    }

    await assertHttpCompanyAccess({
      uid: auth.uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: false,
    });

    const inviteCode = generateInviteCode();
    const inviteRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('invites')
      .doc();

    const now = Date.now();
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    await inviteRef.set({
      inviteId: inviteRef.id,
      code: inviteCode,
      companyId,
      targetRole,
      status: 'active',
      createdBy: auth.uid,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      usedBy: null,
      usedAt: null,
    });

    return sendHttpOk(res, {
      inviteId: inviteRef.id,
      inviteCode,
      expiresAt,
      targetRole,
    });
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: joinCompanyV1
 * Canonical privileged endpoint for company onboarding via invite.
 */
exports.joinCompanyV1 = onRequest({
  region: "us-central1",
  cors: true,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // P1-4: Rate limit join attempts per IP
  const joinIp = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  if (isRateLimited(`join_${joinIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const companyId = requireNonEmptyString(body.companyId, 'companyId', 3, 80);
    const inviteCode = requireNonEmptyString(body.inviteCode, 'inviteCode', 4, 80).toUpperCase();
    const email = requireNonEmptyString(body.email, 'email', 3, 320).toLowerCase();
    const name = optionalTrimmedString(body.name, 120);
    const phoneNumber = optionalTrimmedString(body.phoneNumber, 40);
    const requestedRole = body.role ? toProfileRole(String(body.role || '').trim()) : '';

    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    if (requestedRole && !['worker', 'user', 'basic'].includes(requestedRole)) {
      throw new HttpsError('invalid-argument', 'role must be worker, user, or basic');
    }
    if (auth.token?.email && String(auth.token.email).toLowerCase() !== email) {
      throw new HttpsError('permission-denied', 'Email does not match authenticated user');
    }

    const invitesRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('invites');
    const inviteQuery = await invitesRef.where('code', '==', inviteCode).limit(1).get();
    if (inviteQuery.empty) {
      throw new HttpsError('invalid-argument', 'Invalid invite code');
    }

    const inviteDocRef = inviteQuery.docs[0].ref;
    const workerRef = admin.firestore().doc(companyWorkerDocPath(companyId, auth.uid));
    const profileRef = admin.firestore().doc(userProfileDocPath(auth.uid));
    const companyCacheRef = admin.firestore().doc(`companies/${companyId}/business_data/cache`);

    const result = await admin.firestore().runTransaction(async (tx) => {
      const [inviteSnap, workerSnap, profileSnap] = await Promise.all([
        tx.get(inviteDocRef),
        tx.get(workerRef),
        tx.get(profileRef),
      ]);

      if (!inviteSnap.exists) {
        throw new HttpsError('invalid-argument', 'Invite code no longer exists');
      }

      const inviteData = inviteSnap.data() || {};
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const inviteExpiresAt = inviteData.expiresAt ? Date.parse(inviteData.expiresAt) : NaN;
      if (Number.isFinite(inviteExpiresAt) && inviteExpiresAt < now) {
        throw new HttpsError('failed-precondition', 'Invite code has expired');
      }

      const inviteUsedBy = String(inviteData.usedBy || '');
      const inviteStatus = String(inviteData.status || 'active');
      if (inviteStatus !== 'active' && inviteUsedBy !== auth.uid) {
        throw new HttpsError('failed-precondition', 'Invite code is not active');
      }
      if (inviteUsedBy && inviteUsedBy !== auth.uid) {
        throw new HttpsError('already-exists', 'Invite code was already used');
      }

      const resolvedRole = toProfileRole(
        workerSnap.exists
          ? workerSnap.data()?.role
          : (inviteData.targetRole || requestedRole || 'worker')
      );
      if (!['worker', 'user', 'basic'].includes(resolvedRole)) {
        throw new HttpsError('failed-precondition', 'Invite target role is invalid');
      }

      const isNewMembership = !workerSnap.exists;

      tx.set(inviteDocRef, {
        usedBy: auth.uid,
        usedAt: nowIso,
        status: 'used',
      }, { merge: true });

      tx.set(workerRef, {
        workerId: auth.uid,
        uid: auth.uid,
        email,
        role: resolvedRole,
        name,
        phoneNumber,
        Uid: auth.uid,
        createdAt: workerSnap.exists ? (workerSnap.data()?.createdAt || nowIso) : nowIso,
        updatedAt: nowIso,
      }, { merge: true });

      tx.set(profileRef, {
        uid: auth.uid,
        email,
        role: resolvedRole,
        companyId,
        accountType: 'business',
        name,
        phoneNumber,
        createdAt: profileSnap.exists ? (profileSnap.data()?.createdAt || nowIso) : nowIso,
        updatedAt: nowIso,
      }, { merge: true });

      if (isNewMembership) {
        tx.set(companyCacheRef, {
          workers: admin.firestore.FieldValue.increment(1),
          lastUpdated: nowIso,
        }, { merge: true });
      } else {
        tx.set(companyCacheRef, {
          lastUpdated: nowIso,
        }, { merge: true });
      }

      return { companyId, role: resolvedRole };
    });

    return sendHttpOk(res, result);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: requestUpgradeV1
 * Canonical privileged endpoint for upgrade request submission.
 */
exports.requestUpgradeV1 = onRequest({
  region: "us-central1",
  cors: true,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const requestedTier = requireNonEmptyString(body.requestedTier, 'requestedTier', 2, 32);
    const message = requireNonEmptyString(body.message, 'message', 10, 2000);
    const currentTier = optionalTrimmedString(body.currentTier, 32) || 'Basic';
    if (!['Solo', 'Team', 'Enterprise'].includes(requestedTier)) {
      throw new HttpsError('invalid-argument', 'requestedTier is invalid');
    }
    if (currentTier === requestedTier) {
      throw new HttpsError('invalid-argument', 'Requested tier must differ from current tier');
    }

    const profile = await getUserProfileOrThrow(auth.uid);
    const requestRef = admin.firestore().collection('upgrade_requests').doc();
    const nowIso = new Date().toISOString();
    await requestRef.set({
      uid: auth.uid,
      email: profile.email || auth.token?.email || null,
      companyId: profile.companyId || null,
      role: toProfileRole(profile.role || ''),
      currentTier,
      requestedTier,
      message,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'new',
    });

    return sendHttpOk(res, { requestId: requestRef.id }, 201);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: generateDocumentV1
 * @deprecated Legacy endpoint — use publishPreviewTask/publishGenerateTask (Pub/Sub) instead.
 * Restricted to manager/dev roles only for backward compatibility.
 */
exports.generateDocumentV1 = onRequest({
  region: "us-central1",
  cors: true,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const companyId = requireNonEmptyString(body.companyId, 'companyId', 3, 80);
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

    const certificationsRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('certifications');
    const taskRef = certificationsRef.doc();
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

/**
 * HTTP Function: contactRequestV1
 * Canonical endpoint for public contact submissions.
 * Rate-limited per IP (S6).
 * P1-2: Exempt from App Check (public endpoint).
 */
exports.contactRequestV1 = onRequest({
  region: "us-central1",
  cors: true,
  enforceAppCheck: false, // Public endpoint — no App Check required
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // S6: IP-based rate limiting
  const clientIp = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  if (isRateLimited(`contact_${clientIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const name = requireNonEmptyString(body.name, 'name', 2, 120);
    const email = requireNonEmptyString(body.email, 'email', 5, 320).toLowerCase();
    const company = requireNonEmptyString(body.company, 'company', 2, 140);
    const message = requireNonEmptyString(body.message, 'message', 8, 2000);

    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }

    const ref = admin.firestore().collection('contact_requests').doc();
    const nowIso = new Date().toISOString();
    await ref.set({
      name,
      email,
      company,
      message,
      status: 'new',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return sendHttpOk(res, { requestId: ref.id }, 201);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * Firestore Trigger: onJobAssignTrigger
 * Automatically sends push notification to worker when manager creates a job with status 'pending'
 * 
 * DEDUPLICATION: Uses notificationLog collection keyed by {jobId}_assigned
 * 
 * Triggered on: companies/{companyId}/PendingJobs/{jobId} document creation
 * Condition: status === 'pending' && completedBy exists (worker assignment)
 */
exports.onJobAssignTrigger = onDocumentCreated({
  document: 'companies/{companyId}/PendingJobs/{jobId}',
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

/**
 * Firestore Trigger: onJobSubmitTrigger
 * Automatically sends push notification to manager when worker submits a job (status changes to 'waiting')
 * 
 * DEDUPLICATION: Uses notificationLog collection keyed by {jobId}_submitted
 * 
 * Triggered on: companies/{companyId}/PendingJobs/{jobId} document update
 * Condition: status changed to 'waiting'
 */
exports.onJobSubmitTrigger = onDocumentUpdated({
  document: 'companies/{companyId}/PendingJobs/{jobId}',
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

// =============================================================================
// ISRAELI TAX AUTHORITY OAuth2 TOKEN MANAGEMENT
// =============================================================================

// OAuth2 Configuration for Israeli Tax Authority
const TAX_AUTHORITY_CONFIG = {
  authUrl: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
  tokenUrl: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
  clientId: process.env.TAX_CLIENT_ID || '',
  clientSecret: process.env.TAX_CLIENT_SECRET || '',
  scope: process.env.TAX_SCOPE || 'scope',
  callbackUrl: process.env.TAX_CALLBACK_URL || '',
  appScheme: process.env.APP_SCHEME || 'erpsystem',
};

function encodeBase64Url(input) {
  return Buffer.from(String(input), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAuthCallbackDeepLink(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return `${TAX_AUTHORITY_CONFIG.appScheme}://auth-callback?${query.toString()}`;
}

function generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError) {
  const safeDeepLink = escapeHtml(deepLink);
  const safeError = escapeHtml(tokenExchangeError || '');
  const statusText = tokenExchangeSuccess ? 'Authorization completed' : 'Authorization completed with warnings';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorization Complete</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
      .wrap { max-width: 640px; margin: 0 auto; }
      .ok { color: #166534; font-weight: 700; }
      .warn { color: #b45309; font-weight: 700; }
      a { color: #1d4ed8; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h2>${tokenExchangeSuccess ? '<span class="ok">Success</span>' : '<span class="warn">Completed</span>'}</h2>
      <p>${escapeHtml(statusText)}</p>
      ${safeError ? `<p><strong>Details:</strong> ${safeError}</p>` : ''}
      <p><a href="${safeDeepLink}">Return to app</a></p>
      <p>If the app does not open automatically, use this link:</p>
      <p><code>${safeDeepLink}</code></p>
      <script>
        setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 300);
      </script>
    </div>
  </body>
</html>`;
}

function ensureTaxAuthorityConfigForCallable() {
  if (!TAX_AUTHORITY_CONFIG.clientId || !TAX_AUTHORITY_CONFIG.clientSecret || !TAX_AUTHORITY_CONFIG.callbackUrl) {
    throw new HttpsError(
      'failed-precondition',
      'Tax Authority OAuth is not configured on the server.'
    );
  }
}

/**
 * Cloud Function: Start Tax Authority Authorization
 * Called by the app when user clicks "Grant Permission"
 * Returns the authorization URL for the user to visit
 * 
 * @returns {Object} { success, authorizationUrl }
 */
exports.startTaxAuthorityAuth = onCall({
  region: "us-central1",
}, async (request) => {
  try {
    ensureTaxAuthorityConfigForCallable();

    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('startTaxAuthorityAuth called', { uid });

    // Verify user is a manager
    const userProfileRef = admin.firestore().doc(userProfileDocPath(uid));
    const userProfile = await userProfileRef.get();

    if (!userProfile.exists) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    const userData = userProfile.data();
    if (normalizeRole(userData.role) !== 'manager') {
      throw new HttpsError('permission-denied', 'Only managers can authorize Tax Authority access');
    }

    const companyId = userData.companyId;
    if (!companyId) {
      throw new HttpsError('failed-precondition', 'User has no company assigned');
    }

    // Store pending authorization in Firestore to track which company initiated the flow
    const pendingAuthRef = admin.firestore().collection('taxAuthPending').doc();
    const authId = pendingAuthRef.id;
    const stateNonce = crypto.randomBytes(16).toString('hex');
    const oauthState = encodeBase64Url(`${authId}.${stateNonce}`);
    
    await pendingAuthRef.set({
      authId: authId,
      companyId: companyId,
      uid: uid,
      email: request.auth.token.email,
      state: oauthState,
      stateNonce: stateNonce,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMillis: Date.now(),
      status: 'pending',
      expiresAt: Date.now() + (10 * 60 * 1000), // Expires in 10 minutes
    });

    logger.info('Starting Tax Authority OAuth flow', {
      authId: authId,
      companyId: companyId,
      uid: uid,
      callbackUrl: TAX_AUTHORITY_CONFIG.callbackUrl,
    });

    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: TAX_AUTHORITY_CONFIG.clientId,
      scope: TAX_AUTHORITY_CONFIG.scope,
      redirect_uri: TAX_AUTHORITY_CONFIG.callbackUrl,
      state: oauthState,
    });

    const authorizationUrl = `${TAX_AUTHORITY_CONFIG.authUrl}?${authParams.toString()}`;

    logger.info('Generated authorization URL', { 
      authId: authId,
      uid, 
      companyId,
      callbackUrl: TAX_AUTHORITY_CONFIG.callbackUrl
    });

    return {
      success: true,
      authorizationUrl: authorizationUrl,
    };

  } catch (error) {
    logger.error('Error in startTaxAuthorityAuth:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to start authorization: ${error.message}`);
  }
});

/**
 * HTTP Cloud Function: Tax Authority OAuth Callback
 * This is the redirect_uri that Tax Authority will call after user login
 * Simply receives the authorization code and saves it to Firestore
 */
exports.taxAuthorityCallback = onRequest({
  region: "me-west1",
  cors: true,
  timeoutSeconds: 30,
  memory: "512MiB",
}, async (req, res) => {
  res.set('Cache-Control', 'private, max-age=0');
  
  try {
    if (!TAX_AUTHORITY_CONFIG.clientId || !TAX_AUTHORITY_CONFIG.clientSecret || !TAX_AUTHORITY_CONFIG.callbackUrl) {
      const notConfiguredLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Tax Authority OAuth is not configured on server.'
      });
      return res.send(generateSuccessHTML(notConfiguredLink, false, 'Server OAuth configuration missing'));
    }

    const { code, error, error_description, state } = req.query;

    // Handle OAuth errors from Tax Authority
    if (error) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: error_description || error,
      });
      return res.send(generateSuccessHTML(deepLink, false, error_description || error));
    }

    if (!code || !state) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Missing authorization code or state'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Missing authorization code or state'));
    }

    let authId;
    try {
      const decodedState = decodeBase64Url(state);
      authId = String(decodedState || '').split('.')[0];
      if (!authId || !/^[A-Za-z0-9_-]{10,}$/.test(authId)) {
        throw new Error('Invalid auth session id');
      }
    } catch (decodeError) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Invalid authorization state'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Invalid authorization state'));
    }

    const pendingAuthRef = admin.firestore().doc(`taxAuthPending/${authId}`);
    const pendingAuthSnap = await pendingAuthRef.get();
    if (!pendingAuthSnap.exists) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session not found or expired'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session not found or expired'));
    }

    const pendingAuthData = pendingAuthSnap.data() || {};
    if (pendingAuthData.state !== state) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization state mismatch'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization state mismatch'));
    }
    if (pendingAuthData.status !== 'pending') {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session already used'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session already used'));
    }
    if (pendingAuthData.expiresAt && Date.now() > pendingAuthData.expiresAt) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session expired'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session expired'));
    }

    const callbackRecordRef = admin.firestore().doc(`taxAuthCallbacks/${authId}`);
    const existingCallback = await callbackRecordRef.get();
    if (existingCallback.exists && existingCallback.data()?.used) {
      const existingData = existingCallback.data();
      const deepLink = buildAuthCallbackDeepLink({
        success: true,
        callbackId: callbackRecordRef.id,
        tokenExchanged: existingData.tokenExchangeSuccess || false
      });
      return res.send(generateSuccessHTML(deepLink, existingData.tokenExchangeSuccess || false, existingData.tokenExchangeError || null));
    }

    const receivedAtMillis = Date.now();
    await callbackRecordRef.set({
      authId,
      companyId: pendingAuthData.companyId || null,
      uid: pendingAuthData.uid || null,
      state,
      code: code,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      receivedAtMillis,
      used: false,
      codeLength: code.length,
    }, { merge: true });

    // IMMEDIATELY exchange the code for tokens while it's fresh
    let tokenExchangeSuccess = false;
    let tokenExchangeError = null;
    const companyId = pendingAuthData.companyId || null;

    try {
      await pendingAuthRef.update({
        status: 'used',
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Exchange authorization code for tokens (axios-retry handles retries automatically)
      const tokenResponse = await axios.post(
        TAX_AUTHORITY_CONFIG.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: TAX_AUTHORITY_CONFIG.callbackUrl,
          scope: TAX_AUTHORITY_CONFIG.scope,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(
              TAX_AUTHORITY_CONFIG.clientId + ':' + TAX_AUTHORITY_CONFIG.clientSecret
            ).toString('base64'),
          },
          timeout: 20000,
        }
      );

      const tokenData = tokenResponse.data;

      // Calculate token expiration timestamps using actual API response values
      const now = Date.now();
      const accessTokenExpiresAt = now + (tokenData.expires_in * 1000);
      // Use actual refresh_token_expires_in from response (not hardcoded 90 days)
      const refreshTokenExpiresAt = tokenData.refresh_token_expires_in 
        ? now + (tokenData.refresh_token_expires_in * 1000)
        : now + (90 * 24 * 60 * 60 * 1000); // Fallback to 90 days if not provided

      // Save tokens directly to company settings in Firebase (if company known)
      if (companyId) {
        const companySettingsRef = admin.firestore().doc(`companies/${companyId}/business_data/token`);
        await companySettingsRef.set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          accessTokenExpiresAt: accessTokenExpiresAt,
          refreshTokenExpiresAt: refreshTokenExpiresAt,
          authorizedAt: admin.firestore.FieldValue.serverTimestamp(),
          callbackId: callbackRecordRef.id,
        }, { merge: true });

        // Save audit log
        await saveAuditLog(companyId, 'taxAuthorityAuthorized', 'system_callback');
      }

      await callbackRecordRef.update({
        used: true,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        tokenExchangeSuccess: true,
        companyId,
        expiresIn: tokenData.expires_in,
        accessTokenExpiresAt: accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
      });

      tokenExchangeSuccess = true;

    } catch (exchangeError) {
      tokenExchangeError = exchangeError.response?.data?.error_description || 
                          exchangeError.response?.data?.error || 
                          exchangeError.message;

      // Save error info to callback record
      await callbackRecordRef.update({
        tokenExchangeSuccess: false,
        tokenExchangeError: tokenExchangeError,
        tokenExchangeAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Return success HTML page with deep link and instructions
    const deepLink = buildAuthCallbackDeepLink({
      success: true,
      callbackId: callbackRecordRef.id,
      tokenExchanged: tokenExchangeSuccess
    });
    
    return res.send(generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError));

  } catch (error) {
    logger.error('Error in taxAuthorityCallback:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Return error HTML page
    const errorMessage = error.message || 'Failed to process authorization';
    const deepLink = buildAuthCallbackDeepLink({
      success: false,
      error: errorMessage
    });
    
    return res.send(generateSuccessHTML(deepLink, false, errorMessage));
  }
});


/**
 * Cloud Function: Submit Invoice to Tax Authority for Approval
 * CRITICAL: This function now handles the FIRST step in invoice generation:
 * 1. Accepts full document data (client, items, company, etc.)
 * 2. Saves document metadata to Firestore BEFORE Tax Authority submission
 * 3. Submits invoice to Israeli Tax Authority API for approval
 * 4. Returns documentId and approval status
 * 5. Frontend then calls generateDocument with documentId if approved
 * 
 * @param {Object} request.data - Full document data
 * @param {string} request.data.type - Document type (should be 'taxInvoice')
 * @param {Object} request.data.client - Client details {name, email, phone, address, id}
 * @param {Array} request.data.items - Invoice items [{description, quantity, price}]
 * @param {Object} request.data.company - Company details {name, email, phone, address, vatNumber, etc.}
 * @param {string} request.data.companyId - Company name for Firestore path
 * @param {Object} request.data.businessInfo - Business registration data {vat_number, document_numbers, etc.}
 * @param {string} request.data.language - Language (he, en, ar)
 * @param {string} request.data.date - Invoice date YYYY-MM-DD
 * @param {string} request.data.notes - Optional notes
 * @param {Object} request.data.jobData - Optional job reference data
 * 
 * @returns {Object} { success, documentId, status, message, confirmation_number, approved, savedPath, metadata }
 */
/**
 * Helper function to generate next document number
 * Fetches the last document number from business registration and increments it
 */

exports.getInvoiceApproval = onCall({
  region: "me-west1",
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (request) => {
  const startTime = Date.now();
  
  try {
    // Log authentication status immediately
    logger.info('getInvoiceApproval called', {
      hasAuth: !!request.auth,
      authUid: request.auth?.uid,
      timestamp: new Date().toISOString()
    });

    if (!request.auth) {
      logger.error('Authentication missing', {
        hasRequest: !!request,
        requestKeys: Object.keys(request)
      });
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    ensureTaxAuthorityConfigForCallable();

    const uid = request.auth.uid;
    logger.info('Processing invoice for user', { uid });

    const {
      type, client, items, company, companyId,
      language, date, notes, jobData, jobsData, priceProposalId
    } = request.data || {};

    if (!companyId) {
      throw new HttpsError('invalid-argument', 'Company ID is required for Firestore');
    }

    const { userData, role } = await getAuthenticatedUserProfile(request.auth, {
      allowedRoles: ['manager', 'user'],
      requireCompany: true,
      companyId,
    });

    logger.info('User authorized for invoice approval', { uid, role, companyId });

    // Validate required fields for document
    // Accept both numeric type (305) or string 'taxInvoice' for backwards compatibility
    const numericType = typeof type === 'number' ? type : (type === 'taxInvoice' ? DOC_TYPE.TAX_INVOICE : Number(type));
    if (!type || numericType !== DOC_TYPE.TAX_INVOICE) {
      throw new HttpsError('invalid-argument', 'Document type must be taxInvoice (305)');
    }
    if (!client || !client.name) {
      throw new HttpsError('invalid-argument', 'Client name is required');
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one item is required');
    }
    if (!company || !company.name) {
      throw new HttpsError('invalid-argument', 'Company ID is required');
    }

    // Always fetch business info from Firestore (never trust frontend cache for security)
    let businessInfo;
    const businessRegRef = admin.firestore().doc(`companies/${companyId}/business_data/business_info`);
    const businessRegDoc = await businessRegRef.get();
    if (!businessRegDoc.exists) {
      throw new HttpsError('not-found', 'Business registration not found. Please register your business first.');
    }
    businessInfo = businessRegDoc.data();
    
    if (!businessInfo.vat_number) {
      throw new HttpsError('invalid-argument', 'Missing VAT number in business registration. Please complete your business registration.');
    }

    // Verify companyId strictly matches user's company
    if (!userData.companyId || userData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Company name mismatch');
    }

    // Generate next document number and build document ID using date-number-type format
    const documentNumber = businessInfo.document_numbers[305];
    const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const documentId = `TI${documentNumber}-${companyId}`; // e.g., "TI1-4" - using companyId for uniqueness across companies

    logger.info('Preparing Tax Authority submission', {
      documentId,
      companyId,
      itemCount: items.length,
      clientName: client.name,
      documentNumber,
    });

    // Calculate totals for Tax Authority
    let totalBeforeVat = 0;
    items.forEach(item => {
      const itemTotal = (item.quantity || 1) * (item.price || 0);
      totalBeforeVat += itemTotal;
    });
    const vatAmount = totalBeforeVat * 0.18;
    const totalWithVat = totalBeforeVat + vatAmount;

    // Get access token from Firestore
    const tokenRef = admin.firestore().doc(`companies/${companyId}/business_data/token`);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists || !tokenDoc.data().accessToken) {
      throw new HttpsError('failed-precondition', 'No access token found. Please authorize with Tax Authority first.');
    }

    const tokenData = tokenDoc.data();
    let accessToken = tokenData.accessToken;
    let accessTokenExpiresAt = tokenData.accessTokenExpiresAt;
    const refreshToken = tokenData.refreshToken;

    // Check if token is expired (with 5-minute buffer) and auto-refresh if needed
    const isTokenExpired = Date.now() + (5 * 60 * 1000) >= accessTokenExpiresAt;
    
    if (isTokenExpired) {
      logger.info('Access token expired, automatically refreshing...', { 
        companyId,
        expiresAt: new Date(accessTokenExpiresAt).toISOString()
      });

      if (!refreshToken) {
        throw new HttpsError('failed-precondition', 'Access token expired and no refresh token available. Please re-authorize with Tax Authority.');
      }

      // Check if refresh token is expired
      if (tokenData.refreshTokenExpiresAt && Date.now() > tokenData.refreshTokenExpiresAt) {
        throw new HttpsError('failed-precondition', 'Refresh token expired. Please re-authorize with Tax Authority.');
      }

      try {
        // Refresh access token using axios (axios-retry handles retries automatically)
        logger.info('Sending token refresh request...');
        const tokenRefreshStartTime = Date.now();
        
        const tokenResponse = await axios.post(
          TAX_AUTHORITY_CONFIG.tokenUrl,
          new URLSearchParams({
            client_id: TAX_AUTHORITY_CONFIG.clientId,
            scope: TAX_AUTHORITY_CONFIG.scope,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_secret: TAX_AUTHORITY_CONFIG.clientSecret,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          }
        );

        const newTokenData = tokenResponse.data;
        const tokenRefreshTime = Date.now() - tokenRefreshStartTime;
        
        logger.info('Token refresh successful', { 
          hasAccessToken: !!newTokenData.access_token,
          hasNewRefreshToken: !!newTokenData.refresh_token,
          expiresIn: newTokenData.expires_in,
          refreshTime: tokenRefreshTime
        });

        // Calculate new expiration timestamp
        const now = Date.now();
        accessTokenExpiresAt = now + (newTokenData.expires_in * 1000);
        accessToken = newTokenData.access_token;

        // Update tokens in Firestore
        const updateData = {
          accessToken: newTokenData.access_token,
          accessTokenExpiresAt: accessTokenExpiresAt,
          lastRefreshedBy: request.auth.token.email,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          autoRefreshedDuringInvoiceSubmission: true,
        };

        // If a new refresh token is provided, update it with actual expiration time
        if (newTokenData.refresh_token) {
          updateData.refreshToken = newTokenData.refresh_token;
          updateData.refreshTokenExpiresAt = newTokenData.refresh_token_expires_in
            ? now + (newTokenData.refresh_token_expires_in * 1000)
            : now + (90 * 24 * 60 * 60 * 1000); // Fallback to 90 days
        }

        await tokenRef.update(updateData);

        logger.info('Tokens updated in Firestore after auto-refresh', { 
          companyId,
          newExpiresAt: new Date(accessTokenExpiresAt).toISOString()
        });

        // Save audit log for auto-refresh
        await saveAuditLog(companyId, 'taxAuthorityTokenAutoRefreshed', request.auth.uid);

      } catch (refreshError) {
        logger.error('Failed to auto-refresh access token', {
          error: refreshError.message,
          status: refreshError.response?.status,
          responseData: refreshError.response?.data
        });

        // Handle refresh token errors
        if (refreshError.response) {
          const status = refreshError.response.status;
          const errorData = refreshError.response.data;
          
          // If refresh token is invalid, clear the stored tokens
          if (status === 400 || status === 401) {
            logger.warn('Refresh token invalid, clearing stored tokens', { companyId });
            await tokenRef.update({
              accessToken: admin.firestore.FieldValue.delete(),
              refreshToken: admin.firestore.FieldValue.delete(),
              accessTokenExpiresAt: admin.firestore.FieldValue.delete(),
              refreshTokenExpiresAt: admin.firestore.FieldValue.delete(),
              tokenInvalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
              tokenInvalidatedReason: 'refresh_failed_during_auto_refresh',
            });
            
            throw new HttpsError(
              'failed-precondition',
              'Refresh token is invalid or expired. Please re-authorize with Tax Authority.',
              { originalError: errorData?.error_description || errorData?.error }
            );
          }
          
          throw new HttpsError(
            'internal',
            `Failed to auto-refresh token: ${errorData?.error_description || errorData?.error || 'Unknown error'}`,
            { status, errorData }
          );
        }
        
        throw new HttpsError(
          'internal',
          `Failed to auto-refresh access token: ${refreshError.message}`
        );
      }
    } else {
      logger.info('Access token is valid, proceeding with invoice submission', {
        companyId,
        expiresAt: new Date(accessTokenExpiresAt).toISOString(),
        timeUntilExpiry: Math.round((accessTokenExpiresAt - Date.now()) / 1000 / 60) + ' minutes'
      });
    }

    // Generate timestamp for accounting software fields
    const timestamp = Date.now();
    
    const accountingSoftwareNumber = parseInt(timestamp.toString().substring(0, 9)); // First 9 digits as integer
    const clientSoftwareKey = timestamp.toString().substring(0, 5); // First 5 digits as string
    
    logger.info('Building Tax Authority request', {
      businessVatNumber: businessInfo.vat_number,
      documentId,
      accountingSoftwareNumber,
      clientSoftwareKey,
      todayDate
    });
    
    // Build request in EXACT order as API example to avoid validation issues
    const taxAuthorityData = {
      invoice_id: documentId,
      invoice_type: 305, // 305 = Tax invoice (חשבונית מס)
      vat_number: businessInfo.vat_number ,
      //user_id: 15, // REQUIRED: User ID in Tax Authority system (use fixed test value for sandbox)
      user_name: userData.name || userData.email || uid, // Use display name, fallback to email/UID
      invoice_reference_number: documentNumber,
    };

    // CRITICAL: Only add customer_vat_number and customer_name if customer is a business
    // For normal customers, these fields should NOT be included at all (not even as null)
    if (client.clientVatNumber) {
      // Customer is a business - include both customer_vat_number and customer_name
      const customerVatNumber = parseInt(client.clientVatNumber);
      if (!isNaN(customerVatNumber)) {
        taxAuthorityData.customer_vat_number = customerVatNumber;
        taxAuthorityData.customer_name = client.customerName || client.name;
      }
      else{
        taxAuthorityData.customer_vat_number = 777777715; // Use generic number if invalid
        taxAuthorityData.customer_name = client.customerName || client.name;
      }
    }
    // For normal customers, customer_name and customer_vat_number are NOT included

    // Continue building in exact order
    taxAuthorityData.invoice_date = todayDate;
    taxAuthorityData.invoice_issuance_date = todayDate;
    taxAuthorityData.accounting_software_number = accountingSoftwareNumber; // REQUIRED: Integer from timestamp
    taxAuthorityData.client_software_key = clientSoftwareKey; // REQUIRED: Numeric string from timestamp
    taxAuthorityData.amount_before_discount = Math.round(totalBeforeVat * 100) / 100;
    taxAuthorityData.discount = 0;
    taxAuthorityData.payment_amount = Math.round(totalBeforeVat * 100) / 100;
    taxAuthorityData.vat_amount = Math.round(vatAmount * 100) / 100;
    taxAuthorityData.payment_amount_including_vat = Math.round(totalWithVat * 100) / 100;

    // Add invoice_note if available (must be before action)
    if (notes && notes.trim()) {
      taxAuthorityData.invoice_note = notes.trim();
    }

    taxAuthorityData.action = 0;
    
    // Build items array in exact field order
    taxAuthorityData.items = items.map((item, idx) => {
      const quantity = item.quantity || 1;
      const pricePerUnit = item.price;
      const totalAmount = Math.round(quantity * pricePerUnit * 100) / 100;
      const vatRate = 18;
      const itemVatAmount = Math.round(totalAmount * (vatRate / 100) * 100) / 100;
      
      // Category must be 5-digit code: 00001-00014 or 99999 (miscellaneous)
      // Default to 99999 (שונות - miscellaneous) for general items
      const categoryCode = item.category || 1;
      
      return {
        index: idx + 1,
        category: categoryCode, // 5-digit code: 00001-00014 specific categories, 99999 = miscellaneous
        description: item.description,
        measure_unit_description: "יח'", // Units
        quantity: quantity,
        price_per_unit: pricePerUnit,
        discount: 0,
        total_amount: totalAmount,
        vat_rate: vatRate,
        vat_amount: itemVatAmount
      };
    });

    // Validate Tax Authority data
    const requiredFields = [
      'invoice_id', 'invoice_type', 'vat_number', 'invoice_reference_number',
      'invoice_date', 'invoice_issuance_date',
      'amount_before_discount', 'payment_amount', 'vat_amount',
      'payment_amount_including_vat'
    ];

    for (const field of requiredFields) {
      if (taxAuthorityData[field] === undefined || taxAuthorityData[field] === null) {
        throw new HttpsError('invalid-argument', `Missing required field for Tax Authority: ${field}`);
      }
    }

    logger.info('Submitting invoice to Tax Authority', {
      companyId,
      documentId,
      invoiceId: taxAuthorityData.invoice_id,
      itemCount: taxAuthorityData.items.length,
      totalAmount: taxAuthorityData.payment_amount_including_vat
    });

    // Make the API request to Tax Authority (axios-retry handles retries automatically)
    const apiStartTime = Date.now();
    
    let response;
    try {
      response = await axios.post(
        'https://openapi.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval',
        taxAuthorityData, // JSON body - axios automatically stringifies
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          timeout: 30000, // 30 second timeout
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors - handle them below
          // Uses global retry config (exponential backoff, 5xx and network errors only)
        }
      );
    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      logger.error('Tax Authority API request failed after retries', {
        error: error.message,
        code: error.code,
        status: error.response?.status,
        responseKeys: error.response?.data ? Object.keys(error.response.data) : [],
        totalTime
      });
      
      throw new HttpsError(
        'internal',
        `Failed to submit invoice after retries: ${error.message}`,
        {
          status: error.response?.status
        }
      );
    }

    const apiTime = Date.now() - apiStartTime;
    const totalTime = Date.now() - startTime;

    logger.info('Tax Authority API response', {
      status: response.status,
      statusText: response.statusText,
      apiTime,
      totalTime,
      responseKeys: response.data ? Object.keys(response.data) : []
    });

    // Handle 400, 406, and 422 errors with error message from response
    if (response.status === 400 || response.status === 406 || response.status === 422) {
      const errorMessage = response.data?.message || 
                          response.data?.error || 
                          response.data?.error_description ||
                          (response.status === 400 ? 'Invalid request data' : 
                           response.status === 422 ? 'Tax Authority validation failed - please check invoice data' : 
                           'Request not acceptable');
      
      logger.warn('Tax Authority rejected invoice with validation error', {
        status: response.status,
        errorMessage,
        invoiceId: documentId
      });
      
      throw new HttpsError(
        'failed-precondition',
        `${errorMessage} (Status: ${response.status})${response.data?.errors ? '\nErrors: ' + JSON.stringify(response.data.errors) : ''}`,
        {
          status: response.status,
          invoice_id: documentId
        }
      );
    }

    // Handle other non-2xx responses
    if (response.status < 200 || response.status >= 300) {
      const errorMessage = response.data?.message || 
                          response.data?.error || 
                          'Unexpected response from Tax Authority';
      
      logger.error('Tax Authority returned error status', {
        status: response.status,
        errorMessage,
        responseKeys: response.data ? Object.keys(response.data) : []
      });
      
      throw new HttpsError(
        'internal',
        `Tax Authority error (${response.status}): ${errorMessage}`,
        {
          status: response.status,
          responseData: response.data
        }
      );
    }

    // Check if approved - handle various response formats
    const isApproved = response.data?.approved === true || 
                       response.data?.status === 'approved' ||
                       response.data?.approval_status === 'approved';
    const confirmationNumber = response.data?.confirmation_number || 
                              response.data?.confirmationNumber ||
                              response.data?.approval_number;

    // CRITICAL: Only save to Firestore if Tax Authority APPROVED
    if (!isApproved) {
      logger.warn('Tax Authority rejected invoice - NOT saving to Firestore', {
        documentId,
        documentNumber,
        clientName: client.name,
        status: response.status,
        responseData: response.data,
        responseDataKeys: response.data ? Object.keys(response.data) : [],
        checkedFields: {
          approved: response.data?.approved,
          status: response.data?.status,
          approval_status: response.data?.approval_status
        }
      });

      const rejectionMessage = response.data?.message || 
                              response.data?.error || 
                              response.data?.error_description ||
                              'Tax Authority did not approve the invoice. Please check invoice details and try again.';

      throw new HttpsError(
        'failed-precondition',
        rejectionMessage,
        {
          approved: false,
          status: response.status,
          responseData: response.data,
          documentNumber: documentNumber,
          clientName: client.name
        }
      );
    }

    // Tax Authority APPROVED - Now save document to Firestore with confirmation number
    logger.info('Tax Authority approved! Saving document to Firestore', {
      documentId,
      confirmationNumber,
      documentNumber
    });

    const certificationRef = admin.firestore().doc(`companies/${companyId}/certifications/c_${documentId}`);
    const certificationData = {
      type: DOC_TYPE.TAX_INVOICE, // Store numeric type (305)
      documentNumber: documentNumber, // Use the date-number-type format
      clientName: client.name,
      clientEmail: client.email || null,
      clientPhone: client.phone || null,
      clientAddress: client.address || null,
      clientId: client.id || null,
      clientVatNumber: client.clientVatNumber || null, // Store customer VAT if business customer
      date: date || todayDate,
      items: items,
      language: language || 'he',
      notes: notes || null,
      createdBy: uid,
      createdAt: new Date().toISOString(),
      jobData: jobData || null,
      jobsData: jobsData || null, // Multi-job references
      priceProposalId: priceProposalId || null, // Price proposal used
      itemCount: items.length,
      totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      totalWithVat: Math.round(totalWithVat * 100) / 100,
      // Tax Authority approval data
      taxAuthoritySubmittedAt: new Date().toISOString(),
      taxAuthorityResponseData: response.data,
    };
    try {
      await certificationRef.set(certificationData);
      logger.info('Document saved to Firestore with approval', {
        documentId,
        path: `companies/${companyId}/certifications/${toCertificationDocId(documentId)}`,
        confirmationNumber
      });

      // CRITICAL: Update finishedJobs documents to mark them as having a tax invoice (isCert = true)
      // Supports both single job (legacy jobData) and multi-job (jobsData) flows
      const allJobRefs = [];
      
      // Collect all job IDs to update
      if (jobsData && Array.isArray(jobsData) && jobsData.length > 0) {
        // Multi-job flow: mark all selected jobs
        jobsData.forEach(jd => {
          if (jd && jd.jobId) {
            allJobRefs.push(jd.jobId);
          }
        });
      } else if (jobData && jobData.jobId) {
        // Legacy single-job flow
        allJobRefs.push(jobData.jobId);
      }
      
      if (allJobRefs.length > 0) {
        // Use batched write to update all jobs + price proposal + cache in one go
        const batch = admin.firestore().batch();
        const cacheUpdates = {};
        for (const jobId of allJobRefs) {
          const finishedJobPath = `companies/${companyId}/finishedJobs/${jobId}`;
          try {
            const finishedJobRef = admin.firestore().doc(finishedJobPath);
            batch.update(finishedJobRef, {
              isCert: true,
              certificationId: documentId,
              certificationCreatedAt: new Date().toISOString()
            });
            logger.info('Queued finishedJob update isCert=true', { jobId, documentId });
            cacheUpdates.jobID = admin.firestore.FieldValue.increment(1); // Increment jobID cache for manager
          } catch (jobUpdateError) {
            logger.error('Failed to queue finishedJob update', {
              error: jobUpdateError.message,
              jobId
            });
          }
        }
        
        // Mark price proposal as used if provided
        if (priceProposalId) {
          try {
            const proposalRef = admin.firestore().doc(`companies/${companyId}/certifications/${toCertificationDocId(priceProposalId)}`);
            batch.update(proposalRef, {
              isUsed: true,
              usedByDocumentId: documentId,
              usedAt: new Date().toISOString()
            });
            logger.info('Queued price proposal update isUsed=true', { priceProposalId, documentId });
            cacheUpdates.priceProposalId = admin.firestore.FieldValue.increment(1); // Increment price proposal cache for manager
          } catch (proposalError) {
            logger.error('Failed to queue price proposal update', {
              error: proposalError.message,
              priceProposalId
            });
          }
        }
        
        // Determine cache path based on user role
        const isManager = role === 'manager';
        const cachePath = isManager ? `companies/${companyId}/business_data/cache` : userCacheDocPath(uid);
        const cacheRef = admin.firestore().doc(cachePath);
        batch.update(cacheRef, {
          ...cacheUpdates,
          lastUpdated: new Date().toISOString()
        });
        logger.info('Queued cache update', { cachePath, cacheUpdates });
        
        // Commit all updates in one batch
        try {
          await batch.commit();
          logger.info('Batch committed: jobs isCert, proposal isUsed, cache increments', {
            jobCount: allJobRefs.length,
            priceProposalMarked: !!priceProposalId,
            documentId
          });
        } catch (batchError) {
          logger.error('Batch commit failed', {
            error: batchError.message,
            jobIds: allJobRefs,
            priceProposalId
          });
        }
      }

    } catch (firestoreError) {
      logger.error('Failed to save approved document to Firestore', {
        error: firestoreError.message,
        documentId,
        confirmationNumber
      });
      throw new HttpsError('internal', `Invoice approved but failed to save: ${firestoreError.message}`);
    }

    // Increment document counter
    if (businessInfo.document_numbers) {
      try {
        const businessInfoRef = admin.firestore().doc(`companies/${companyId}/business_data/business_info`);
        await businessInfoRef.update({
          'document_numbers.305': admin.firestore.FieldValue.increment(1),
          last_updated: new Date().toISOString()
        });
        const businessCacheRef = admin.firestore().doc(`companies/${companyId}/business_data/cache`);
        await businessCacheRef.update({
          business_info: admin.firestore.FieldValue.increment(1),
          lastUpdated: new Date().toISOString()
        });
        logger.info('Tax invoice counter incremented', {
          documentNumber,
          newNumber: businessInfo.document_numbers[305] + 1
        });
      } catch (counterError) {
        logger.error('Failed to increment invoice counter', { error: counterError.message });
      }
    }

    // Save audit log for Tax Authority submission
    await saveAuditLog(
      companyId,
      'submitInvoiceToTaxAuthority',
      request.auth.token.email,
      documentId,
      DOC_TYPE.TAX_INVOICE
    );

    // ============================================================================
    // STEP 2: Publish PDF generation task to Pub/Sub (instead of generating inline)
    // This allows Cloud Run workers to handle PDF generation asynchronously
    // Uses shared helper function for consistency with publishGenerateTask
    // ============================================================================
    logger.info('Publishing PDF generation task to Pub/Sub for approved tax invoice', { documentId });
    
    let pdfTaskPublished = false;
    let taskId = null;
    
    try {
      // Build company data from business info for the PDF generation task
      const companyData = {
        name: businessInfo.he_name || businessInfo.en_name || businessInfo.business_name || companyId,
        nameHe: businessInfo.he_name || '',
        nameEn: businessInfo.en_name || '',
        email: businessInfo.business_email || businessInfo.email || '',
        phone: businessInfo.business_phone || businessInfo.phone || '',
        fax: businessInfo.business_fax || '',
        address: businessInfo.address || '',
        city: businessInfo.city || '',
        vatNumber: businessInfo.vat_number || '',
        businessType: businessInfo.business_type || '',
      };

      // Build client data for PDF
      const clientDataForPDF = {
        name: client.name,
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || '',
        id: client.id || ''
      };

      // Prepare complete document data
      const completeDocumentData = {
        type: DOC_TYPE.TAX_INVOICE, // Store numeric type (305)
        client: clientDataForPDF,
        items: items,
        company: companyData,
        language: language || 'he',
        documentNumber: documentNumber,
        date: date || todayDate,
        notes: notes,
        jobData: jobData || null,
        jobsData: jobsData || null, // Multi-job references
        priceProposalId: priceProposalId || null,
        taxAuthorityConfirmationNumber: confirmationNumber,
        totals: {
          totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          totalWithVat: Math.round(totalWithVat * 100) / 100,
        },
      };

      // Use shared helper to publish task
      const result = await publishGenerateTaskHelper({
        documentType: DOC_TYPE.TAX_INVOICE,
        documentId: documentId,
        documentNumber: documentNumber,
        completeDocumentData: completeDocumentData,
        certificationData: certificationData,
        uid: uid,
        companyId: companyId,
        createdByUid: request.auth.uid,
        userRole: role,
      });

      pdfTaskPublished = true;
      taskId = result.taskId;
      
      logger.info('PDF generation task published to Pub/Sub via helper', { 
        taskId, 
        messageId: result.messageId, 
        documentId,
        companyId 
      });

    } catch (pubsubError) {
      logger.error('Failed to publish PDF generation task to Pub/Sub', {
        error: pubsubError.message,
        documentId,
        confirmationNumber
      });
      
      // PDF task publishing failed, but document is saved and approved
      // This is non-critical - PDF can be regenerated later
      pdfTaskPublished = false;
    }

    const finalTotalTime = Date.now() - startTime;

    return {
      success: true,
      documentId: documentId,
      savedPath: `companies/${companyId}/certifications/${toCertificationDocId(documentId)}`,
      status: response.status,
      message: response.data?.message || 'Invoice approved and saved successfully',
      confirmation_number: confirmationNumber,
      approved: true,
      responseData: response.data,
      // PDF generation is now async via Pub/Sub
      pdfGenerated: false, // PDF not generated yet - will be done async
      pdfTaskPublished: pdfTaskPublished,
      pdfTaskId: taskId,
      downloadURL: null, // Will be populated when PDF generation completes
      metadata: {
        submittedAt: new Date().toISOString(),
        apiTime,
        totalTime: finalTotalTime,
        documentNumber,
        clientName: client.name,
        totalWithVat: Math.round(totalWithVat * 100) / 100
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    // Handle axios errors
    if (error.response) {
      // API returned an error response
      logger.error('Tax Authority API error response', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        duration: totalTime
      });
      
      throw new HttpsError(
        'failed-precondition',
        `Tax Authority API error: ${error.response.data?.message || error.response.statusText}`,
        {
          status: error.response.status,
          apiError: error.response.data
        }
      );
    } else if (error.request) {
      // Request made but no response
      logger.error('Tax Authority API no response', {
        error: error.message,
        duration: totalTime
      });
      
      throw new HttpsError(
        'unavailable',
        'Tax Authority API did not respond. Please try again later.'
      );
    } else if (error instanceof HttpsError) {
      // Re-throw HttpsError
      throw error;
    } else {
      // Other errors
      logger.error('Error in getInvoiceApproval', {
        error: error.message,
        stack: error.stack,
        duration: totalTime
      });
      
      throw new HttpsError('internal', `Failed to submit invoice: ${error.message}`);
    }
  }
});
// =============================================================================
// CLOUD RUN + PUB/SUB DOCUMENT GENERATION SYSTEM
// =============================================================================

/**
 * Helper function to clear company busy flag
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
 * @param {Object} params.certificationData - Certification data (for taxInvoice)
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
  certificationData,
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
      certificationData: certificationData,  // Existing cert data for taxInvoice
      userRole: userRole || null,
      // Pass confirmation number at top level for easy access in Cloud Run
      confirmationNumber: completeDocumentData?.taxAuthorityConfirmationNumber || null,
    };

    // Publish to Pub/Sub
    const topic = pubsub.topic(GENERATE_TOPIC);
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

/**
 * Cloud Function: Publish Preview Document Task
 * 
 * Publishes a preview document task to Pub/Sub for processing by Cloud Run.
 * Creates a task document in Firestore for tracking status.
 * 
 * IMPORTANT: This function fetches business_info and prepares ALL data.
 * Cloud Run receives complete data - no Firestore fetching happens there.
 */
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
    const businessInfoRef = admin.firestore().doc(`companies/${companyId}/business_data/business_info`);
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
    const topic = pubsub.topic(PREVIEW_TOPIC);
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

/**
 * Cloud Function: Publish Generate Document Task
 * 
 * Publishes a document generation task to Pub/Sub for processing by Cloud Run.
 * Creates a task document in Firestore for tracking status.
 * 
 * IMPORTANT: This function prepares ALL data including:
 * - Fetches business_info
 * - Generates document ID and number
 * - Increments document counter
 * - Prepares complete data for Cloud Run
 * 
 * Cloud Run only receives complete data and generates/uploads PDF.
 * 
 * For taxInvoice: accepts documentId of already-approved invoice
 * For other types: prepares everything here
 */
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

    const { documentType, documentData, companyId, documentId: providedDocId } = request.data || {};

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
      if (!documentData) {
        throw new HttpsError('invalid-argument', 'Document data is required');
      }
      if (!documentData.client || !documentData.client.name) {
        throw new HttpsError('invalid-argument', 'Client name is required');
      }
      if (!documentData.items || !Array.isArray(documentData.items) || documentData.items.length === 0) {
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
    const businessInfoRef2 = admin.firestore().doc(`companies/${companyId}/business_data/business_info`);
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
    let certificationData = null;

    // Handle tax invoice vs other types
    if (numericDocType === DOC_TYPE.TAX_INVOICE) {
      // Tax invoice - document already exists (approved via getInvoiceApproval)
      const certDocId = toCertificationDocId(providedDocId);
      documentId = toBaseDocumentId(providedDocId);
      
      // Fetch existing certification to get all data
      const certRef = admin.firestore().doc(`companies/${companyId}/certifications/${certDocId}`);
      const certDoc = await certRef.get();
      
      if (!certDoc.exists) {
        throw new HttpsError('not-found', `Document ${certDocId} not found`);
      }
      
      certificationData = certDoc.data();
      documentNumber = certificationData.documentNumber;
      
      // Build complete data from existing certification
      completeDocumentData = {
        client: {
          name: certificationData.clientName,
          email: certificationData.clientEmail || '',
          phone: certificationData.clientPhone || '',
          address: certificationData.clientAddress || '',
        },
        items: certificationData.items,
        company: companyData,
        language: certificationData.language || 'he',
        date: certificationData.date,
        notes: certificationData.notes,
        totals: {
          totalBeforeVat: certificationData.totalBeforeVat,
          vatAmount: certificationData.vatAmount,
          totalWithVat: certificationData.totalWithVat,
        }
      };
      
    } else {
      // Other document types - prepare everything here
      const { client, items, language, date, notes } = documentData;
      
      // Get and increment document number
      const documentNumbers = businessInfo.document_numbers || {};
      documentNumber = documentNumbers[numericDocType] || 1;
      
      // Generate document ID using YYYYMMDD format with suffix
      const todayDate = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
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
      certificationData,
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

// ════════════════════════════════════════════════════════════════════════
// NEW SECURITY-ENFORCED CLOUD FUNCTIONS
// These functions enforce data integrity rules that cannot be trusted
// to the client. All profile, business_info, subscription, and job
// deletion/accept operations go through these endpoints.
// ════════════════════════════════════════════════════════════════════════

/**
 * Callable Function: updateProfileV1
 * Updates ONLY the user's name and phoneNumber on their profile.
 * Role, companyId, accountType, email, uid etc. CANNOT be changed by the user.
 */
exports.updateProfileV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const name = typeof data.name === 'string' ? data.name.trim() : undefined;
  const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber.trim() : undefined;

  if (name === undefined && phoneNumber === undefined) {
    throw new HttpsError('invalid-argument', 'At least one of name or phoneNumber must be provided');
  }

  // Validate field lengths
  if (name !== undefined && name.length > 200) {
    throw new HttpsError('invalid-argument', 'Name is too long');
  }
  if (phoneNumber !== undefined && phoneNumber.length > 30) {
    throw new HttpsError('invalid-argument', 'Phone number is too long');
  }

  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name !== undefined) updates.name = name;
  if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

  await profileRef.update(updates);

  logger.info('updateProfileV1: profile updated', { uid, fields: Object.keys(updates) });
  return { success: true };
});

/**
 * Callable Function: updatePushTokenV1
 * Updates ONLY push-notification fields on the user profile.
 * Since profile is read-only from the client, this CF handles pushToken writes.
 */
exports.updatePushTokenV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const pushToken = typeof data.pushToken === 'string' ? data.pushToken.trim() : '';
  const pushTokenPlatform = typeof data.pushTokenPlatform === 'string' ? data.pushTokenPlatform.trim() : '';
  const pushTokenType = typeof data.pushTokenType === 'string' ? data.pushTokenType.trim() : 'fcm';

  if (!pushToken) {
    throw new HttpsError('invalid-argument', 'pushToken is required');
  }

  if (pushToken.length > 500) {
    throw new HttpsError('invalid-argument', 'pushToken is too long');
  }

  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  // Only update if token has changed
  const currentToken = profileSnap.data().pushToken;
  if (currentToken === pushToken) {
    return { success: true, changed: false };
  }

  const now = new Date().toISOString();
  await profileRef.update({
    pushToken,
    pushTokenUpdatedAt: now,
    pushTokenPlatform,
    pushTokenType,
  });

  logger.info('updatePushTokenV1: push token updated', { uid, platform: pushTokenPlatform });
  return { success: true, changed: true };
});

/**
 * Callable Function: updateBusinessInfoV1
 * Updates business_info fields EXCEPT vat_number and document_numbers.
 * Only manager/user/basic roles with company access can call this.
 */
exports.updateBusinessInfoV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }

  await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_COMPANY_CLIENT_ROLES, // manager, user, basic, dev
    allowSoloScope: true,
  });

  const businessInfoRef = admin.firestore().doc(`companies/${companyId}/business_data/business_info`);
  const bizSnap = await businessInfoRef.get();
  if (!bizSnap.exists) {
    throw new HttpsError('not-found', 'Business info not found');
  }

  // Build update — ONLY allowed fields
  const ALLOWED_FIELDS = [
    'he_name', 'en_name', 'city', 'address',
    'business_type', 'business_phone', 'business_email', 'business_fax',
    'accountant_name', 'accountant_email', 'accountant_phone',
  ];

  const updates = { last_updated: new Date().toISOString() };
  let hasChange = false;
  for (const field of ALLOWED_FIELDS) {
    if (data[field] !== undefined) {
      updates[field] = typeof data[field] === 'string' ? data[field].trim() : data[field];
      hasChange = true;
    }
  }

  if (!hasChange) {
    throw new HttpsError('invalid-argument', 'No updatable fields provided');
  }

  // BLOCKED fields — vat_number and document_numbers cannot be changed
  if (data.vat_number !== undefined || data.document_numbers !== undefined) {
    throw new HttpsError('permission-denied', 'Cannot modify vat_number or document_numbers');
  }

  await businessInfoRef.update(updates);

  // Bump cache
  const cacheRef = admin.firestore().doc(`companies/${companyId}/business_data/cache`);
  await cacheRef.set({
    business_info: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

  logger.info('updateBusinessInfoV1: updated', { companyId, uid, fields: Object.keys(updates) });
  return { success: true };
});

/**
 * Callable Function: deleteJobV1
 * Deletes a pending or finished job, enforcing:
 * - Cannot delete a finished job that has isCert=true (has a generated document)
 * - manager/user can delete their company's jobs
 * - worker can delete their own assigned finished jobs only
 */
exports.deleteJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';

  if (!companyId || !jobId) {
    throw new HttpsError('invalid-argument', 'companyId and jobId are required');
  }

  const { resolvedRole } = await assertHttpCompanyAccess({
    uid,
    companyId,
    allowedRoles: HTTP_ALL_APP_ROLES,
    allowSoloScope: true,
  });

  const dbRef = admin.firestore();

  // Try pending first
  const pendingRef = dbRef.doc(`companies/${companyId}/PendingJobs/${jobId}`);
  const pendingSnap = await pendingRef.get();

  if (pendingSnap.exists) {
    // Only manager/dev can delete pending jobs
    if (!['manager', 'dev'].includes(resolvedRole)) {
      throw new HttpsError('permission-denied', 'Only managers can delete pending jobs');
    }
    await pendingRef.delete();
    logger.info('deleteJobV1: pending job deleted', { companyId, jobId, uid });
    return { success: true, collection: 'PendingJobs' };
  }

  // Try finished
  const finishedRef = dbRef.doc(`companies/${companyId}/finishedJobs/${jobId}`);
  const finishedSnap = await finishedRef.get();

  if (!finishedSnap.exists) {
    throw new HttpsError('not-found', 'Job not found');
  }

  const jobData = finishedSnap.data();

  // Cannot delete a job with a generated certification
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

  await finishedRef.delete();
  logger.info('deleteJobV1: finished job deleted', { companyId, jobId, uid });
  return { success: true, collection: 'finishedJobs' };
});

/**
 * Callable Function: acceptJobV1
 * Atomically moves a pending job to finished jobs and deducts worker inventory.
 * This replaces the client-side accept flow to prevent:
 * - Duplicate jobs (pending + finished)
 * - Race conditions on inventory
 * - Cross-user writes from client
 *
 * Also bumps worker inventory cache version.
 */
exports.acceptJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';
  const finishedJobId = typeof data.finishedJobId === 'string' ? data.finishedJobId.trim() : '';

  if (!companyId || !jobId) {
    throw new HttpsError('invalid-argument', 'companyId and jobId are required');
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
    const pendingRef = dbRef.doc(`companies/${companyId}/PendingJobs/${jobId}`);
    const pendingSnap = await tx.get(pendingRef);

    if (!pendingSnap.exists) {
      throw new HttpsError('not-found', 'Pending job not found');
    }

    const jobData = pendingSnap.data();

    // Validate source status — only accept from valid transition states (canonical lifecycle)
    const validSourceStatuses = ['pending', 'waiting'];
    if (jobData.status && !validSourceStatuses.includes(jobData.status)) {
      // Allow legacy 'received' status by treating it as 'waiting'
      if (jobData.status === 'received') {
        logger.warn('acceptJobV1: Legacy "received" status encountered, treating as "waiting"', { companyId, jobId });
      } else {
        throw new HttpsError('failed-precondition',
          `Cannot accept job with status "${jobData.status}". Expected: ${validSourceStatuses.join(', ')}`);
      }
    }

    // Determine finished job ID
    const fJobId = finishedJobId || (jobId.startsWith('p_') ? `f_${jobId.slice(2)}` : `f_${jobId}`);
    const finishedRef = dbRef.doc(`companies/${companyId}/finishedJobs/${fJobId}`);

    const now = new Date().toISOString();

    // Write finished job
    const finishedJobData = {
      ...jobData,
      id: fJobId,
      status: 'finished',
      acceptedBy: uid,
      acceptedAt: now,
      updatedAt: now,
    };
    tx.set(finishedRef, finishedJobData);

    // Delete pending job
    tx.delete(pendingRef);

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
          const usedPart = partsUsed.find(
            (u) => u.id === p.id || u.name === p.name
          );
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

    return { finishedJobId: fJobId, workerId };
  });

  logger.info('acceptJobV1: job accepted', {
    companyId, jobId, finishedJobId: result.finishedJobId, uid,
  });

  return { success: true, finishedJobId: result.finishedJobId };
});

/**
 * Callable Function: registerBusinessV1
 * Creates/updates user profile + business_info + subscription + company structure.
 * This replaces the client-side registration flow (BusinessReg + onboarding)
 * to prevent users from forging roles, companyIds, or document numbers.
 *
 * Handles:
 * - Solo user registration (user/basic): companyId = uid
 * - manager company creation: generates companyId, creates company structure
 */
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

  let companyId;

  if (role === 'manager' && accountType === 'business') {
    // Company creation — generate slug from business name
    const slugBase = (enName || heName).toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    companyId = `${slugBase}-${randomSuffix}`;
  } else {
    // Solo scope — companyId = uid
    companyId = uid;
  }

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
    const existingProfile = await tx.get(profileRef);

    if (existingProfile.exists && existingProfile.data()?.companyId) {
      throw new HttpsError('already-exists', 'User is already registered with a company');
    }

    // 1. Profile
    tx.set(profileRef, {
      uid,
      email,
      role: profileRole,
      companyId,
      accountType,
      name,
      phoneNumber,
      createdAt: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. User cache
    tx.set(dbRef.doc(userCacheDocPath(uid)), {
      profile: 1,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (role === 'manager' && accountType === 'business') {
      // 3. Company root doc
      tx.set(dbRef.doc(`companies/${companyId}`), {
        companyId,
        createdBy: uid,
        createdAt: now,
        cid: 1,
        wid: 1,
        jid: 1,
      });

      // 4. Worker (manager) record
      tx.set(dbRef.doc(companyWorkerDocPath(companyId, uid)), {
        workerId: uid,
        uid,
        role: profileRole,
        email,
        name,
        phoneNumber,
        createdAt: now,
        updatedAt: now,
      });

      // 5. Business info
      tx.set(dbRef.doc(`companies/${companyId}/business_data/business_info`), businessData);

      // 6. Subscription
      tx.set(dbRef.doc(`companies/${companyId}/business_data/subscription`), {
        tier,
        status: 'active',
        enabledModules,
        updatedAt: now,
      });

      // 7. Empty inventory
      tx.set(dbRef.doc(`companies/${companyId}/business_data/inventory`), {
        parts: [],
        nextId: 1,
        lastUpdated: now,
      });

      // 8. Company cache
      tx.set(dbRef.doc(`companies/${companyId}/business_data/cache`), {
        business_info: 1,
        lastUpdated: now,
      });
    } else {
      // Solo user — companyId = uid
      tx.set(dbRef.doc(`companies/${uid}`), {
        companyId: uid,
        createdBy: uid,
        createdAt: now,
        cid: 1,
        jid: 1,
      }, { merge: true });

      tx.set(dbRef.doc(`companies/${uid}/business_data/business_info`), businessData);

      tx.set(dbRef.doc(`companies/${uid}/business_data/subscription`), {
        tier,
        status: 'active',
        enabledModules,
        updatedAt: now,
      });

      tx.set(dbRef.doc(companyWorkerDocPath(uid, uid)), {
        workerId: uid,
        uid,
        role: profileRole,
        email,
        name,
        phoneNumber,
        createdAt: now,
        updatedAt: now,
      });

      tx.set(dbRef.doc(`companies/${uid}/business_data/inventory`), {
        parts: [],
        nextId: 1,
        lastUpdated: now,
      });

      tx.set(dbRef.doc(`companies/${uid}/business_data/cache`), {
        business_info: 1,
        lastUpdated: now,
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

/**
 * Callable Function: createJobV1
 * Creates a pending or finished job with a sequential jid-based ID.
 * Atomically increments the jid counter on the company doc.
 *
 * - manager creates pending jobs (p_{jid})
 * - user (solo) creates finished jobs directly (f_{jid})
 */
exports.createJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }

  // type: 'pending' | 'finished' — determines which collection
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

  const result = await dbRef.runTransaction(async (tx) => {
    const companySnap = await tx.get(companyRef);
    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'Company not found');
    }

    const currentJid = Number(companySnap.data()?.jid || 1);
    tx.set(companyRef, { jid: currentJid + 1 }, { merge: true });

    const prefix = jobType === 'pending' ? 'p' : 'f';
    const jobId = `${prefix}_${currentJid}`;
    const collectionName = jobType === 'pending' ? 'PendingJobs' : 'finishedJobs';
    const jobRef = dbRef.doc(`companies/${companyId}/${collectionName}/${jobId}`);

    const now = new Date().toISOString();

    // Build job document from provided payload (strip metadata)
    const jobPayload = { ...data };
    delete jobPayload.companyId;
    delete jobPayload.type;

    const jobDoc = {
      ...jobPayload,
      id: jobId,
      jid: currentJid,
      status: jobType === 'pending' ? 'pending' : 'finished',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    };

    if (jobType === 'finished') {
      jobDoc.isCert = false;
      jobDoc.workerId = jobPayload.workerId || uid;
      jobDoc.completedBy = jobPayload.completedBy || uid;
    }

    tx.set(jobRef, jobDoc);

    return { jobId, jid: currentJid };
  });

  logger.info('createJobV1: job created', {
    companyId, jobId: result.jobId, jid: result.jid, uid, jobType,
  });

  return { success: true, jobId: result.jobId, jid: result.jid };
});

/**
 * Callable Function: updateJobV1
 * Updates a pending job via Cloud Function (replaces direct client writes).
 * Workers can only update jobs assigned to them with field restrictions.
 * Managers can update any field.
 */
exports.updateJobV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
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

  const dbRef = admin.firestore();

  // Determine collection from jobId prefix
  const isPending = jobId.startsWith('p_');
  const collectionName = isPending ? 'PendingJobs' : 'finishedJobs';
  const jobRef = dbRef.doc(`companies/${companyId}/${collectionName}/${jobId}`);
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

  // Build update payload — strip immutable/metadata fields
  const updates = { ...data };
  delete updates.companyId;
  delete updates.jobId;
  // Immutable fields workers cannot change
  if (resolvedRole === 'worker') {
    delete updates.workerId;
    delete updates.completedBy;
    delete updates.createdBy;
    delete updates.createdAt;
    delete updates.id;
    delete updates.jid;
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

  updates.updatedAt = new Date().toISOString();

  await jobRef.update(updates);

  logger.info('updateJobV1: job updated', { companyId, jobId, uid, role: resolvedRole });
  return { success: true, jobId };
});

/**
 * Callable Function: updateClientV1
 * Updates a client document via Cloud Function.
 * Replaces direct client writes to enforce validation.
 */
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
  if (data.name !== undefined) updates.name = String(data.name || '').trim();
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

  await clientRef.update(updates);

  // Bump cache version
  const isManagerRole = resolvedRole === 'manager';
  const cacheRef = isManagerRole
    ? dbRef.doc(`companies/${companyId}/business_data/cache`)
    : dbRef.doc(`users/${uid}/data/cache`);
  await cacheRef.set({
    clients: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

  logger.info('updateClientV1: client updated', { companyId, clientId, uid });
  return { success: true, clientId };
});

/**
 * Callable Function: updateInventoryV1
 * Centralizes all inventory mutations via Cloud Function.
 * action: 'addPart' | 'removePart' | 'togglePart' | 'updatePart' | 'pickParts'
 * scope: 'company' | 'user'
 */
exports.updateInventoryV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const scope = typeof data.scope === 'string' ? data.scope.trim() : '';
  const targetUid = typeof data.targetUid === 'string' ? data.targetUid.trim() : uid;

  if (!companyId || !action || !scope) {
    throw new HttpsError('invalid-argument', 'companyId, action, and scope are required');
  }

  if (!['addPart', 'removePart', 'togglePart', 'updatePart', 'pickParts', 'replaceParts'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Invalid action');
  }

  if (!['company', 'user'].includes(scope)) {
    throw new HttpsError('invalid-argument', 'scope must be company or user');
  }

  // Access control
  if (scope === 'company') {
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: true,
    });
  } else {
    // user scope: user can modify own inventory, manager can modify worker inventory
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: ['manager', 'worker', 'user', 'dev'],
      allowSoloScope: true,
    });
    if (targetUid !== uid) {
      // Only manager/dev can modify another user's inventory
      await assertHttpCompanyAccess({
        uid,
        companyId,
        allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
        allowSoloScope: false,
      });
    }
  }

  const dbRef = admin.firestore();
  const invRef = scope === 'company'
    ? dbRef.doc(`companies/${companyId}/business_data/inventory`)
    : dbRef.doc(`users/${targetUid}/data/inventory`);

  const result = await dbRef.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const invData = snap.exists ? (snap.data() || {}) : { parts: [], nextId: 1, lastUpdated: '' };
    const parts = Array.isArray(invData.parts) ? invData.parts : [];
    let nextId = invData.nextId || 1;
    const now = new Date().toISOString();

    if (action === 'addPart') {
      const partName = typeof data.partName === 'string' ? data.partName.trim() : '';
      if (!partName) throw new HttpsError('invalid-argument', 'partName is required');
      const newPart = {
        id: nextId,
        name: partName,
        active: data.active !== false,
        quantity: typeof data.quantity === 'number' ? data.quantity : 0,
        lowThreshold: typeof data.lowThreshold === 'number' ? data.lowThreshold : 0,
        dateAdded: now,
      };
      tx.set(invRef, { parts: [...parts, newPart], nextId: nextId + 1, lastUpdated: now }, { merge: true });
      return { partId: nextId };
    }

    if (action === 'removePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      tx.update(invRef, { parts: parts.filter((p) => p.id !== partId), lastUpdated: now });
      return { removed: partId };
    }

    if (action === 'togglePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      const updatedParts = parts.map((p) => p.id === partId ? { ...p, active: !p.active } : p);
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { toggled: partId };
    }

    if (action === 'updatePart') {
      const partId = data.partId;
      if (typeof partId !== 'number') throw new HttpsError('invalid-argument', 'partId is required');
      const updatedParts = parts.map((p) => {
        if (p.id !== partId) return p;
        const updated = { ...p };
        if (data.partName !== undefined) updated.name = String(data.partName).trim();
        if (data.quantity !== undefined) updated.quantity = Number(data.quantity);
        if (data.lowThreshold !== undefined) updated.lowThreshold = Number(data.lowThreshold);
        if (data.active !== undefined) updated.active = !!data.active;
        return updated;
      });
      tx.update(invRef, { parts: updatedParts, lastUpdated: now });
      return { updated: partId };
    }

    if (action === 'pickParts') {
      const partsToPick = data.partsToPick;
      if (!Array.isArray(partsToPick) || partsToPick.length === 0) {
        throw new HttpsError('invalid-argument', 'partsToPick array is required');
      }
      // For pick: read user inventory, add/merge picked parts
      const userInvRef = dbRef.doc(`users/${targetUid}/data/inventory`);
      const userSnap = await tx.get(userInvRef);
      const userData = userSnap.exists ? (userSnap.data() || {}) : { parts: [], nextId: 1, lastUpdated: '' };
      let userNextId = userData.nextId || 1;
      const userParts = Array.isArray(userData.parts) ? [...userData.parts] : [];

      for (const pick of partsToPick) {
        const existing = userParts.find((p) => p.id === pick.id);
        if (existing) {
          existing.quantity = (existing.quantity || 0) + (pick.quantity || 0);
        } else {
          userParts.push({
            id: userNextId,
            name: pick.name || '',
            quantity: pick.quantity || 0,
            lowThreshold: 0,
            dateAdded: now,
          });
          userNextId += 1;
        }
      }
      tx.set(userInvRef, { parts: userParts, nextId: userNextId, lastUpdated: now }, { merge: true });
      return { picked: partsToPick.length };
    }

    if (action === 'replaceParts') {
      // Manager replaces the full parts array on a worker's inventory (e.g. EditJob adjustments)
      const newParts = data.parts;
      if (!Array.isArray(newParts)) throw new HttpsError('invalid-argument', 'parts array is required');
      // Sanitize each part
      const sanitized = newParts.map((p) => ({
        id: typeof p.id === 'number' ? p.id : nextId++,
        name: typeof p.name === 'string' ? p.name.trim() : '',
        active: p.active !== false,
        quantity: typeof p.quantity === 'number' ? Math.max(0, p.quantity) : 0,
        lowThreshold: typeof p.lowThreshold === 'number' ? p.lowThreshold : 0,
        dateAdded: typeof p.dateAdded === 'string' ? p.dateAdded : now,
      }));
      const maxId = sanitized.reduce((m, p) => Math.max(m, p.id), 0);
      tx.set(invRef, { parts: sanitized, nextId: maxId + 1, lastUpdated: now }, { merge: true });
      return { replaced: sanitized.length };
    }

    throw new HttpsError('invalid-argument', 'Unknown action');
  });

  // Bump cache version
  const cacheRef = scope === 'company'
    ? dbRef.doc(`companies/${companyId}/business_data/cache`)
    : dbRef.doc(`users/${targetUid}/data/cache`);
  await cacheRef.set({
    inventory: admin.firestore.FieldValue.increment(1),
    lastUpdated: new Date().toISOString(),
  }, { merge: true });

  logger.info('updateInventoryV1: inventory updated', { companyId, action, scope, uid });
  return { success: true, ...result };
});

/**
 * Callable Function: updateCacheV1
 * Updates cache version fields via Cloud Function.
 * Replaces direct client writes to cache documents.
 */
exports.updateCacheV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const isCompanyCache = data.isCompanyCache === true;
  const field = typeof data.field === 'string' ? data.field.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : 'increment';

  if (!field) {
    throw new HttpsError('invalid-argument', 'field is required');
  }

  // Access control
  if (isCompanyCache && companyId) {
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: true,
    });
  }

  const dbRef = admin.firestore();
  const cacheRef = isCompanyCache && companyId
    ? dbRef.doc(`companies/${companyId}/business_data/cache`)
    : dbRef.doc(`users/${uid}/data/cache`);

  if (action === 'delete') {
    await cacheRef.update({
      [field]: admin.firestore.FieldValue.delete(),
      lastUpdated: new Date().toISOString(),
    });
  } else {
    await cacheRef.set({
      [field]: admin.firestore.FieldValue.increment(1),
      lastUpdated: new Date().toISOString(),
    }, { merge: true });
  }

  return { success: true };
});

/**
 * Callable Function: clearPushTokenV1
 * Clears the push token from the user's profile on logout.
 * Prevents stale token delivery to wrong-account on shared devices.
 */
exports.clearPushTokenV1 = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = request.auth.uid;
  const profileRef = admin.firestore().doc(userProfileDocPath(uid));
  const profileSnap = await profileRef.get();

  if (profileSnap.exists) {
    await profileRef.update({
      pushToken: admin.firestore.FieldValue.delete(),
      pushTokenUpdatedAt: admin.firestore.FieldValue.delete(),
      pushTokenPlatform: admin.firestore.FieldValue.delete(),
      pushTokenType: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logger.info('clearPushTokenV1: token cleared', { uid });
  return { success: true };
});

/**
 * Firestore Trigger: Clear busy flag when task completes
 * 
 * Listens for task completion and clears the busy flag
 */
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
