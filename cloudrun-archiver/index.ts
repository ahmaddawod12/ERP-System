import { Storage } from '@google-cloud/storage';
import { createHash } from 'crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteArchivedDocumentsByIds,
  deleteArchivedJobsByIds,
  listArchivedCompanyDocumentsPage,
  listArchivedCompanyJobsPage,
  listCompanyPublicIds,
  recordArchiveRun,
} from '@smart-job/db';
import { getTargetMonth } from './archive-month';
import { runUploadCleanupStartup } from './upload-cleanup';
import { assertArchiverRuntimeConfig } from './local-platform';

/**
 * Cloud Run Job: Firestore → Cloud Storage Archiver
 * 
 * Purpose: Migrate old finished jobs and documents from Firestore to Cloud Storage
 * to reduce Firestore storage costs. Data older than ~6 months is archived as monthly
 * JSON files in Cloud Storage, then deleted from Firestore.
 * 
 * Data Tiering:
 * - 0-90 days: MMKV local cache (on device)
 * - 90-180 days: Firestore (live queries)
 * - 180+ days: Cloud Storage (monthly JSON archives)
 * 
 * Schedule: Runs at the start of each month via Cloud Scheduler
 * 
 * Storage Structure:
 *   gs://{bucket}/companies/{companyId}/archives/{YYYY}-{M}-j.json  (finished jobs)
 *   gs://{bucket}/companies/{companyId}/archives/{YYYY}-{M}-d.json  (documents)
 * 
 * Manifest (idempotency tracking):
 *   gs://{bucket}/companies/{companyId}/archives/manifest.json
 * 
 * Safety:
 * - Idempotent: checks manifest before re-archiving a month
 * - Upload-before-delete: data is verified in Storage before Firestore deletion
 * - Batch deletes: uses Firestore batched writes (max 500 per batch)
 * - Logging: comprehensive logging for audit trail
 * - Partial failure safe: each company/month is independent
 */


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

console.log = (firstArg, ...restArgs) => writeStructuredLog('INFO', 'cloudrun-archiver log', firstArg, restArgs);
console.warn = (firstArg, ...restArgs) => writeStructuredLog('WARNING', 'cloudrun-archiver warning', firstArg, restArgs);
console.error = (firstArg, ...restArgs) => writeStructuredLog('ERROR', 'cloudrun-archiver error', firstArg, restArgs);

// ============================================================================
// CONFIGURATION
// ============================================================================
assertArchiverRuntimeConfig();
const BUCKET_NAME = process.env.ARCHIVE_BUCKET;
if (!BUCKET_NAME) {
  throw new Error('ARCHIVE_BUCKET environment variable is required');
}
const MONTHS_LOOKBACK = 6; // Archive data older than 6 months
const QUERY_PAGE_SIZE = Math.max(100, Number(process.env.ARCHIVER_QUERY_PAGE_SIZE || 5000) || 5000); // Docs per paginated query
const COMPANY_ARCHIVE_CONCURRENCY = Math.max(1, Number(process.env.ARCHIVER_COMPANY_CONCURRENCY || 3) || 3);

// ============================================================================
// INITIALIZATION
// ============================================================================
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

// ============================================================================
// MONTH CALCULATION
// ============================================================================

/**
 * Calculate the target archive month (6 months before current month).
 * 
 * Examples (when job runs):
 * - Running in July 2026 → archives January 2026 (month 1)
 * - Running in March 2026 → archives September 2025 (month 9, previous year)
 * - Running in January 2027 → archives July 2026 (month 7)
 * 
 * @returns {{ year: number, month: number, startDate: Date, endDate: Date }}
 */
// ============================================================================
// MANIFEST MANAGEMENT (Idempotency)
// ============================================================================

/**
 * Load the manifest for a company.
 * The manifest tracks which months have been successfully archived.
 * 
 * Format: { "2026-1-j": { archivedAt, docCount }, "2026-1-d": { archivedAt, docCount } }
 */
