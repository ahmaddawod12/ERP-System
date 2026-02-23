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

const express = require('express');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

// Email service for document delivery
const { getEmailServiceInstance, getDocumentTitle } = require('./emailService');

// Initialize Firebase Admin with storage bucket (prefer env var over hardcoded default)
admin.initializeApp({
  storageBucket: process.env.STORAGE_BUCKET || 'cooling-inventory-5be04.firebasestorage.app'
});
const db = admin.firestore();
const storage = admin.storage();

const app = express();
app.use(express.json());

// ============================================================================
// CONSTANTS
// ============================================================================
const PREVIEW_URL_EXPIRATION = 60 * 60; // 1 hour in seconds
const MAX_ITEMS_PER_DOCUMENT = 100;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_TABS = 2; // Shared between preview and generate
const TAB_WAIT_TIMEOUT = 10000; // 10 seconds
const PUBSUB_VERIFICATION_TOKEN = process.env.PUBSUB_VERIFICATION_TOKEN || '';


function toBaseDocumentId(documentId) {
  const raw = String(documentId || '').trim();
  return raw.startsWith('c_') ? raw.slice(2) : raw;
}

function toCertificationDocId(documentId) {
  const baseId = toBaseDocumentId(documentId);
  return baseId ? `c_${baseId}` : '';
}
// ============================================================================
// SHARED BROWSER MANAGEMENT (Singleton)
// ============================================================================
let browserInstance = null;
let activeTabs = 0;

/**
 * Get or create shared browser instance
 * Browser is shared between preview and generate tasks
 */
