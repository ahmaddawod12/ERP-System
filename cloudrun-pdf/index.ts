import express from 'express';
import { Storage } from '@google-cloud/storage';
import puppeteer from 'puppeteer';
import { createPublicKey, createVerify } from 'node:crypto';
import { getEmailServiceInstance, getDocumentTitle } from './emailService';
import generateDocumentHTML from './htmlTemplate';
import { bumpCompanyDocumentsVersion } from './company-sync-store';
import { OAuth2Client } from 'google-auth-library';

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

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function normalizeLogValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    };
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return value ?? null;
}

function writeStructuredLog(severity, fallbackMessage, firstArg, restArgs) {
  const payload: any = {
    severity,
    message: typeof firstArg === 'string' ? firstArg : fallbackMessage,
  };

  const fields: any = {};
  if (typeof firstArg !== 'string') {
    fields.arg0 = normalizeLogValue(firstArg);
  }

  restArgs.forEach((arg, index) => {
    const normalized = normalizeLogValue(arg);
    if (
      normalized &&
      typeof normalized === 'object' &&
      !Array.isArray(normalized)
    ) {
      Object.assign(fields, normalized);
      return;
    }

    fields[`arg${typeof firstArg === 'string' ? index + 1 : index + 1}`] = normalized;
  });

  if (Object.keys(fields).length > 0) {
    payload.fields = fields;
  }

  const line = JSON.stringify(payload);
  if (severity === 'ERROR') {
    rawConsole.error(line);
  } else if (severity === 'WARNING') {
    rawConsole.warn(line);
  } else {
    rawConsole.log(line);
  }
}

console.log = (firstArg, ...restArgs) => writeStructuredLog('INFO', 'cloudrun-pdf log', firstArg, restArgs);
console.warn = (firstArg, ...restArgs) => writeStructuredLog('WARNING', 'cloudrun-pdf warning', firstArg, restArgs);
console.error = (firstArg, ...restArgs) => writeStructuredLog('ERROR', 'cloudrun-pdf error', firstArg, restArgs);

const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
if (!STORAGE_BUCKET) {
  throw new Error('STORAGE_BUCKET environment variable is required');
}

// Initialize storage client.
const storage = new Storage();

const app = express();
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' }));

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

// In-memory logo cache: companyId -> { dataUrl, fetchedAt }
const logoCache = new Map();
const LOGO_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const LOGO_CACHE_MAX_SIZE = 100;

function evictLogoCacheIfNeeded() {
  if (logoCache.size <= LOGO_CACHE_MAX_SIZE) return;
  // Evict oldest entries by fetchedAt
  const sorted = [...logoCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const toRemove = sorted.slice(0, sorted.length - LOGO_CACHE_MAX_SIZE);
  for (const [key] of toRemove) logoCache.delete(key);
}


/** Document IDs are now plain Base62 — no prefix stripping needed. */
function toBaseDocumentId(documentId) {
  return String(documentId || '').trim();
}

/** Alias kept for call-site clarity (Firestore doc ID vs display ID). */
const toDocumentDocId = toBaseDocumentId;
// ============================================================================
// SHARED BROWSER MANAGEMENT (Singleton)
// ============================================================================
let browserInstance = null;
let activeTabs = 0;
let browserGeneration = 0; // Track browser instance generation for disconnect safety

// Promise-based tab queue to replace busy-wait polling
const tabWaiters = [];

function buildRetryableError(code, message) {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function decodeJwtSegment(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
}

function verifySelfSignedServiceAccountJwt(idToken, expectedAudience) {
  if (!EDGE_SERVICE_ACCOUNT_EMAIL || !EDGE_SERVICE_ACCOUNT_PRIVATE_KEY || !expectedAudience) {
    return false;
  }

  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    return false;
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtSegment(encodedHeader);
    const payload = decodeJwtSegment(encodedPayload);
    if (String(header?.alg || '') !== 'RS256') {
      return false;
    }

    const signer = String(payload?.iss || payload?.sub || '').trim().toLowerCase();
    const audience = String(payload?.aud || '').trim();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Number(payload?.exp || 0);
    const issuedAt = Number(payload?.iat || 0);
    if (!signer || signer !== EDGE_SERVICE_ACCOUNT_EMAIL) {
      return false;
    }
    if (audience !== expectedAudience) {
      return false;
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds - 30) {
      return false;
    }
    if (Number.isFinite(issuedAt) && issuedAt > nowSeconds + 30) {
      return false;
    }
    if (PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0) {
      console.warn('PUBSUB_ALLOWED_SERVICE_ACCOUNTS is empty — rejecting service-account JWT (fail closed)');
      return false;
    }
    if (!PUBSUB_ALLOWED_SERVICE_ACCOUNTS.includes(signer)) {
      console.warn('Service-account JWT rejected by allowlist', { signer });
      return false;
    }

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    const signature = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return verifier.verify(createPublicKey(EDGE_SERVICE_ACCOUNT_PRIVATE_KEY), signature);
  } catch (error) {
    console.warn('Service-account JWT verification failed:', error?.message || error);
    return false;
  }
}

function isTransientProcessingError(error) {
  const code = String(error?.code || '').trim().toLowerCase();
  if (code === 'tab_queue_full' || code === 'tab_wait_timeout') {
    return true;
  }
  const message = String(error?.message || '');
  return message.includes('retry') ||
    message.includes('Protocol error') ||
    message.includes('Navigation timeout') ||
    message.includes('Timeout');
}

/**
 * Get or create shared browser instance.
 * Tracks a generation counter so in-flight requests can detect stale browsers.
 */
async function getBrowser() {
  if (!browserInstance) {
    console.log('Launching new shared browser instance...');
    browserGeneration++;
    const myGeneration = browserGeneration;
    browserInstance = await puppeteer.launch({
      headless: true,
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
      // Reject all waiting tab requests so they can retry with a fresh browser
      while (tabWaiters.length > 0) {
        const waiter = tabWaiters.shift();
        waiter.reject(new Error('Browser disconnected while waiting for tab'));
      }
    });
  }
  return browserInstance;
}

/**
 * Acquire a browser tab slot using a promise-based queue.
 * Avoids CPU-wasting busy-wait polling.
 * Returns the browser generation at time of acquisition for disconnect safety.
 */
async function acquireTab(taskId, taskType) {
  if (activeTabs < MAX_CONCURRENT_TABS) {
    activeTabs++;
    console.log(`[${taskType}:${taskId}] Tab acquired. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);
    return browserGeneration;
  }

  if (tabWaiters.length >= MAX_TAB_WAITERS) {
    throw buildRetryableError(
      'tab_queue_full',
      `retry: browser tab queue full (${tabWaiters.length}/${MAX_TAB_WAITERS})`,
    );
  }

  // Queue a promise that will be resolved when a tab is released
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const idx = tabWaiters.findIndex(w => w.taskId === taskId);
      if (idx !== -1) tabWaiters.splice(idx, 1);
      reject(buildRetryableError('tab_wait_timeout', `retry: timeout waiting for available browser tab (${TAB_WAIT_TIMEOUT}ms)`));
    }, TAB_WAIT_TIMEOUT);

    tabWaiters.push({
      taskId,
      resolve: () => {
        clearTimeout(timeoutId);
        activeTabs++;
        console.log(`[${taskType}:${taskId}] Tab acquired (from queue). Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);
        resolve(browserGeneration);
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
    });
    console.log(`[${taskType}:${taskId}] Queued for tab. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}, waiting: ${tabWaiters.length}`);
  });
}

