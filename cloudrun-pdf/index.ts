import express from 'express';
import { Storage } from '@google-cloud/storage';
import { getEmailServiceInstance, getDocumentTitle } from './emailService';
import generateDocumentHTML from './htmlTemplate';
import { bumpCompanyDocumentsVersion } from './company-sync-store';
import { createBrowserPool, isTransientProcessingError } from './browser-pool';
import { createCompanyLogoFetcher } from './logo-cache';
import { installStructuredLogging } from './logging';
import { createPubSubVerifier } from './pubsub-auth';
import { registerPreviewRoute } from './routes/preview';
import { registerGenerateRoute } from './routes/generate';

/**
 * Cloud Run Service: PDF Document Generator & Preview (Merged)
 * 
 * Single service handling both PDF generation and preview using shared Puppeteer browser.
 * - /generate - Generates final PDFs and saves to Firestore + Storage
 * - /preview - Generates preview PDFs with temporary storage
 * 
 * Configuration:
 * - Min instances: 0 (scale to zero when idle)
 * - Max instances: 5 (testing level)
 * - Concurrency: 2 (2 browser tabs per instance - shared between preview & generate)
 * - Memory: 2Gi
 * - CPU: 2
 * - Timeout: 300s
 * 
 * Email Delivery:
 * - Sends document emails to clients if email is provided
 * - Supports SendGrid and Amazon SES providers
 * - Configure via EMAIL_PROVIDER environment variable
 */


// Email service for document delivery

installStructuredLogging('cloudrun-pdf');

const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
if (!STORAGE_BUCKET) {
  throw new Error('STORAGE_BUCKET environment variable is required');
}

