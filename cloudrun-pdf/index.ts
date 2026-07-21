import express from 'express';

import { createBrowserPool, isTransientProcessingError } from './browser-pool';
import { createCompanyFileStorageFromEnv } from './company-file-storage';
import generateDocumentHTML from './htmlTemplate';
import { installStructuredLogging } from './logging';
import { createCompanyLogoFetcher } from './logo-cache';
import { hardenPdfPage } from './page-security';
import { hasLocalPlatformOverrides, isVerifiedLocalPlatform } from './local-platform';
import { persistPdfBeforeFinalize } from './pdf-storage-workflow';
import { createPubSubVerifier } from './pubsub-auth';
import { registerGenerateRoute } from './routes/generate';
import { registerPreviewRoute } from './routes/preview';
import { closeSharedSqlPool, isSharedSqlStoreEnabled } from './sql-store';
import {
  buildGeneratedDocumentObjectPath,
  buildPreviewObjectPath,
} from './storage-paths';
import {
  claimPdfDocumentTask,
  completePdfDocumentTask,
  failPdfDocumentTask,
  type CanonicalPdfTask,
} from './worker-store';

const { buildHtmlPayload } = require('./document-payload');

type DocumentDispatchMessage = { readonly taskId: string };

installStructuredLogging('cloudrun-pdf');

const app = express();
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));

const MAX_ITEMS_PER_DOCUMENT = 100;
const MAX_HTML_SIZE = 5 * 1024 * 1024;
const MAX_PDF_SIZE = 50 * 1024 * 1024;
const MAX_CONCURRENT_TABS = Math.max(
  1,
  Number(process.env.MAX_CONCURRENT_TABS || 2) || 2,
);
const TAB_WAIT_TIMEOUT = Math.max(
  1_000,
  Number(process.env.TAB_WAIT_TIMEOUT_MS || 10_000) || 10_000,
);
const MAX_TAB_WAITERS = Math.max(
  1,
  Number(process.env.MAX_TAB_WAITERS || 64) || 64,
);
const PROCESSING_LEASE_SECONDS = Math.min(
  900,
  Math.max(30, Number(process.env.DOCUMENT_TASK_PROCESSING_LEASE_SECONDS || 300) || 300),
);
const MAX_LOGO_SIZE = 1024 * 1024;
const CLOUD_RUN_SERVICE_URL = String(process.env.CLOUD_RUN_SERVICE_URL || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_LOCAL_PLATFORM = isVerifiedLocalPlatform();
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

if (hasLocalPlatformOverrides() && !IS_LOCAL_PLATFORM) {
  throw new Error('Local PDF overrides require the mounted local-platform marker');
}
if (IS_PRODUCTION && !IS_LOCAL_PLATFORM && !CLOUD_RUN_SERVICE_URL) {
  throw new Error('CLOUD_RUN_SERVICE_URL must be set in production for Pub/Sub OIDC verification');
}
if (IS_PRODUCTION && !IS_LOCAL_PLATFORM && PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0) {
  throw new Error('PUBSUB_ALLOWED_SERVICE_ACCOUNTS must include an allowed publisher in production');
}
if (!isSharedSqlStoreEnabled()) {
  throw new Error('cloudrun-pdf requires the smart_job_pdf DATABASE_URL');
}

const companyFileStorage = createCompanyFileStorageFromEnv();
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
  storage: companyFileStorage,
  maxLogoSize: MAX_LOGO_SIZE,
});

function requireDocumentData(task: CanonicalPdfTask): any {
  const data: any = task.documentData;
  if (!Array.isArray(data.items) || data.items.length < 1) {
    throw new TypeError('At least one canonical document item is required');
  }
  if (data.items.length > MAX_ITEMS_PER_DOCUMENT) {
    throw new TypeError(`Maximum ${MAX_ITEMS_PER_DOCUMENT} document items allowed`);
  }
  if (!data.client || typeof data.client !== 'object' || !String(data.client.name || '').trim()) {
    throw new TypeError('Canonical document client is invalid');
  }
  if (!data.company || typeof data.company !== 'object' || !String(data.company.name || '').trim()) {
    throw new TypeError('Canonical document company is invalid');
  }
  return data;
}