async function loadManifest(companyId) {
  const manifestPath = `companies/${companyId}/archives/manifest.json`;
  const file = bucket.file(manifestPath);

  try {
    const [exists] = await file.exists();
    if (!exists) return {};

    const [content] = await file.download();
    const parsed = JSON.parse(content.toString('utf8'));

    // Validate manifest structure: must be a plain object with string keys
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn(`⚠️ Corrupt manifest for ${companyId} (not an object), starting fresh`);
      return {};
    }

    return parsed;
  } catch (error) {
    console.warn(`⚠️ Could not load manifest for ${companyId}, starting fresh:`, error.message);
    return {};
  }
}

/**
 * Save the manifest for a company.
 */
async function saveManifest(companyId, manifest) {
  const manifestPath = `companies/${companyId}/archives/manifest.json`;
  const file = bucket.file(manifestPath);

  await file.save(JSON.stringify(manifest, null, 2), {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'no-cache',
    },
  });

  console.log(`📋 Manifest saved for ${companyId}`);
}

// ============================================================================
// ARCHIVE & DELETE
// ============================================================================

/**
 * Upload a JSON archive to Cloud Storage.
 * 
 * @param {string} companyId 
 * @param {string} archiveKey - e.g., "2026-1-j" or "2026-1-d"
 * @param {Array} documents - The documents to archive
 * @returns {string} - Storage path of the uploaded file
 */
async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function finishStream(stream) {
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.end(() => resolve());
  });
}

async function hashStoredArchive(file) {
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return digest.digest('hex');
}

function buildArchiveQueryOptions(target, afterCursor = null) {
  return {
    dateFrom: target.startDate.toISOString(),
    dateTo: target.endDate.toISOString(),
    pageSize: QUERY_PAGE_SIZE,
    ...(afterCursor ? { afterCursor } : {}),
  };
}

async function loadArchivePage(companyId, target, kind, afterCursor = null) {
  const queryOptions = kind === 'finishedJobs'
    ? {
      ...buildArchiveQueryOptions(target, afterCursor),
      status: 'finished',
      dateField: 'finishedAt',
    }
    : {
      ...buildArchiveQueryOptions(target, afterCursor),
      dateField: 'createdAt',
    };

  return kind === 'finishedJobs'
    ? await listArchivedCompanyJobsPage(companyId, queryOptions)
    : await listArchivedCompanyDocumentsPage(companyId, queryOptions);
}

async function writeArchivePayload(tempFilePath, companyId, archiveKey, target, kind) {
  const stream = createWriteStream(tempFilePath, { encoding: 'utf8' });
  const checksum = createHash('sha256');
  const docIds = [];
  let docCount = 0;
  let pageCount = 0;
  let firstRecord = true;
  let afterCursor = null;
  const seenCursors = new Set();

  const writeJsonChunk = async (chunk) => {
    checksum.update(chunk);
    await writeChunk(stream, chunk);
  };

  try {
    await writeJsonChunk('[');

    while (true) {
      const page = await loadArchivePage(companyId, target, kind, afterCursor);
      const records = Array.isArray(page?.items) ? page.items : [];
      pageCount += 1;

      for (const record of records) {
        const serialized = JSON.stringify(record);
        await writeJsonChunk(firstRecord ? serialized : `,${serialized}`);
        firstRecord = false;
        docCount += 1;
        docIds.push(record.id);
      }

      if (!page?.nextCursor) {
        break;
      }

      if (seenCursors.has(page.nextCursor)) {
        throw new Error(`Archive cursor loop detected for ${companyId}/${archiveKey}`);
      }

      seenCursors.add(page.nextCursor);
      afterCursor = page.nextCursor;
    }

    await writeJsonChunk(']');
    await finishStream(stream);

    return {
      archivedAt: new Date().toISOString(),
      checksum: checksum.digest('hex'),
      docCount,
      docIds,
      pageCount,
    };
  } catch (error) {
    stream.destroy(error as Error);
    throw error;
  }
}

