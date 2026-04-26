import { Storage } from '@google-cloud/storage';
import { createHash } from 'crypto';
import {
  deleteArchivedDocumentsByIds,
  deleteArchivedJobsByIds,
  listArchivedCompanyDocuments,
  listArchivedCompanyJobs,
  listCompanyPublicIds,
} from '@smart-job/db';
import { getTargetMonth } from './archive-month';

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
async function uploadArchive(companyId, archiveKey, documents) {
  const storagePath = `companies/${companyId}/archives/${archiveKey}.json`;
  const file = bucket.file(storagePath);

  const jsonContent = JSON.stringify(documents, null, 0); // Compact JSON for storage efficiency
  const checksum = createHash('sha256').update(jsonContent).digest('hex');

  await file.save(jsonContent, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'no-cache',
      metadata: {
        docCount: String(documents.length),
        archiveKey: archiveKey,
        companyId: companyId,
        archivedAt: new Date().toISOString(),
        sha256: checksum,
      },
    },
  });

  console.log(`📦 Uploaded ${storagePath} (${documents.length} docs, ${(jsonContent.length / 1024).toFixed(1)} KB)`);
  return storagePath;
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

  // Download and verify doc count + integrity
  const [content] = await file.download();
  const contentStr = content.toString('utf8');
  const parsed = JSON.parse(contentStr);

  if (parsed.length !== expectedCount) {
    throw new Error(
      `Archive verification failed: ${storagePath} has ${parsed.length} docs, expected ${expectedCount}`
    );
  }

  // Verify SHA-256 checksum if stored in metadata
  const [metadata] = await file.getMetadata();
  const storedChecksum = metadata?.metadata?.sha256;
  if (storedChecksum) {
    const actualChecksum = createHash('sha256').update(contentStr).digest('hex');
    if (actualChecksum !== storedChecksum) {
      throw new Error(`Archive integrity check failed: ${storagePath} checksum mismatch`);
    }
  }

  console.log(`✅ Archive verified: ${storagePath} (${parsed.length} docs)`);
  return true;
}

async function listArchiveRecords(companyId, target, kind) {
  const queryOptions = kind === 'finishedJobs'
    ? {
      status: 'finished',
      dateField: 'finishedAt',
      dateFrom: target.startDate.toISOString(),
      dateTo: target.endDate.toISOString(),
      limit: QUERY_PAGE_SIZE,
    }
    : {
      dateField: 'createdAt',
      dateFrom: target.startDate.toISOString(),
      dateTo: target.endDate.toISOString(),
      limit: QUERY_PAGE_SIZE,
    };

  return kind === 'finishedJobs'
    ? await listArchivedCompanyJobs(companyId, queryOptions)
    : await listArchivedCompanyDocuments(companyId, queryOptions);
}

async function deleteArchiveRecords(companyId, kind, recordIds) {
  return kind === 'finishedJobs'
    ? await deleteArchivedJobsByIds(companyId, recordIds)
    : await deleteArchivedDocumentsByIds(companyId, recordIds);
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
      const deleted = await deleteArchiveRecords(companyId, 'finishedJobs', manifest[finishedKey].docIds);
      manifest[finishedKey] = {
        ...manifest[finishedKey],
        deletedCount: deleted,
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        docIds: undefined,
      };
      manifestUpdated = true;
    } else {
    const docs = await listArchiveRecords(companyId, target, 'finishedJobs');

    if (docs.length === 0) {
      console.log(`📭 No finished jobs found for ${year}-${month}`);
      // Record in manifest so we don't re-query next run
      manifest[finishedKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
      manifestUpdated = true;
    } else {
      console.log(`📊 Found ${docs.length} finished jobs for ${year}-${month}`);

      // Step 1: Upload to Storage
      await uploadArchive(companyId, finishedKey, docs);

      // Step 2: Verify upload
      await verifyArchive(companyId, finishedKey, docs.length);
      manifest[finishedKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        status: 'uploaded_not_deleted',
        docIds: docs.map((doc) => doc.id),
      };
      await saveManifest(companyId, manifest);

      // Step 3: Delete from Firestore (only after verified upload)
      const deleted = await deleteArchiveRecords(companyId, 'finishedJobs', docs.map((doc) => doc.id));
      console.log(`✅ Archived and deleted ${deleted} finished jobs for ${year}-${month}`);


      // Step 4: Update manifest
      manifest[finishedKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        deletedCount: deleted,
        status: 'deleted',
      };
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
      const deleted = await deleteArchiveRecords(companyId, 'documents', manifest[documentsKey].docIds);
      manifest[documentsKey] = {
        ...manifest[documentsKey],
        deletedCount: deleted,
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        docIds: undefined,
      };
      manifestUpdated = true;
    } else {
    const docs = await listArchiveRecords(companyId, target, 'documents');

    if (docs.length === 0) {
      console.log(`📭 No documents found for ${year}-${month}`);
      manifest[documentsKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
      manifestUpdated = true;
    } else {
      console.log(`📊 Found ${docs.length} documents for ${year}-${month}`);

      // Step 1: Upload to Storage
      await uploadArchive(companyId, documentsKey, docs);

      // Step 2: Verify upload
      await verifyArchive(companyId, documentsKey, docs.length);
      manifest[documentsKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        status: 'uploaded_not_deleted',
        docIds: docs.map((doc) => doc.id),
      };
      await saveManifest(companyId, manifest);

      // Step 3: Delete from Firestore
      const deleted = await deleteArchiveRecords(companyId, 'documents', docs.map((doc) => doc.id));
      console.log(`✅ Archived and deleted ${deleted} documents for ${year}-${month}`);

      // Step 4: Update manifest
      manifest[documentsKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        deletedCount: deleted,
        status: 'deleted',
      };
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
