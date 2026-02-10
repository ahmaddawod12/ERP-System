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
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const sanitizeHtml = require("sanitize-html");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const { PubSub } = require("@google-cloud/pubsub");

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

// Module-level browser instance for reuse across invocations
let browserInstance = null;
let browserLastUsed = null;
const BROWSER_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Document generation limits
const MAX_ITEMS_PER_DOCUMENT = 100;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
const PREVIEW_URL_EXPIRATION = 60 * 60; // 1 hour in seconds for signed URLs
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// For cost control, set maximum concurrent instances
setGlobalOptions({ 
  maxInstances: 10,
  region: "us-central1" // Change to your preferred region
});

/**
 * Helper: Look up a user's Firebase UID from their email via Firebase Auth.
 * @param {string} email - The user's email address
 * @returns {Promise<string>} The user's Firebase UID
 */
async function getUidFromEmail(email) {
  const userRecord = await admin.auth().getUserByEmail(email);
  return userRecord.uid;
}

/**
 * Normalize user-provided email input for consistent auth/doc keys.
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Basic email shape validation.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
          await admin.firestore().doc(`${userId}/profile`).update({
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

  const managerProfileRef = admin.firestore().doc(`${managerUid}/profile`);
  const managerProfile = await managerProfileRef.get();

  if (!managerProfile.exists) {
    throw new HttpsError('not-found', 'Manager profile not found');
  }

  const managerData = managerProfile.data();

  if (managerData.role !== 'manager') {
    throw new HttpsError('permission-denied', 'Only managers can perform this action');
  }

  if (managerData.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Manager can only manage workers from their own company');
  }

  if (targetWorkerUid) {
    const workerProfileRef = admin.firestore().doc(`${targetWorkerUid}/profile`);
    const workerProfile = await workerProfileRef.get();

    if (!workerProfile.exists) {
      throw new HttpsError('not-found', 'Worker profile not found');
    }

    const workerData = workerProfile.data();

    if (workerData.role !== 'worker') {
      throw new HttpsError('permission-denied', 'Target user is not a worker');
    }

    if (workerData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Worker is not from the same company');
    }
  }

  return { managerUid, managerEmail: auth.token.email };
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
      email: rawEmail,
      password,
      name,
      phoneNumber,
      companyId: rawCompanyId,
      newEmail: rawNewEmail,
      newPassword
    } = request.data;
    const email = normalizeEmail(rawEmail);
    const companyId = String(rawCompanyId || '').trim();
    const newEmail = rawNewEmail ? normalizeEmail(rawNewEmail) : '';

    logger.info('manageWorker called', { 
      action,
      email,
      companyId,
      hasAuth: !!request.auth,
      authEmail: request.auth?.token?.email
    });

    // Validate action
    if (!action || !['add', 'edit', 'delete'].includes(action)) {
      throw new HttpsError('invalid-argument', "Action must be 'add', 'edit', or 'delete'");
    }

    // Validate required parameters
    if (!email || !companyId) {
      throw new HttpsError('invalid-argument', 'Email and company name are required');
    }
    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid worker email format');
    }
    if (newEmail && !isValidEmail(newEmail)) {
      throw new HttpsError('invalid-argument', 'Invalid new email format');
    }
    if (password && password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
    }
    if (newPassword && newPassword.length < 8) {
      throw new HttpsError('invalid-argument', 'New password must be at least 8 characters');
    }

    // Verify manager authentication
    // For add, we don't have a worker UID yet; for edit/delete, look up worker UID from email
    let workerUid = null;
    if (action !== 'add') {
      try {
        const workerRecord = await admin.auth().getUserByEmail(email);
        workerUid = workerRecord.uid;
      } catch (authLookupError) {
        throw new HttpsError('not-found', `Worker with email ${email} not found in authentication system`);
      }
    }
    await verifyManagerAuth(request.auth, workerUid, companyId);

    // ========== ADD WORKER ==========
    if (action === 'add') {
      if (!password) {
        throw new HttpsError('invalid-argument', 'Password is required for adding a worker');
      }

      // Create Firebase Authentication user
      const userRecord = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: name || email.split('@')[0],
      });
      workerUid = userRecord.uid;

      logger.info(`Created Authentication user for worker: ${email}`, { uid: workerUid });

      // Create worker profile in Firestore (keyed by UID)
      const workerProfileRef = admin.firestore().doc(`${workerUid}/profile`);
      await workerProfileRef.set({
        email: email,
        role: 'worker',
        companyId: companyId,
        name: name || '',
        phoneNumber: phoneNumber || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        uid: workerUid
      });
      const workerCacheRef = admin.firestore().doc(`${workerUid}/cache`);
      await workerCacheRef.set({
        profile : 1});
      logger.info(`Created Firestore profile for worker: ${email} (uid: ${workerUid})`);

      // Add worker to company's worker list (keyed by UID)
      const workerListRef = admin.firestore().doc(`companies/${companyId}/workers/${workerUid}`);
      await workerListRef.set({
        email: email,
        name: name || '',
        phoneNumber: phoneNumber || '',
        uid: workerUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info(`Added worker to company list: ${companyId}`);
      await saveAuditLog(companyId, 'addWorker', request.auth.token.email);

      return {
        success: true,
        uid: workerUid,
        message: 'Worker account created successfully'
      };
    }

    // ========== DELETE WORKER ==========
    if (action === 'delete') {
      // workerUid already obtained above via admin.auth().getUserByEmail()

      // Delete Authentication user
      await admin.auth().deleteUser(workerUid);
      logger.info(`Deleted Authentication user for worker: ${email} (uid: ${workerUid})`);

      // Delete ALL worker data recursively (using UID-based path)
      logger.info(`Starting recursive delete for worker folder: ${workerUid}`);
      
      try {
        await recursiveDelete(workerUid);
        logger.info(`Deleted entire Firestore folder for worker uid: ${workerUid}`);
      } catch (deleteError) {
        logger.error(`Error during recursive delete for ${workerUid}:`, deleteError);
      }

      // Remove worker from company's worker list (keyed by UID)
      const workerListRef = admin.firestore().doc(`companies/${companyId}/workers/${workerUid}`);
      await workerListRef.delete();
      logger.info(`Removed worker from company list: ${companyId}`);

      await saveAuditLog(companyId, 'deleteWorker', request.auth.token.email);

      return {
        success: true,
        message: 'Worker account deleted successfully'
      };
    }

    // ========== EDIT WORKER ==========
    if (action === 'edit') {
      if (!newEmail && !newPassword && name === undefined && phoneNumber === undefined) {
        throw new HttpsError('invalid-argument', 'At least one field must be provided for update');
      }
      if (newEmail) {
        throw new HttpsError(
          'failed-precondition',
          'Changing worker email is not currently supported. Create a new worker account instead.'
        );
      }

      // Read worker profile (using UID-based path)
      const workerProfileRef = admin.firestore().doc(`${workerUid}/profile`);
      const workerProfile = await workerProfileRef.get();

      if (!workerProfile.exists) {
        throw new HttpsError('not-found', 'Worker profile not found');
      }

      // Prepare Authentication updates
      const authUpdates = {};
      if (newPassword) {
        authUpdates.password = newPassword;
      }
      if (name) {
        authUpdates.displayName = name;
      }

      // Update Firebase Authentication
      if (Object.keys(authUpdates).length > 0) {
        await admin.auth().updateUser(workerUid, authUpdates);
        logger.info(`Updated Authentication for worker: ${email}`, {
          updatedFields: Object.keys(authUpdates),
        });
      }

      // Prepare Firestore updates
      const firestoreUpdates = {};
      if (name) {
        firestoreUpdates.name = name;
      }
      if (phoneNumber !== undefined) {
        firestoreUpdates.phoneNumber = phoneNumber;
      }
      firestoreUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      // Update worker profile in Firestore
      if (Object.keys(firestoreUpdates).length > 0) {
        await workerProfileRef.update(firestoreUpdates);
        logger.info(`Updated Firestore profile for worker: ${email} (uid: ${workerUid})`);
      }

      // Update company's worker list (keyed by UID)
      const workerListRef = admin.firestore().doc(`companies/${companyId}/workers/${workerUid}`);
      const updateData = {};
      updateData.password = admin.firestore.FieldValue.delete(); // Remove legacy plaintext password field
      if (name) {
        updateData.name = name;
      }
      if (phoneNumber !== undefined) {
        updateData.phoneNumber = phoneNumber;
      }
      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      if (Object.keys(updateData).length > 0) {
        await workerListRef.update(updateData);
        logger.info(`Updated worker in company list: ${companyId}`);
      }

      await saveAuditLog(companyId, 'editWorker', request.auth.token.email);

      return {
        success: true,
        message: 'Worker account updated successfully'
      };
    }

  } catch (error) {
    logger.error(`Error managing worker (${request.data.action}):`, error);
    
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
    
    throw new HttpsError('internal', `Failed to ${request.data.action} worker: ` + error.message);
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
    const workerProfileRef = admin.firestore().doc(`${workerUserId}/profile`);
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
    const managerProfileRef = admin.firestore().doc(`${managerUserId}/profile`);
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
// IMPORTANT: Replace these with your actual credentials
const TAX_AUTHORITY_CONFIG = {
  authUrl: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
  tokenUrl: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
  // Your application's OAuth credentials - set these in Firebase environment config for production
  clientId: process.env.TAX_CLIENT_ID || '2d588624cd0ddea4f75f9dd318028b12',
  clientSecret: process.env.TAX_CLIENT_SECRET || '0bdb57bc605c755dee6736d9ccaa89ed',
  scope: 'scope',
  // The callback URL will be the Cloud Function URL
};

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
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('startTaxAuthorityAuth called', { uid });

    // Verify user is a manager
    const userProfileRef = admin.firestore().doc(`${uid}/profile`);
    const userProfile = await userProfileRef.get();

    if (!userProfile.exists) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    const userData = userProfile.data();
    if (userData.role !== 'manager') {
      throw new HttpsError('permission-denied', 'Only managers can authorize Tax Authority access');
    }

    const companyId = userData.companyId;
    if (!companyId) {
      throw new HttpsError('failed-precondition', 'User has no company assigned');
    }

    // Fixed callback URL (must be registered in Tax Authority settings)
    const callbackUrl = 'https://taxauthoritycallback-5zymz2qeza-zf.a.run.app';

    // Store pending authorization in Firestore to track which company initiated the flow
    // The callback will look up this record to get the companyId
    const pendingAuthRef = admin.firestore().collection('taxAuthPending').doc();
    const authId = pendingAuthRef.id;
    
    await pendingAuthRef.set({
      authId: authId,
      companyId: companyId,
      uid: uid,
      email: request.auth.token.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMillis: Date.now(),
      status: 'pending',
      expiresAt: Date.now() + (10 * 60 * 1000), // Expires in 10 minutes
    });

    logger.info('Starting Tax Authority OAuth flow', {
      authId: authId,
      companyId: companyId,
      uid: uid,
      callbackUrl: callbackUrl,
    });

    // Build authorization URL (fixed callback URL, no query params)
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: TAX_AUTHORITY_CONFIG.clientId,
      scope: TAX_AUTHORITY_CONFIG.scope,
      redirect_uri: callbackUrl,
    });

    const authorizationUrl = `${TAX_AUTHORITY_CONFIG.authUrl}?${authParams.toString()}`;

    logger.info('Generated authorization URL', { 
      authId: authId,
      uid, 
      companyId,
      callbackUrl
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
    logger.info('taxAuthorityCallback received', { 
      method: req.method,
      fullUrl: req.url,
      originalUrl: req.originalUrl,
      protocol: req.protocol,
      host: req.get('host'),
      completeUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      query: req.query,
      queryString: req.url.split('?')[1] || '',
      hasCode: !!req.query.code,
      headers: {
        'user-agent': req.get('user-agent'),
        'referer': req.get('referer'),
        'origin': req.get('origin')
      }
    });

    const { code, error, error_description } = req.query;

    // Handle OAuth errors from Tax Authority
    if (error) {
      logger.error('OAuth error from Tax Authority', { error, error_description });
      return res.redirect(`coolinginventory://auth-callback?success=false&error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code) {
      logger.error('No authorization code received');
      return res.redirect('coolinginventory://auth-callback?success=false&error=No%20authorization%20code%20received');
    }

    // Log the raw code for debugging
    logger.info('Authorization code details', {
      codeLength: code.length,
      codePreview: code.substring(0, 20) + '...',
      codeSuffix: code.substring(code.length - 10),
      hasSpecialChars: /[^a-zA-Z0-9]/.test(code),
      timestamp: Date.now()
    });

    // Check if this code was already processed (prevent duplicates from browser retries)
    const existingCallbacksQuery = admin.firestore().collection('taxAuthCallbacks')
      .where('code', '==', code)
      .limit(1);
    const existingCallbacks = await existingCallbacksQuery.get();

    if (!existingCallbacks.empty) {
      const existingCallback = existingCallbacks.docs[0];
      const existingData = existingCallback.data();
      logger.info('Code already processed, using existing callback', { 
        callbackId: existingCallback.id,
        tokenExchangeSuccess: existingData.tokenExchangeSuccess 
      });
      
      // Return existing result
      const deepLink = `coolinginventory://auth-callback?success=true&callbackId=${existingCallback.id}&tokenExchanged=${existingData.tokenExchangeSuccess || false}`;
      // Skip to HTML response with existing data
      const tokenExchangeSuccess = existingData.tokenExchangeSuccess || false;
      const tokenExchangeError = existingData.tokenExchangeError || null;
      const companyId = existingData.companyId || null;
      
      // Generate HTML with existing data and return
      return res.send(generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError));
    }

    // Save the authorization code to Firestore (code is already URL-decoded by Express)
    const callbackRecordRef = admin.firestore().collection('taxAuthCallbacks').doc();
    const receivedAtMillis = Date.now();
    await callbackRecordRef.set({
      code: code,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      receivedAtMillis: receivedAtMillis,
      used: false,
      codeLength: code.length,
    });
    
    logger.info('Authorization code saved to Firestore', { 
      callbackId: callbackRecordRef.id,
      code: code.substring(0, 20) + '...',
      receivedAtMillis: receivedAtMillis
    });

    // IMMEDIATELY exchange the code for tokens while it's fresh
    logger.info('Attempting to exchange authorization code immediately...');
    
    let tokenExchangeSuccess = false;
    let tokenExchangeError = null;
    let companyId = null;

    try {
      // Look up the pending authorization from Firestore (most recent within last 10 minutes)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      const pendingAuthQuery = admin.firestore().collection('taxAuthPending')
        .where('status', '==', 'pending')
        .where('createdAtMillis', '>', tenMinutesAgo)
        .orderBy('createdAtMillis', 'desc')
        .limit(1);
      
      const pendingAuthSnapshot = await pendingAuthQuery.get();
      
      let companyIdFromAuth = null;
      let pendingAuthDoc = null;
      
      if (!pendingAuthSnapshot.empty) {
        pendingAuthDoc = pendingAuthSnapshot.docs[0];
        const pendingAuthData = pendingAuthDoc.data();
        companyIdFromAuth = pendingAuthData.companyId;
        
        logger.info('Found pending authorization', {
          authId: pendingAuthDoc.id,
          companyId: companyIdFromAuth,
          uid: pendingAuthData.uid,
          age: Date.now() - pendingAuthData.createdAtMillis
        });
        
        // Mark as used
        await pendingAuthDoc.ref.update({
          status: 'used',
          usedAt: admin.firestore.FieldValue.serverTimestamp(),
          code: code.substring(0, 20) + '...', // Store truncated code for reference
        });
      } else {
        logger.warn('No pending authorization found - tokens will be saved without company link');
      }
      
      // Fixed callback URL (must match what's registered in Tax Authority settings)
      const callbackUrl = 'https://taxauthoritycallback-5zymz2qeza-zf.a.run.app';

      logger.info('Exchanging token with Tax Authority', {
        tokenUrl: TAX_AUTHORITY_CONFIG.tokenUrl,
        callbackUrl: callbackUrl,
        codeLength: code.length,
        clientId: TAX_AUTHORITY_CONFIG.clientId,
        companyId: companyIdFromAuth
      });

      // Exchange authorization code for tokens (axios-retry handles retries automatically)
      const tokenResponse = await axios.post(
        TAX_AUTHORITY_CONFIG.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: callbackUrl,
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
      logger.info('Token exchange successful in callback', { 
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        refreshTokenExpiresIn: tokenData.refresh_token_expires_in
      });

      // Calculate token expiration timestamps using actual API response values
      const now = Date.now();
      const accessTokenExpiresAt = now + (tokenData.expires_in * 1000);
      // Use actual refresh_token_expires_in from response (not hardcoded 90 days)
      const refreshTokenExpiresAt = tokenData.refresh_token_expires_in 
        ? now + (tokenData.refresh_token_expires_in * 1000)
        : now + (90 * 24 * 60 * 60 * 1000); // Fallback to 90 days if not provided

      // Use company name from pending authorization record
      companyId = companyIdFromAuth;

      if (!companyId) {
        logger.warn('No companyId from pending auth - tokens saved but not linked to company');
      }

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

        logger.info('Tokens saved directly to company settings', { companyId });

        // Save audit log
        await saveAuditLog(companyId, 'taxAuthorityAuthorized', 'system_callback');
      }

      // Update the callback record with tokens (backup/reference)
      await callbackRecordRef.update({
        used: true,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        tokenExchangeSuccess: true,
        companyId: companyId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        accessTokenExpiresAt: accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
      });

      tokenExchangeSuccess = true;
      logger.info('Tokens saved to callback record', { callbackId: callbackRecordRef.id });

    } catch (exchangeError) {
      logger.error('Token exchange failed in callback', {
        message: exchangeError.message,
        response: exchangeError.response?.data,
        responseText: exchangeError.response?.data ? JSON.stringify(exchangeError.response.data) : null,
        status: exchangeError.response?.status,
        headers: exchangeError.response?.headers,
      });
      
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
    const deepLink = `coolinginventory://auth-callback?success=true&callbackId=${callbackRecordRef.id}&tokenExchanged=${tokenExchangeSuccess}`;
    
    return res.send(generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError));

  } catch (error) {
    logger.error('Error in taxAuthorityCallback:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Return error HTML page
    const errorMessage = error.message || 'Failed to process authorization';
    const deepLink = `coolinginventory://auth-callback?success=false&error=${encodeURIComponent(errorMessage)}`;
    
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
      authEmail: request.auth?.token?.email,
      timestamp: new Date().toISOString()
    });

    if (!request.auth) {
      logger.error('Authentication missing', {
        hasRequest: !!request,
        requestKeys: Object.keys(request)
      });
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('Processing invoice for user', { uid });

    // Get user profile to check role (accept from frontend or fetch)
    let userData;
    if (request.data.userProfile) {
      // Use cached profile from frontend (optimization)
      userData = request.data.userProfile;
      logger.info('Using cached user profile from frontend');
    } else {
      // Fallback: fetch from Firestore (backwards compatibility)
      const userProfileRef = admin.firestore().doc(`${uid}/profile`);
      const userProfile = await userProfileRef.get();
        if (!userProfile.exists) {
        throw new HttpsError('not-found', 'User profile not found');
      }
      userData = userProfile.data();
    }
    
    const role = userData.role;

    // Only managers and users can submit invoices to Tax Authority
    if (role !== 'manager' && role !== 'user') {
      throw new HttpsError('permission-denied', 'Only managers and users can submit invoices to Tax Authority');
    }

    logger.info('User authorized', { uid, role });

    // Extract document data from request
    const {
      type, client, items, company, companyId,
      language, date, notes, jobData, jobsData, priceProposalId
    } = request.data;

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
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'Company ID is required for Firestore');
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

    // Verify companyId matches user's company
    if (userData.companyId && userData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Company name mismatch');
    }

    // Generate next document number and build document ID using date-number-type format
    const documentNumber = businessInfo.document_numbers[305];
    const todayDate = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD format
    const todayDate_2 = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const paddedDocNumber = String(documentNumber).padStart(6, '0'); // e.g., "000001"
    const documentId = `${todayDate}${paddedDocNumber}TI`; // e.g., "20260105000001TI"
    const fileName = `${documentId}.pdf`; // e.g., "20260105000001TI.pdf"

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
        await saveAuditLog(companyId, 'taxAuthorityTokenAutoRefreshed', request.auth.token.email);

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
      invoice_reference_number: paddedDocNumber,
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
    taxAuthorityData.invoice_date = todayDate_2;
    taxAuthorityData.invoice_issuance_date = todayDate_2;
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
      totalAmount: taxAuthorityData.payment_amount_including_vat,
      fullRequestBody: taxAuthorityData // Log the entire request for debugging
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
        responseData: error.response?.data,
        totalTime
      });
      
      throw new HttpsError(
        'internal',
        `Failed to submit invoice after retries: ${error.message}`,
        {
          status: error.response?.status,
          responseData: error.response?.data
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
      responseData: response.data
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
        responseData: response.data,
        requestBody: taxAuthorityData,
        invoiceId: documentId
      });
      
      throw new HttpsError(
        'failed-precondition',
        `${errorMessage} (Status: ${response.status})${response.data?.errors ? '\nErrors: ' + JSON.stringify(response.data.errors) : ''}`,
        {
          status: response.status,
          responseData: response.data,
          requestBody: taxAuthorityData,
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
        responseData: response.data,
        responseDataType: typeof response.data,
        responseDataKeys: response.data ? Object.keys(response.data) : []
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
        const cachePath = isManager? `companies/${companyId}/business_data/cache`: `${uid}/cache`;
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
        userProfile: userData, // Pass user profile for role-based cache path
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
 * @param {Object} [params.userProfile] - User profile with role for cache path determination
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
  userProfile
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
      userProfile: userProfile || null, // User profile for role-based cache path
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

    const { documentType, documentData, companyId } = request.data;
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

    // Get user profile (accept from frontend or fetch)
    let userProfile;
    if (request.data.userProfile) {
      userProfile = request.data.userProfile;
      logger.info('Using cached user profile from frontend', { role: userProfile.role });
    } else {
      // Fallback: fetch from Firestore
      const userProfileRef = admin.firestore().doc(`${uid}/profile`);
      const userProfileDoc = await userProfileRef.get();
      if (userProfileDoc.exists) {
        userProfile = userProfileDoc.data();
      }
    }

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

    const { documentType, documentData, companyId, documentId: providedDocId } = request.data;

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

    // Get user profile (accept from frontend or fetch)
    let userProfile;
    if (request.data.userProfile) {
      userProfile = request.data.userProfile;
      logger.info('Using cached user profile from frontend', { role: userProfile.role });
    } else {
      // Fallback: fetch from Firestore
      const userProfileRef = admin.firestore().doc(`${uid}/profile`);
      const userProfileDoc = await userProfileRef.get();
      if (userProfileDoc.exists) {
        userProfile = userProfileDoc.data();
      }
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
      const documentNumberField = `document_numbers.${numericDocType}`;
      
      // Generate document ID using YYYYMMDD format with suffix
      const todayDate = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
      const paddedDocNumber = String(documentNumber).padStart(6, '0');
      const typeSuffix = DOC_SUFFIX[numericDocType] || 'XX';
      
      documentId = `${todayDate}${paddedDocNumber}${typeSuffix}`;
      
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
      userProfile: userProfile, // Pass user profile for role-based cache path
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