async function uploadArchive(companyId, archiveKey, target, kind) {
  const storagePath = `companies/${companyId}/archives/${archiveKey}.json`;
  const tempDir = await mkdtemp(join(tmpdir(), 'smart-job-archive-'));
  const tempFilePath = join(tempDir, `${archiveKey}.json`);

  try {
    const payload = await writeArchivePayload(tempFilePath, companyId, archiveKey, target, kind);
    if (payload.docCount === 0) {
      return null;
    }

    await bucket.upload(tempFilePath, {
      destination: storagePath,
      metadata: {
        contentType: 'application/json',
        cacheControl: 'no-cache',
        metadata: {
          docCount: String(payload.docCount),
          archiveKey,
          companyId,
          archivedAt: payload.archivedAt,
          sha256: payload.checksum,
        },
      },
    });

    console.log(`📦 Uploaded ${storagePath} (${payload.docCount} docs across ${payload.pageCount} pages)`);
    return {
      ...payload,
      storagePath,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Verify that an archive exists in Storage and matches expected doc count.
 */
async function verifyArchive(companyId, archiveKey, expectedCount) {
  const storagePath = `companies/${companyId}/archives/${archiveKey}.json`;
  const file = bucket.file(storagePath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Archive verification failed: ${storagePath} does not exist`);
  }

  const [metadata] = await file.getMetadata();
  const storedDocCount = Number(metadata?.metadata?.docCount || 0);
  if (storedDocCount !== expectedCount) {
    throw new Error(
      `Archive verification failed: ${storagePath} metadata has ${storedDocCount} docs, expected ${expectedCount}`
    );
  }

  const storedChecksum = metadata?.metadata?.sha256;
  if (storedChecksum) {
    const actualChecksum = await hashStoredArchive(file);
    if (actualChecksum !== storedChecksum) {
      throw new Error(`Archive integrity check failed: ${storagePath} checksum mismatch`);
    }
  }

  console.log(`✅ Archive verified: ${storagePath} (${storedDocCount} docs)`);
  return {
    storagePath,
    checksum: storedChecksum || null,
  };
}

async function deleteArchiveRecords(companyId, kind, recordIds) {
  return kind === 'finishedJobs'
    ? await deleteArchivedJobsByIds(companyId, recordIds)
    : await deleteArchivedDocumentsByIds(companyId, recordIds);
}

function buildDeletedManifestEntry(existingEntry, deletedCount, expectedCount, verified = false) {
  const allGone = deletedCount === expectedCount || (verified && deletedCount === 0);
  if (!allGone) {
    return {
      ...existingEntry,
      deletedCount,
      status: 'uploaded_not_deleted',
      lastDeleteAttemptAt: new Date().toISOString(),
    };
  }

  return {
    ...existingEntry,
    archivedAt: existingEntry.archivedAt,
    docCount: expectedCount,
    deletedCount: verified ? expectedCount : deletedCount,
    status: 'deleted',
    deletedAt: new Date().toISOString(),
  };
}

// ============================================================================
// PROCESS ONE COMPANY
// ============================================================================

/**
 * Archive old data for a single company.
 * 
 * @param {string} companyId
 * @param {{ year: number, month: number, startDate: Date, endDate: Date }} target
 */
async function processCompany(companyId, target) {
  const { year, month, startDate, endDate } = target;
  console.log(`\n🏢 Processing company: ${companyId} | Target: ${year}-${month}`);

  const manifest = await loadManifest(companyId);
  let manifestUpdated = false;

  // ---- FINISHED JOBS ----
  const finishedKey = `${year}-${month}-j`;
  if (manifest[finishedKey] && manifest[finishedKey].status !== 'uploaded_not_deleted') {
    console.log(`⏭️ ${finishedKey} already archived (${manifest[finishedKey].docCount} docs on ${manifest[finishedKey].archivedAt})`);
  } else {
    if (manifest[finishedKey]?.status === 'uploaded_not_deleted' && Array.isArray(manifest[finishedKey].docIds)) {
      const verifiedArchive = await verifyArchive(companyId, finishedKey, manifest[finishedKey].docCount);
      const deleted = await deleteArchiveRecords(companyId, 'finishedJobs', manifest[finishedKey].docIds);
      manifest[finishedKey] = buildDeletedManifestEntry(manifest[finishedKey], deleted, manifest[finishedKey].docIds.length, true);
      await recordArchiveRun(companyId, finishedKey, 'jobs', {
        status: manifest[finishedKey].status,
        docCount: manifest[finishedKey].docCount,
        deletedCount: manifest[finishedKey].deletedCount || 0,
        storagePath: verifiedArchive.storagePath,
        checksum: verifiedArchive.checksum,
        completedAt: manifest[finishedKey].status === 'deleted' ? new Date().toISOString() : null,
      });
      manifestUpdated = true;
    } else {
      const archive = await uploadArchive(companyId, finishedKey, target, 'finishedJobs');

      if (!archive) {
        console.log(`📭 No finished jobs found for ${year}-${month}`);
        manifest[finishedKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
        manifestUpdated = true;
      } else {
        console.log(`📊 Found ${archive.docCount} finished jobs for ${year}-${month}`);

        await verifyArchive(companyId, finishedKey, archive.docCount);
        const storagePath = `companies/${companyId}/archives/${finishedKey}.json`;
        manifest[finishedKey] = {
          archivedAt: archive.archivedAt,
          docCount: archive.docCount,
          status: 'uploaded_not_deleted',
          docIds: archive.docIds,
          storagePath,
          checksum: archive.checksum || null,
        };
        await saveManifest(companyId, manifest);
        await recordArchiveRun(companyId, finishedKey, 'jobs', {
          status: 'uploaded_not_deleted',
          docCount: archive.docCount,
          storagePath,
          checksum: archive.checksum || null,
        });

        const deleted = await deleteArchivedJobsByIds(companyId, archive.docIds);
        console.log(`✅ Archived and deleted ${deleted} finished jobs for ${year}-${month}`);

        manifest[finishedKey] = buildDeletedManifestEntry({
          archivedAt: archive.archivedAt,
          docCount: archive.docCount,
          status: 'uploaded_not_deleted',
          docIds: archive.docIds,
          storagePath,
          checksum: archive.checksum || null,
        }, deleted, archive.docCount);
        await recordArchiveRun(companyId, finishedKey, 'jobs', {
          status: manifest[finishedKey].status,
          docCount: archive.docCount,
          deletedCount: deleted,
          storagePath,
          checksum: archive.checksum || null,
          completedAt: manifest[finishedKey].status === 'deleted' ? new Date().toISOString() : null,
        });
        manifestUpdated = true;
      }
    }
  }

  // ---- DOCUMENTS ----
  const documentsKey = `${year}-${month}-d`;
  if (manifest[documentsKey] && manifest[documentsKey].status !== 'uploaded_not_deleted') {
    console.log(`⏭️ ${documentsKey} already archived (${manifest[documentsKey].docCount} docs on ${manifest[documentsKey].archivedAt})`);
  } else {
    if (manifest[documentsKey]?.status === 'uploaded_not_deleted' && Array.isArray(manifest[documentsKey].docIds)) {
      const verifiedArchive = await verifyArchive(companyId, documentsKey, manifest[documentsKey].docCount);
      const deleted = await deleteArchiveRecords(companyId, 'documents', manifest[documentsKey].docIds);
      manifest[documentsKey] = buildDeletedManifestEntry(manifest[documentsKey], deleted, manifest[documentsKey].docIds.length, true);
      await recordArchiveRun(companyId, documentsKey, 'documents', {
        status: manifest[documentsKey].status,
        docCount: manifest[documentsKey].docCount,
        deletedCount: manifest[documentsKey].deletedCount || 0,
        storagePath: verifiedArchive.storagePath,
        checksum: verifiedArchive.checksum,
        completedAt: manifest[documentsKey].status === 'deleted' ? new Date().toISOString() : null,
      });
      manifestUpdated = true;
    } else {
      const archive = await uploadArchive(companyId, documentsKey, target, 'documents');

      if (!archive) {
        console.log(`📭 No documents found for ${year}-${month}`);
        manifest[documentsKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
        manifestUpdated = true;
      } else {
        console.log(`📊 Found ${archive.docCount} documents for ${year}-${month}`);

        await verifyArchive(companyId, documentsKey, archive.docCount);
        const storagePath = `companies/${companyId}/archives/${documentsKey}.json`;
        manifest[documentsKey] = {
          archivedAt: archive.archivedAt,
          docCount: archive.docCount,
          status: 'uploaded_not_deleted',
          docIds: archive.docIds,
          storagePath,
          checksum: archive.checksum || null,
        };
        await saveManifest(companyId, manifest);
        await recordArchiveRun(companyId, documentsKey, 'documents', {
          status: 'uploaded_not_deleted',
          docCount: archive.docCount,
          storagePath,
          checksum: archive.checksum || null,
        });

        const deleted = await deleteArchiveRecords(companyId, 'documents', archive.docIds);
        console.log(`✅ Archived and deleted ${deleted} documents for ${year}-${month}`);

        manifest[documentsKey] = buildDeletedManifestEntry({
          archivedAt: archive.archivedAt,
          docCount: archive.docCount,
          status: 'uploaded_not_deleted',
          docIds: archive.docIds,
          storagePath,
          checksum: archive.checksum || null,
        }, deleted, archive.docCount);
        await recordArchiveRun(companyId, documentsKey, 'documents', {
          status: manifest[documentsKey].status,
          docCount: archive.docCount,
          deletedCount: deleted,
          storagePath,
          checksum: archive.checksum || null,
          completedAt: manifest[documentsKey].status === 'deleted' ? new Date().toISOString() : null,
        });
        manifestUpdated = true;
      }
    }
  }

  // Save manifest if anything changed
  if (manifestUpdated) {
    await saveManifest(companyId, manifest);
  }

  console.log(`✅ Company ${companyId} processing complete\n`);
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Smart-Job Archiver - Active Backend → Cloud Storage Migration');
  console.log('='.repeat(60));

  // File cleanup is an independent maintenance phase. Its helper catches and
  // reports failures so monthly GCS archive work always continues.
  await runUploadCleanupStartup();

  const target = getTargetMonth(new Date(), MONTHS_LOOKBACK);
  console.log(`📅 Target month: ${target.year}-${target.month}`);
  console.log(`📅 Date range: ${target.startDate.toISOString()} → ${target.endDate.toISOString()}`);
  console.log('🗄️ Persistence backend: sql');
  console.log(`📦 Storage bucket: ${BUCKET_NAME}`);
  console.log(`📂 Archive path: companies/{companyId}/archives/`);

  // Discover all companies
  let companies = [];
  try {
    companies = await listCompanyPublicIds();
    console.log(`\n🏢 Found ${companies.length} companies: ${companies.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to list companies:', error);
    process.exit(1);
  }

  if (companies.length === 0) {
    console.log('⚠️ No companies found, nothing to archive.');
    process.exit(0);
  }

  // Process companies in parallel batches with env-tunable concurrency.
  const CONCURRENCY = COMPANY_ARCHIVE_CONCURRENCY;
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(companyId => processCompany(companyId, target))
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        successCount++;
      } else {
        failCount++;
        const companyId = batch[j];
        const errorMsg = (results[j] as PromiseRejectedResult).reason?.message || String((results[j] as PromiseRejectedResult).reason);
        errors.push({ company: companyId, error: errorMsg });
        console.error(`❌ Failed to process company ${companyId}:`, (results[j] as PromiseRejectedResult).reason);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 ARCHIVER SUMMARY');
  console.log('='.repeat(60));
  console.log(`Target month: ${target.year}-${target.month}`);
  console.log(`Companies processed: ${successCount}/${companies.length}`);
  console.log(`Failures: ${failCount}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(e => console.log(`  - ${e.company}: ${e.error}`));
  }

  console.log('\n✅ Archiver job completed');

  // Exit with error code if any failures (so Cloud Run Job shows as failed)
  if (failCount > 0) {
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