async function renderPdf(task: CanonicalPdfTask): Promise<Buffer> {
  let page: any = null;
  let tabAcquired = false;
  try {
    const acquiredGeneration = await acquireTab(task.taskId, task.taskType);
    tabAcquired = true;
    const data = requireDocumentData(task);
    const logoUrl = await fetchCompanyLogo(
      task.internalCompanyId,
      task.taskId,
      task.taskType,
    );
    const htmlPayload = buildHtmlPayload({
      documentType: task.documentType,
      documentData: data,
      documentNumber: task.documentNumber ?? data.documentNumber ?? task.documentCode ?? '',
      logoUrl,
      confirmationNumber: task.taskType === 'generate'
        ? task.confirmationNumber || ''
        : '',
    });
    const html = generateDocumentHTML(htmlPayload);
    const htmlSize = Buffer.byteLength(html, 'utf8');
    if (htmlSize > MAX_HTML_SIZE) {
      throw new TypeError(`Document HTML exceeds ${MAX_HTML_SIZE} bytes`);
    }

    const browser = await getBrowser();
    if (getBrowserGeneration() !== acquiredGeneration) {
      throw new Error('Browser was recycled during tab wait');
    }
    page = await browser.newPage();
    await hardenPdfPage(page);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    const bytes = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      timeout: 30_000,
    }));
    if (bytes.length < 1 || bytes.length > MAX_PDF_SIZE) {
      throw new TypeError('Generated PDF size is invalid');
    }
    return bytes;
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (tabAcquired) releaseTab(task.taskId, task.taskType);
  }
}

async function processDispatchedTask(message: DocumentDispatchMessage) {
  const task = await claimPdfDocumentTask(message.taskId, PROCESSING_LEASE_SECONDS);
  if (task === null) {
    return { success: true, taskId: message.taskId, skipped: true };
  }
  const startedAt = Date.now();
  try {
    const pdfBytes = await renderPdf(task);
    const objectPath = task.taskType === 'preview'
      ? buildPreviewObjectPath(task.internalCompanyId, task.userId, task.taskId)
      : buildGeneratedDocumentObjectPath(task.internalCompanyId, task.internalDocumentId);
    const persisted = await persistPdfBeforeFinalize({
      storage: companyFileStorage,
      objectPath,
      bytes: pdfBytes,
      metadata: {
        taskId: task.taskId,
        documentType: String(task.documentType),
        generatedAt: new Date().toISOString(),
        isPreview: String(task.taskType === 'preview'),
      },
      signedUrlExpiries: {},
      finalize: async () => completePdfDocumentTask(task, objectPath, pdfBytes.length),
    });
    console.log(`[${task.taskType}:${task.taskId}] completed`, {
      pdfSize: pdfBytes.length,
      elapsedMs: Date.now() - startedAt,
      reusedObject: !persisted.stored.created,
      emailDeliveryQueued: Boolean(persisted.finalizeResult.deliveryId),
    });
    return {
      success: true,
      taskId: task.taskId,
      pdfSize: pdfBytes.length,
    };
  } catch (error) {
    const retryable = isTransientProcessingError(error);
    await failPdfDocumentTask(task, error, retryable).catch((persistenceError) => {
      console.warn(`[${task.taskType}:${task.taskId}] failed to persist failure`, {
        error: persistenceError instanceof Error ? persistenceError.message : 'unknown',
      });
    });
    throw error;
  }
}

registerPreviewRoute(app, {
  verifyPubSubRequest,
  processPreviewTask: processDispatchedTask,
  isTransientProcessingError,
});
registerGenerateRoute(app, {
  verifyPubSubRequest,
  processGenerateTask: processDispatchedTask,
  isTransientProcessingError,
});

app.get('/health', async (_request, response) => {
  const browserStats = getBrowserPoolStats();
  const status = browserStats.hasBrowser && !browserStats.browserConnected
    ? 'degraded'
    : 'healthy';
  response.status(200).json({
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

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`PDF Service listening on port ${PORT}`);
});

function shutdown(signal: string) {
  return () => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      try {
        await browserPool.close();
        await closeSharedSqlPool();
      } catch (error) {
        console.error('Error during PDF worker shutdown:', error);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 30_000));
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