async function getBrowser() {
  if (!browserInstance) {
    console.log('Launching new shared browser instance...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });
    
    browserInstance.on('disconnected', () => {
      console.log('Browser disconnected, will create new instance on next request');
      browserInstance = null;
      activeTabs = 0;
    });
  }
  return browserInstance;
}

/**
 * Acquire a browser tab slot (blocks until available)
 */
async function acquireTab(taskId, taskType) {
  const waitStartTime = Date.now();
  
  while (activeTabs >= MAX_CONCURRENT_TABS) {
    const waitElapsed = Date.now() - waitStartTime;
    
    if (waitElapsed > TAB_WAIT_TIMEOUT) {
      throw new Error(`Timeout waiting for available browser tab (${waitElapsed}ms)`);
    }
    
    console.log(`[${taskType}:${taskId}] Waiting for tab. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  activeTabs++;
  console.log(`[${taskType}:${taskId}] Tab acquired. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);
}

/**
 * Release a browser tab slot
 */
function releaseTab(taskId, taskType) {
  if (activeTabs > 0) {
    activeTabs--;
  }
  console.log(`[${taskType}:${taskId}] Tab released. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);
}

// ============================================================================
// HTML TEMPLATE GENERATOR
// ============================================================================
const generateDocumentHTML = require('./htmlTemplate');

/**
 * Request verification for Pub/Sub push endpoints.
 * P0-4: Two-factor auth model:
 * 1. Primary: Verify Pub/Sub OIDC JWT from Authorization: Bearer header
 * 2. Secondary: Verify shared PUBSUB_VERIFICATION_TOKEN from x-pubsub-token header
 * 
 * In production, Cloud Run should be deployed with --no-allow-unauthenticated,
 * and Pub/Sub subscriptions should use OIDC push authentication with a
 * service account that has roles/run.invoker.
 */
async function verifyPubSubRequest(req, res, next) {
  // Factor 1: Check OIDC JWT if present (primary auth in production)
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken) {
      try {
        // Verify the OIDC token — in production this is a Google-signed JWT
        // from the Pub/Sub push subscription's service account
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client();
        const ticket = await client.verifyIdToken({
          idToken,
          audience: process.env.CLOUD_RUN_SERVICE_URL || undefined,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email_verified) {
          // Valid OIDC token — allow request
          return next();
        }
      } catch (oidcError) {
        console.warn('OIDC JWT verification failed:', oidcError.message);
        // Fall through to check shared token
      }
    }
  }

  // Factor 2: Check shared token (required if OIDC not present/valid)
  if (!PUBSUB_VERIFICATION_TOKEN) {
    console.error('PUBSUB_VERIFICATION_TOKEN is missing - refusing requests');
    return res.status(503).send('Service misconfigured');
  }

  // Only accept token from header (not query string) to reduce leakage risk
  const token = String(req.headers['x-pubsub-token'] || '').trim();
  if (token !== PUBSUB_VERIFICATION_TOKEN) {
    console.warn('Rejected unauthenticated Pub/Sub request', {
      hasHeader: !!req.headers['x-pubsub-token'],
      hasOidc: !!authHeader,
      ip: req.ip,
    });
    return res.status(401).send('Unauthorized');
  }

  return next();
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
    await acquireTab(taskId, 'preview');
    tabAcquired = true;
    
    const { type, client, items, company, language, documentNumber, date, notes } = documentData;
    
    // Validate items
    if (items && items.length > MAX_ITEMS_PER_DOCUMENT) {
      throw new Error(`Maximum ${MAX_ITEMS_PER_DOCUMENT} items allowed`);
    }
    
    // Fetch logo from Firebase Storage
    let logoUrl = null;
    if (companyId) {
      try {
        const bucket = storage.bucket();
        const logoPath = `companies/${companyId}/logo.png`;
        const logoFile = bucket.file(logoPath);
        const [exists] = await logoFile.exists();
        
        if (exists) {
          // Download the logo file content
          const [logoBuffer] = await logoFile.download();
          // Convert to base64 data URL
          const base64Logo = logoBuffer.toString('base64');
          logoUrl = `data:image/png;base64,${base64Logo}`;
          console.log(`[preview:${taskId}] Logo converted to base64 (${logoBuffer.length} bytes) from ${logoPath}`);
        } else {
          console.log(`[preview:${taskId}] No logo found at ${logoPath}`);
        }
      } catch (logoError) {
        console.warn(`[preview:${taskId}] Error fetching logo:`, logoError.message);
      }
    }
    
    // Generate HTML - for preview, confirmationNumber is empty (not yet approved by Tax Authority)
    const html = generateDocumentHTML({
      type: type || documentType,
      client,
      items,
      company,
      language: language || 'he',
      documentNumber,
      date,
      notes,
      logoUrl,
      confirmationNumber: '', // Empty for preview - will be filled after Tax Authority approval
    });
    
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_HTML_SIZE) {
      throw new Error(`Document HTML too large (${htmlSize} bytes)`);
    }
    
    // Generate PDF using shared browser
    const browser = await getBrowser();
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
    
    const bucket = storage.bucket();
    const file = bucket.file(filePath);
    const downloadToken = uuidv4();
    
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
          firebaseStorageDownloadTokens: downloadToken
        }
      }
    });
    
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
    
    const totalTime = Date.now() - startTime;
    
    // Update task status
    await db.collection('documentTasks').doc(taskId).update({
      status: 'completed',
      previewURL: downloadUrl,
      storagePath: filePath,
      pdfSize,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingTimeMs: totalTime,
      expiresAt: new Date(Date.now() + PREVIEW_URL_EXPIRATION * 1000).toISOString()
    });
    
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
      await db.collection('documentTasks').doc(taskId).update({
        status: 'failed',
        error: error.message,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        processingTimeMs: Date.now() - startTime
      });
    } catch (updateError) {
      console.error(`[preview:${taskId}] Failed to update task status:`, updateError.message);
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
    confirmationNumber, // Tax Authority confirmation number for tax invoices
    userRole: claimedUserRole, // Untrusted role from message (for diagnostics only)
  } = taskData;

  const startTime = Date.now();
  let page = null;
  let tabAcquired = false;
  let userRole = null;
  
  try {
    if (!uid || !companyId) {
      throw new Error('Missing required task identity fields (uid/companyId)');
    }

    // P0-5: Idempotency — check task state before processing.
    // If task is already processing/completed, skip to prevent duplicate side effects.
    const taskRef = db.collection('documentTasks').doc(taskId);
    const taskSnap = await taskRef.get();
    if (taskSnap.exists) {
      const taskState = taskSnap.data()?.status;
      if (taskState === 'completed' || taskState === 'failed') {
        console.log(`[generate:${taskId}] Skipping — already in terminal state: ${taskState}`);
        return { success: true, taskId, skipped: true, reason: `already_${taskState}` };
      }
      if (taskState === 'processing') {
        console.log(`[generate:${taskId}] Skipping — already processing (possible redelivery)`);
        return { success: true, taskId, skipped: true, reason: 'already_processing' };
      }
    }

    // CAS transition: queued → processing (reject if not in queued state)
    try {
      await taskRef.update({
        status: 'processing',
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (casError) {
      console.warn(`[generate:${taskId}] CAS update failed, likely concurrent delivery`, casError.message);
      return { success: true, taskId, skipped: true, reason: 'cas_conflict' };
    }

    // Resolve requester role/company from Firestore, never from Pub/Sub payload.
    // Canonical path: users/{uid}/data/profile
    const requesterProfileSnap = await db.doc(`users/${uid}/data/profile`).get();
    if (!requesterProfileSnap.exists) {
      throw new Error(`Requester profile not found for uid: ${uid}`);
    }
    const requesterProfile = requesterProfileSnap.data() || {};
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

    await acquireTab(taskId, 'generate');
    tabAcquired = true;
    
    if (!documentId) {
      throw new Error('Document ID is required');
    }
    const normalizedDocumentId = toBaseDocumentId(documentId);
    const certificationDocId = toCertificationDocId(documentId);
    if (!normalizedDocumentId || !certificationDocId) {
      throw new Error('Invalid document ID');
    }
    
    if (!documentData) {
      throw new Error('Document data is required');
    }
    
    const { client, items, company, language, date, notes, totals } = documentData;
    
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
    
    // Fetch logo from Firebase Storage
    let logoUrl = null;
    if (companyId) {
      try {
        const bucket = storage.bucket();
        const logoPath = `companies/${companyId}/logo.png`;
        const logoFile = bucket.file(logoPath);
        const [exists] = await logoFile.exists();
        
        if (exists) {
          // Download the logo file content
          const [logoBuffer] = await logoFile.download();
          // Convert to base64 data URL
          const base64Logo = logoBuffer.toString('base64');
          logoUrl = `data:image/png;base64,${base64Logo}`;
          console.log(`[generate:${taskId}] Logo converted to base64 (${logoBuffer.length} bytes) from ${logoPath}`);
        } else {
          console.log(`[generate:${taskId}] No logo found at ${logoPath}`);
        }
      } catch (logoError) {
        console.warn(`[generate:${taskId}] Error fetching logo:`, logoError.message);
      }
    }
    
    // Generate HTML with all document data including confirmation number
    const html = generateDocumentHTML({
      type: documentType,
      client,
      items,
      company,
      language: language || 'he',
      documentNumber: documentNumber || normalizedDocumentId,
      date,
      notes,
      logoUrl,
      confirmationNumber, // Tax Authority confirmation number (מספר הקצאה)
    });
    
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_HTML_SIZE) {
      throw new Error('Document HTML too large');
    }
    
    // Generate PDF using shared browser
    const browser = await getBrowser();
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
    const bucket = storage.bucket();
    const yearMonth = date ? date.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const filePath = `companies/${companyId}/${yearMonth}/${normalizedDocumentId}/${fileName}`;
    const file = bucket.file(filePath);
    const downloadToken = uuidv4();
    
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          documentType,
          documentId: normalizedDocumentId,
          createdBy: uid,
          generatedAt: new Date().toISOString(),
          pdfSize: pdfSize.toString(),
          firebaseStorageDownloadTokens: downloadToken
        }
      }
    });
    
    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
    
    // Determine cache path based on user role
    // manager: companies/{companyId}/business_data/cache
    // user/basic/dev: users/{uid}/data/cache
    const getCachePath = () => {
      if (userRole === 'manager') {
        return `companies/${companyId}/business_data/cache`;
      } else {
        return `users/${uid}/data/cache`;
      }
    };
    const cachePath = getCachePath();
    console.log(`[generate:${taskId}] Using cache path: ${cachePath} for role: ${userRole}`);
    
    // Save/update certification data
    const certificationRef = db.doc(`companies/${companyId}/certifications/${certificationDocId}`);
    const isNewDocument = documentType !== 305;
    
    if (isNewDocument) {
      await certificationRef.set({
        type: documentType,
        clientName: client.name,
        clientEmail: client.email || null,
        clientPhone: client.phone || null,
        clientAddress: client.address || null,
        ...(client.clientId && { clientId: client.clientId }),
        ...(client.id && !client.clientId && { clientId: client.id }),
        items: items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          id: item.partId || null,
        })),
        notes: notes || null,
        createdBy: uid,
        createdAt: (new Date()).toISOString(),
        totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
        vatAmount: Math.round(vatAmount * 100) / 100,
        totalWithVat: Math.round(totalWithVat * 100) / 100,
        downloadURL,
        storagePath: filePath,
      });
      // NOTE: document_numbers counter is already incremented transactionally
      // in publishGenerateTask Cloud Function. Do NOT increment here again
      // to avoid double-counting.
      console.log(`[generate:${taskId}] Document saved (counter already incremented by CF)`, { documentType, documentNumber, userRole });
    } else {
      await certificationRef.update({
        downloadURL,
        storagePath: filePath,
      });
    }
    
    // Update certification cache version based on role
    await db.doc(cachePath).set({
      [certificationDocId]: 1,
      lastUpdated: new Date().toISOString(),
    }, { merge: true });
    console.log(`[generate:${taskId}] Updated certification cache at ${cachePath}`);

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
          to: client.email,
          documentTitle,
          documentType,
        });
        
        const emailResult = await emailService.sendDocumentEmail({
          recipientEmail: client.email,
          recipientName: client.name,
          documentTitle,
          documentUrl: downloadURL,
          language: language || 'he',
          businessInfo: company,
        });
        
        emailSent = emailResult.success;
        emailMessageId = emailResult.messageId;
        emailError = emailResult.error;
        
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
    
    // Update task status with email delivery info
    // Ensure no undefined values are passed to Firestore
    await db.collection('documentTasks').doc(taskId).update({
      status: 'completed',
      documentId: normalizedDocumentId,
      downloadURL,
      storagePath: filePath,
      pdfSize,
      completedAt: (new Date()).toISOString(),
      processingTimeMs: totalTime,
      isNewDocument,
      // Email delivery tracking (never undefined)
      emailSent: emailSent === true,
      emailMessageId: emailMessageId || null,
      emailError: emailError || null,
      emailRecipient: client.email || null,
    });
    
    console.log(`[generate:${taskId}] Completed`, { documentId: normalizedDocumentId, pdfSize, totalTime, emailSent });
    return { success: true, taskId, documentId: normalizedDocumentId, downloadURL, pdfSize, emailSent };
    
  } catch (error) {
    console.error(`[generate:${taskId}] Failed:`, error.message);
    
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
    if (tabAcquired) {
      releaseTab(taskId, 'generate');
    }
    
    try {
      await db.collection('documentTasks').doc(taskId).update({
        status: 'failed',
        error: error.message,
        completedAt: (new Date()).toISOString(),
        processingTimeMs: Date.now() - startTime
      });
    } catch (updateError) {
      console.error(`[generate:${taskId}] Failed to update task status:`, updateError.message);
    }
    
    throw error;
  }
}

// ============================================================================
// PUB/SUB PUSH ENDPOINTS
// ============================================================================

/**
 * POST /preview - Pub/Sub push endpoint for preview tasks
 */
app.post('/preview', verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(400).send('Invalid Pub/Sub message format');
    }

    let messageData;
    try {
      messageData = JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString()
      );
    } catch (parseError) {
      return res.status(400).send('Invalid Pub/Sub message payload');
    }
    
    console.log('Received preview task:', messageData.taskId);
    await processPreviewTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Preview task error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

/**
 * POST /generate - Pub/Sub push endpoint for generate tasks
 */
app.post('/generate', verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(400).send('Invalid Pub/Sub message format');
    }

    let messageData;
    try {
      messageData = JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString()
      );
    } catch (parseError) {
      return res.status(400).send('Invalid Pub/Sub message payload');
    }
    
    console.log('Received generate task:', messageData.taskId);
    await processGenerateTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Generate task error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'pdf-service',
    activeTabs,
    maxTabs: MAX_CONCURRENT_TABS,
    hasBrowser: !!browserInstance,
    endpoints: ['/preview', '/generate', '/health']
  });
});

// ============================================================================
// START SERVER
// ============================================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`PDF Service listening on port ${PORT}`);
  console.log(`Endpoints: POST /preview, POST /generate, GET /health`);
  console.log(`Max concurrent tabs: ${MAX_CONCURRENT_TABS} (shared between preview & generate)`);
});