// Initialize storage client.
const storage = new Storage();

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// ============================================================================
// CONSTANTS
// ============================================================================
const PREVIEW_URL_EXPIRATION = 60 * 60; // 1 hour in seconds
const GENERATED_TASK_URL_EXPIRATION = 15 * 60; // 15 minutes in seconds
const GENERATED_EMAIL_URL_EXPIRATION = 24 * 60 * 60; // 24 hours in seconds
const MAX_ITEMS_PER_DOCUMENT = 100;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_TABS = Math.max(1, Number(process.env.MAX_CONCURRENT_TABS || 2) || 2); // Shared between preview and generate
const TAB_WAIT_TIMEOUT = Math.max(1_000, Number(process.env.TAB_WAIT_TIMEOUT_MS || 10000) || 10000);
const MAX_TAB_WAITERS = Math.max(1, Number(process.env.MAX_TAB_WAITERS || 64) || 64);
const PROCESSING_STALE_AFTER_MS = Number(process.env.DOCUMENT_TASK_PROCESSING_STALE_AFTER_MS || 15 * 60 * 1000);
const PUBSUB_VERIFICATION_TOKEN = process.env.PUBSUB_VERIFICATION_TOKEN || '';
const PUBSUB_ALLOWED_SERVICE_ACCOUNTS = (process.env.PUBSUB_ALLOWED_SERVICE_ACCOUNTS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const EDGE_SERVICE_ACCOUNT_EMAIL = String(
  process.env.GCP_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '',
).trim().toLowerCase();
const EDGE_SERVICE_ACCOUNT_PRIVATE_KEY = String(
  process.env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || '',
).replace(/\\n/g, '\n').trim();
const CLOUD_RUN_SERVICE_URL = String(process.env.CLOUD_RUN_SERVICE_URL || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && !CLOUD_RUN_SERVICE_URL) {
  throw new Error('CLOUD_RUN_SERVICE_URL must be set in production for Pub/Sub OIDC verification');
}

if (IS_PRODUCTION && PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0) {
  throw new Error('PUBSUB_ALLOWED_SERVICE_ACCOUNTS must include at least one allowed service account in production');
}

const MAX_LOGO_SIZE = 1 * 1024 * 1024; // 1MB max logo size

/** Document IDs are now plain Base62 — no prefix stripping needed. */
function toBaseDocumentId(documentId) {
  return String(documentId || '').trim();
}

/** Alias kept for call-site clarity (Firestore doc ID vs display ID). */
const toDocumentDocId = toBaseDocumentId;
const browserPool = createBrowserPool({
  maxConcurrentTabs: MAX_CONCURRENT_TABS,
  maxTabWaiters: MAX_TAB_WAITERS,
  tabWaitTimeoutMs: TAB_WAIT_TIMEOUT,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
});
const {
  getBrowser,
  acquireTab,
  releaseTab,
  getStats: getBrowserPoolStats,
  getGeneration: getBrowserGeneration,
} = browserPool;

const verifyPubSubRequest = createPubSubVerifier({
  cloudRunServiceUrl: CLOUD_RUN_SERVICE_URL,
  pubsubVerificationToken: PUBSUB_VERIFICATION_TOKEN,
  allowedServiceAccounts: PUBSUB_ALLOWED_SERVICE_ACCOUNTS,
  edgeServiceAccountEmail: EDGE_SERVICE_ACCOUNT_EMAIL,
  edgeServiceAccountPrivateKey: EDGE_SERVICE_ACCOUNT_PRIVATE_KEY,
});

const fetchCompanyLogo = createCompanyLogoFetcher({
  storage,
  bucketName: STORAGE_BUCKET,
  maxLogoSize: MAX_LOGO_SIZE,
});

// ============================================================================
// HTML TEMPLATE GENERATOR
// ============================================================================
const {
  buildHtmlPayload,
} = require('./document-payload');
const {
  completeDocumentGeneration: completeSqlDocumentGeneration,
  failDocumentGeneration: failSqlDocumentGeneration,
  isSqlDocumentStoreEnabled,
} = require('./document-store');
const {
  getUserProfileForCompany,
  isSqlAccessStoreEnabled,
} = require('./access-store');
const {
  claimTaskProcessing: claimSqlTaskProcessing,
  isSqlTaskStoreEnabled,
  markTaskCompleted: markSqlTaskCompleted,
  markTaskFailed: markSqlTaskFailed,
  markTaskProcessing: markSqlTaskProcessing,
} = require('./task-store');

if (IS_PRODUCTION && !isSqlTaskStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL task store in production');
}

if (IS_PRODUCTION && !isSqlDocumentStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL document store in production');
}

if (IS_PRODUCTION && !isSqlAccessStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL access store in production');
}

if (!isSqlTaskStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL task store');
}

if (!isSqlDocumentStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL document store');
}

if (!isSqlAccessStoreEnabled()) {
  throw new Error('cloudrun-pdf requires SQL access store');
}

// ============================================================================
// PREVIEW TASK PROCESSOR
// ============================================================================
async function processPreviewTask(taskData) {
  const { taskId, documentType, documentData, uid, companyId } = taskData;
  const startTime = Date.now();
  let page = null;
  let tabAcquired = false;
  
  console.log(`[preview:${taskId}] Processing`, { documentType, uid, companyId });
  
  try {
    // Verify requester identity — same checks as generateTask
    if (!uid || !companyId) {
      throw new Error('Missing required task identity fields (uid and companyId)');
    }

    const taskClaim = await claimSqlTaskProcessing(taskId, { staleAfterMs: PROCESSING_STALE_AFTER_MS });
    if (!taskClaim.shouldProcess) {
      console.log(`[preview:${taskId}] Skipping - ${taskClaim.reason}`);
      return { success: true, taskId, skipped: true, reason: taskClaim.reason };
    }

    const requesterProfile = await getUserProfileForCompany(uid, companyId);
    if (!requesterProfile) {
      throw new Error(`Requester profile not found for uid: ${uid}`);
    }
    const userRole = (requesterProfile.role || '').toLowerCase();

    if (!['manager', 'user', 'basic', 'dev'].includes(userRole)) {
      throw new Error(`Role not authorized for document preview: ${requesterProfile.role || 'unknown'}`);
    }
    if (!requesterProfile.companyId || requesterProfile.companyId !== companyId) {
      throw new Error('Requester company mismatch');
    }

    const acquiredGen = await acquireTab(taskId, 'preview');
    tabAcquired = true;
    
    const { items } = documentData;
    
    // Validate items
    if (items && items.length > MAX_ITEMS_PER_DOCUMENT) {
      throw new Error(`Maximum ${MAX_ITEMS_PER_DOCUMENT} items allowed`);
    }
    
    // Fetch logo from Firebase Storage (cached, size-validated)
    let logoUrl = await fetchCompanyLogo(companyId, taskId, 'preview');
    
    // Generate HTML - for preview, confirmationNumber is empty (not yet approved by Tax Authority)
    const html = generateDocumentHTML(buildHtmlPayload({
      documentType,
      documentData,
      documentNumber: documentData.documentNumber,
      logoUrl,
      confirmationNumber: '',
    }));
    
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_HTML_SIZE) {
      throw new Error(`Document HTML too large (${htmlSize} bytes)`);
    }
    
    // Generate PDF using shared browser (validate generation to detect browser restarts)
    const browser = await getBrowser();
    if (getBrowserGeneration() !== acquiredGen) {
      throw new Error('Browser was recycled during tab wait — retry');
    }
    page = await browser.newPage();
    
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      timeout: 30000
    });
    
    await page.close();
    page = null;
    releaseTab(taskId, 'preview');
    tabAcquired = false;
    
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Generated PDF is empty');
    }
    
    const pdfSize = pdfBuffer.length;
    
    // Upload to Firebase Storage (temporary preview)
    const timestamp = Date.now();
    const previewId = `preview_${documentType}_${timestamp}`;
    const fileName = `${previewId}.pdf`;
    const filePath = `previews/${uid}/${fileName}`;
    
    const bucket = storage.bucket(STORAGE_BUCKET);
    const file = bucket.file(filePath);
    
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          documentType,
          createdBy: uid,
          createdAt: new Date().toISOString(),
          isPreview: 'true',
          taskId,
          expiresAt: new Date(Date.now() + PREVIEW_URL_EXPIRATION * 1000).toISOString(),
        }
      }
    });
    const [downloadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PREVIEW_URL_EXPIRATION * 1000,
    });
    
    const totalTime = Date.now() - startTime;
    
    try {
      await markSqlTaskCompleted(taskId, {
        taskType: 'preview',
        resultUrl: downloadUrl,
        storagePath: filePath,
        pdfSize,
      });
    } catch (sqlTaskError) {
      console.warn(`[preview:${taskId}] Failed to mirror completed status to SQL`, { error: sqlTaskError.message });
    }
    
    console.log(`[preview:${taskId}] Completed`, { pdfSize, totalTime });
    return { success: true, taskId, previewURL: downloadUrl, pdfSize };
    
  } catch (error) {
    console.error(`[preview:${taskId}] Failed:`, error.message);
    
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    if (tabAcquired) {
      releaseTab(taskId, 'preview');
    }
    
    try {
      await markSqlTaskFailed(taskId, error.message);
    } catch (sqlTaskError) {
      console.warn(`[preview:${taskId}] Failed to mirror failed status to SQL`, { error: sqlTaskError.message });
    }
    
    throw error;
  }
}