/**
 * Release a browser tab slot and wake the next waiter if any.
 */
function releaseTab(taskId, taskType) {
  if (activeTabs > 0) {
    activeTabs--;
  }
  console.log(`[${taskType}:${taskId}] Tab released. Active: ${activeTabs}/${MAX_CONCURRENT_TABS}`);

  // Wake the next queued waiter
  if (tabWaiters.length > 0 && activeTabs < MAX_CONCURRENT_TABS) {
    const next = tabWaiters.shift();
    next.resolve();
  }
}

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
  const expectedAudience = CLOUD_RUN_SERVICE_URL;

  let bearerVerified = false;
  // Factor 1: Check trusted bearer token if present (Google-issued ID token or edge-signed service-account JWT)
  const authHeader = req.headers['authorization'] || '';
  if (expectedAudience && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken) {
      try {
        // Verify the OIDC token; in production this is a Google-signed JWT
        // from the Pub/Sub push subscription's service account
        const client = new OAuth2Client();
        const ticket = await client.verifyIdToken({
          idToken,
          audience: expectedAudience,
        });
        const payload = ticket.getPayload();
        const issuer = String(payload?.iss || '');
        const email = String(payload?.email || '').toLowerCase();
        const issuerValid = issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com';
        const emailValid = Boolean(payload?.email_verified) && email.length > 0;
        // Fail closed: if allowlist is empty, reject all tokens
        if (PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0) {
          console.warn('PUBSUB_ALLOWED_SERVICE_ACCOUNTS is empty — rejecting OIDC token (fail closed)');
          return res.status(403).send('Service account allowlist not configured');
        }
        const serviceAccountAllowed = PUBSUB_ALLOWED_SERVICE_ACCOUNTS.includes(email);

        if (issuerValid && emailValid && serviceAccountAllowed) {
          bearerVerified = true;
        } else {
          console.warn('OIDC JWT rejected by claim validation', {
            issuer,
            email,
            hasAllowlist: PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length > 0,
          });
        }
      } catch (oidcError) {
        const selfSignedVerified = verifySelfSignedServiceAccountJwt(idToken, expectedAudience);
        if (selfSignedVerified) {
          bearerVerified = true;
        } else {
          console.warn('Trusted bearer verification failed:', oidcError.message);
        }
      }
    }
  } else if (!expectedAudience) {
    console.warn('CLOUD_RUN_SERVICE_URL is not set; bearer auth is disabled, using shared token fallback only');
  }

  if (expectedAudience && !bearerVerified) {
    return res.status(401).send('Trusted bearer token required');
  }

  // Factor 2: Check shared token (required in addition to OIDC when configured)
  if (!PUBSUB_VERIFICATION_TOKEN) {
    if (!expectedAudience) {
      console.warn('PUBSUB_VERIFICATION_TOKEN is unset and CLOUD_RUN_SERVICE_URL is not configured; allowing request in non-production mode');
    }
    return next();
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
// LOGO HELPER (cached, size-validated)
// ============================================================================

/**
 * Fetch and cache company logo as a base64 data URL.
 * Returns null if no logo exists, the logo is too large, or on error.
 */
async function fetchCompanyLogo(companyId, taskId, taskType) {
  if (!companyId) return null;

  // Check in-memory cache
  const cached = logoCache.get(companyId);
  if (cached && (Date.now() - cached.fetchedAt) < LOGO_CACHE_TTL) {
    console.log(`[${taskType}:${taskId}] Logo served from cache for ${companyId}`);
    return cached.dataUrl;
  }

  try {
    const bucket = storage.bucket(STORAGE_BUCKET);
    const logoPath = `companies/${companyId}/logo.png`;
    const logoFile = bucket.file(logoPath);
    const [exists] = await logoFile.exists();

    if (!exists) {
      console.log(`[${taskType}:${taskId}] No logo found at ${logoPath}`);
      logoCache.set(companyId, { dataUrl: null, fetchedAt: Date.now() });
      return null;
    }

    // Check size before downloading
    const [metadata] = await logoFile.getMetadata();
    const fileSize = parseInt(String(metadata.size), 10) || 0;
    if (fileSize > MAX_LOGO_SIZE) {
      console.warn(`[${taskType}:${taskId}] Logo too large (${fileSize} bytes, max ${MAX_LOGO_SIZE}). Skipping.`);
      logoCache.set(companyId, { dataUrl: null, fetchedAt: Date.now() });
      return null;
    }

    const [logoBuffer] = await logoFile.download();
    const base64Logo = logoBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64Logo}`;
    console.log(`[${taskType}:${taskId}] Logo converted to base64 (${logoBuffer.length} bytes) from ${logoPath}`);

    logoCache.set(companyId, { dataUrl, fetchedAt: Date.now() });
    evictLogoCacheIfNeeded();
    return dataUrl;
  } catch (logoError) {
    console.warn(`[${taskType}:${taskId}] Error fetching logo:`, logoError.message);
    return null;
  }
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
    if (browserGeneration !== acquiredGen) {
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
    if (browserGeneration !== acquiredGen) {
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

/**
 * POST /preview - Pub/Sub push endpoint for preview tasks
 */
app.post('/preview', verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(200).send('Invalid Pub/Sub message format — not retryable');
    }

    let messageData;
    try {
      messageData = JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString()
      );
    } catch (parseError) {
      return res.status(200).send('Invalid Pub/Sub message payload — not retryable');
    }
    
    console.log('Received preview task:', messageData.taskId);
    await processPreviewTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Preview task error:', error.message);
    // Return 200 for permanent failures to prevent infinite Pub/Sub retries.
    // Only transient errors (browser crash, timeout) should trigger retry via 500.
    const isTransient = isTransientProcessingError(error);
    const status = isTransient ? 500 : 200;
    res.status(status).send(`Error: ${error.message}`);
  }
});

/**
 * POST /generate - Pub/Sub push endpoint for generate tasks
 */
app.post('/generate', verifyPubSubRequest, async (req, res) => {
  try {
    if (!req.body || !req.body.message || !req.body.message.data) {
      return res.status(200).send('Invalid Pub/Sub message format — not retryable');
    }

    let messageData;
    try {
      messageData = JSON.parse(
        Buffer.from(req.body.message.data, 'base64').toString()
      );
    } catch (parseError) {
      return res.status(200).send('Invalid Pub/Sub message payload — not retryable');
    }
    
    console.log('Received generate task:', messageData.taskId);
    await processGenerateTask(messageData);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Generate task error:', error.message);
    // Return 200 for permanent failures to prevent infinite Pub/Sub retries.
    // Only transient errors (browser crash, timeout) should trigger retry via 500.
    const isTransient = isTransientProcessingError(error);
    const status = isTransient ? 500 : 200;
    res.status(status).send(`Error: ${error.message}`);
  }
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (req, res) => {
  let browserOk = false;
  if (browserInstance) {
    try {
      browserOk = browserInstance.isConnected();
    } catch (_) { /* browser disconnected */ }
  }
  const status = browserInstance && !browserOk ? 'degraded' : 'healthy';
  res.status(200).json({
    status,
    service: 'pdf-service',
    hasBrowser: !!browserInstance,
    browserConnected: browserOk,
    activeTabs,
    maxConcurrentTabs: MAX_CONCURRENT_TABS,
    queuedWaiters: tabWaiters.length,
    maxTabWaiters: MAX_TAB_WAITERS,
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
  console.log(`Tab wait timeout: ${TAB_WAIT_TIMEOUT}ms, max queued waiters: ${MAX_TAB_WAITERS}`);
});