// ============================================================================
// GENERATE TASK PROCESSOR
// ============================================================================
async function processGenerateTask(taskData) {
  const { 
    taskId, 
    documentType, 
    documentData,
    uid, 
    companyId, 
    documentId,
    documentNumber,
    confirmationNumber, // Tax Authority confirmation number
    userRole: claimedUserRole, // Untrusted role from message (for diagnostics only)
  } = taskData;

  const startTime = Date.now();
  let page = null;
  let tabAcquired = false;
  let userRole = null;
  let savedGeneratedFile = null;
  let documentFinalized = false;
  let finalizedDocumentCode = null;
  
  try {
    if (!uid || !companyId) {
      throw new Error('Missing required task identity fields (uid and companyId)');
    }

    // P0-5: Idempotency check before processing.
    // If task is already processing/completed, skip duplicate side effects.
    const casResult = await claimSqlTaskProcessing(taskId, { staleAfterMs: PROCESSING_STALE_AFTER_MS });

    if (!casResult.shouldProcess) {
      console.log(`[generate:${taskId}] Skipping - ${casResult.reason}`);
      return { success: true, taskId, skipped: true, reason: casResult.reason };
    }

    try {
      await markSqlTaskProcessing(taskId);
    } catch (sqlTaskError) {
      console.warn(`[generate:${taskId}] Failed to mirror processing status to SQL`, { error: sqlTaskError.message });
    }

    const requesterProfile = await getUserProfileForCompany(uid, companyId);
    if (!requesterProfile) {
      throw new Error(`Requester profile not found for uid: ${uid}`);
    }
    // Normalize role to lowercase for comparison (canonical role format)
    userRole = (requesterProfile.role || '').toLowerCase();

    if (!['manager', 'user', 'basic', 'dev'].includes(userRole)) {
      throw new Error(`Role not authorized for document generation: ${requesterProfile.role || 'unknown'}`);
    }
    if (!requesterProfile.companyId || requesterProfile.companyId !== companyId) {
      throw new Error('Requester company mismatch');
    }

    console.log(`[generate:${taskId}] Processing`, {
      documentType,
      uid,
      companyId,
      documentId,
      confirmationNumber,
      userRole,
      claimedUserRole: claimedUserRole || null,
    });

    const acquiredGen = await acquireTab(taskId, 'generate');
    tabAcquired = true;
    
    if (!documentId) {
      throw new Error('Document ID is required');
    }
    const normalizedDocumentId = toBaseDocumentId(documentId);
    const documentDocId = toDocumentDocId(documentId);
    if (!normalizedDocumentId || !documentDocId) {
      throw new Error('Invalid document ID');
    }
    finalizedDocumentCode = documentDocId;
    
    if (!documentData) {
      throw new Error('Document data is required');
    }
    
    const htmlPayload = buildHtmlPayload({
      documentType,
      documentData,
      documentNumber: documentNumber || normalizedDocumentId,
      logoUrl: null,
      confirmationNumber,
    });
    const { client, items, company, language, date, totals } = htmlPayload;
    
    if (!client || !client.name) {
      throw new Error('Client name is required');
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('At least one item is required');
    }
    
    if (!company || !company.name) {
      throw new Error('Company data is required');
    }
    
    // Calculate totals
    let totalBeforeVat = totals?.totalBeforeVat || 0;
    let vatAmount = totals?.vatAmount || 0;
    let totalWithVat = totals?.totalWithVat || 0;
    
    if (!totals) {
      items.forEach(item => {
        totalBeforeVat += (item.quantity || 1) * (item.price || 0);
      });
      vatAmount = totalBeforeVat * 0.18;
      totalWithVat = totalBeforeVat + vatAmount;
    }
    
    // Fetch logo from Firebase Storage (cached, size-validated)
    let logoUrl = await fetchCompanyLogo(companyId, taskId, 'generate');
    
    // Generate HTML with all document data including confirmation number
    const html = generateDocumentHTML({
      ...htmlPayload,
      logoUrl,
    });
    
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_HTML_SIZE) {
      throw new Error('Document HTML too large');
    }
    
    // Generate PDF using shared browser (validate generation to detect browser restarts)
    const browser = await getBrowser();
    if (getBrowserGeneration() !== acquiredGen) {
      throw new Error('Browser was recycled during tab wait — retry');
    }
    page = await browser.newPage();
    
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      timeout: 30000
    });
    
    await page.close();
    page = null;
    releaseTab(taskId, 'generate');
    tabAcquired = false;
    
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Generated PDF is empty');
    }
    
    const pdfSize = pdfBuffer.length;
    
    // Upload to Storage (permanent)
    const fileName = `${normalizedDocumentId}.pdf`;
    const bucket = storage.bucket(STORAGE_BUCKET);
    const filePath = `companies/${companyId}/documents/${fileName}`;
    const file = bucket.file(filePath);
    
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          documentType,
          documentId: normalizedDocumentId,
          createdBy: uid,
          generatedAt: new Date().toISOString(),
          pdfSize: pdfSize.toString(),
        }
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    savedGeneratedFile = file;
    const [taskDownloadURL] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + GENERATED_TASK_URL_EXPIRATION * 1000,
    });
    const [emailDownloadURL] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + GENERATED_EMAIL_URL_EXPIRATION * 1000,
    });
    
    await completeSqlDocumentGeneration({
      companyId,
      documentId: documentDocId,
      storagePath: filePath,
      documentType,
    });
    await bumpCompanyDocumentsVersion(companyId);
    console.log(`[generate:${taskId}] Document finalized in SQL`, { documentType, documentNumber, userRole });
    documentFinalized = true;

    // ========================================================================
    // EMAIL DELIVERY TO CLIENT
    // ========================================================================
    let emailSent = false;
    let emailMessageId = null;
    let emailError = null;
    
    // Send email if client has email address
    if (client.email && client.email.trim()) {
      try {
        const emailService = getEmailServiceInstance();
        const documentTitle = getDocumentTitle(documentType, documentNumber || normalizedDocumentId, language || 'he');
        
        console.log(`[generate:${taskId}] Sending email to client`, {
          hasRecipientEmail: true,
          documentTitle,
          documentType,
        });
        
        const emailResult = await emailService.sendDocumentEmail({
          recipientEmail: client.email,
          recipientName: client.name,
          documentTitle,
          documentUrl: emailDownloadURL,
          language: language || 'he',
          businessInfo: company,
        });
        
        emailSent = emailResult.success;
        emailMessageId = emailResult.messageId;
        
        if (emailSent) {
          console.log(`[generate:${taskId}] Email sent successfully`, { messageId: emailMessageId });
        } else {
          console.warn(`[generate:${taskId}] Email failed`, { error: emailError });
        }
      } catch (emailErr) {
        console.error(`[generate:${taskId}] Email error:`, emailErr.message);
        emailError = emailErr.message;
      }
    } else {
      console.log(`[generate:${taskId}] No client email - skipping email delivery`);
    }
    
    const totalTime = Date.now() - startTime;
    
    try {
      await markSqlTaskCompleted(taskId, {
        taskType: 'generate',
        resultUrl: taskDownloadURL,
        storagePath: filePath,
        pdfSize,
        publicDocumentId: normalizedDocumentId,
        emailSent,
        emailMessageId,
        emailError,
        emailRecipient: client.email || null,
      });
    } catch (sqlTaskError) {
      console.warn(`[generate:${taskId}] Failed to mirror completed status to SQL`, { error: sqlTaskError.message });
    }
    
    console.log(`[generate:${taskId}] Completed`, { documentId: normalizedDocumentId, pdfSize, totalTime, emailSent });
    return { success: true, taskId, documentId: normalizedDocumentId, downloadURL: taskDownloadURL, pdfSize, emailSent };
    
  } catch (error) {
    console.error(`[generate:${taskId}] Failed:`, error.message);
    
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    if (tabAcquired) {
      releaseTab(taskId, 'generate');
    }

    if (savedGeneratedFile && !documentFinalized) {
      try {
        await savedGeneratedFile.delete({ ignoreNotFound: true });
        console.warn(`[generate:${taskId}] Deleted orphaned generated PDF after finalize failure`);
      } catch (cleanupError) {
        console.error(`[generate:${taskId}] Failed to delete orphaned generated PDF:`, cleanupError.message);
      }
    }
    
    if (companyId && finalizedDocumentCode) {
      try {
        await failSqlDocumentGeneration({
          companyId,
          documentId: finalizedDocumentCode,
          errorMessage: error.message,
        });
      } catch (sqlDocumentError) {
        console.warn(`[generate:${taskId}] Failed to mark document generation failure in SQL`, { error: sqlDocumentError.message });
      }
    }

    try {
      await markSqlTaskFailed(taskId, error.message);
    } catch (sqlTaskError) {
      console.warn(`[generate:${taskId}] Failed to mirror failed status to SQL`, { error: sqlTaskError.message });
    }
    
    throw error;
  }
}

// ============================================================================
// PUB/SUB PUSH ENDPOINTS
// ============================================================================


registerPreviewRoute(app, {
  verifyPubSubRequest,
  processPreviewTask,
  isTransientProcessingError,
});
registerGenerateRoute(app, {
  verifyPubSubRequest,
  processGenerateTask,
  isTransientProcessingError,
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (req, res) => {
  const browserStats = getBrowserPoolStats();
  const status = browserStats.hasBrowser && !browserStats.browserConnected ? 'degraded' : 'healthy';
  res.status(200).json({
    status,
    service: 'pdf-service',
    hasBrowser: browserStats.hasBrowser,
    browserConnected: browserStats.browserConnected,
    activeTabs: browserStats.activeTabs,
    maxConcurrentTabs: MAX_CONCURRENT_TABS,
    queuedWaiters: browserStats.queuedWaiters,
    maxTabWaiters: MAX_TAB_WAITERS,
  });
});

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`PDF Service listening on port ${PORT}`);
  console.log(`Endpoints: POST /preview, POST /generate, GET /health`);
  console.log(`Max concurrent tabs: ${MAX_CONCURRENT_TABS} (shared between preview & generate)`);
  console.log(`Tab wait timeout: ${TAB_WAIT_TIMEOUT}ms, max queued waiters: ${MAX_TAB_WAITERS}`);
});

// Graceful shutdown: drain in-flight work and close the browser before exiting.
function shutdown(signal: string) {
  return () => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      try {
        await browserPool.close();
        console.log('Browser pool closed');
      } catch (error) {
        console.error('Error during browser pool shutdown:', error);
      }
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long.
    setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 30000));
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
