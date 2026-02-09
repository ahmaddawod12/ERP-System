/**
 * Cloud Run Job: Firestore → Cloud Storage Archiver
 * 
 * Purpose: Migrate old finishedJobs and certifications from Firestore to Cloud Storage
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
 *   gs://{bucket}/companies/{companyId}/archives/{YYYY}-{M}-j.json  (finishedJobs)
 *   gs://{bucket}/companies/{companyId}/archives/{YYYY}-{M}-c.json  (certifications)
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

const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');

// ============================================================================
// CONFIGURATION
// ============================================================================
const BUCKET_NAME = process.env.ARCHIVE_BUCKET || 'cooling-inventory-5be04.firebasestorage.app';
const MONTHS_LOOKBACK = 6; // Archive data older than 6 months
const BATCH_SIZE = 500; // Firestore batch delete limit
const QUERY_PAGE_SIZE = 5000; // Docs per paginated query

// ============================================================================
// INITIALIZATION
// ============================================================================
admin.initializeApp({
  storageBucket: BUCKET_NAME
});

const db = admin.firestore();
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
function getTargetMonth() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed

  let targetMonth = currentMonth - MONTHS_LOOKBACK;
  let targetYear = currentYear;

  if (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }

  // First day of target month (00:00:00.000 UTC)
  const startDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
  // Last millisecond of target month
  const endDate = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

  return { year: targetYear, month: targetMonth, startDate, endDate };
}

// ============================================================================
// MANIFEST MANAGEMENT (Idempotency)
// ============================================================================

/**
 * Load the manifest for a company.
 * The manifest tracks which months have been successfully archived.
 * 
 * Format: { "2026-1-j": { archivedAt, docCount }, "2026-1-c": { archivedAt, docCount } }
 */
async function loadManifest(companyId) {
  const manifestPath = `companies/${companyId}/archives/manifest.json`;
  const file = bucket.file(manifestPath);

  try {
    const [exists] = await file.exists();
    if (!exists) return {};

    const [content] = await file.download();
    return JSON.parse(content.toString('utf8'));
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
// FIRESTORE QUERY HELPERS
// ============================================================================

/**
 * Query all documents in a collection within a date range.
 * Uses pagination to handle large datasets.
 * 
 * @param {string} collectionPath - Full Firestore collection path
 * @param {string} dateField - 'finishedAt' or 'createdAt'
 * @param {Date} startDate - Start of range (inclusive)
 * @param {Date} endDate - End of range (inclusive)
 * @returns {Array} - All matching documents with their IDs
 */
async function queryDocumentsByDateRange(collectionPath, dateField, startDate, endDate) {
  const allDocs = [];
  const collRef = db.collection(collectionPath);

  // Dates stored as ISO strings in Firestore
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  let lastDoc = null;
  let hasMore = true;

  while (hasMore) {
    let q = collRef
      .where(dateField, '>=', startISO)
      .where(dateField, '<=', endISO)
      .orderBy(dateField, 'asc')
      .limit(QUERY_PAGE_SIZE);

    if (lastDoc) {
      q = q.startAfter(lastDoc);
    }

    const snapshot = await q.get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    snapshot.docs.forEach(doc => {
      allDocs.push({ id: doc.id, ...doc.data() });
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.docs.length < QUERY_PAGE_SIZE) {
      hasMore = false;
    }
  }

  return allDocs;
}

// ============================================================================
// ARCHIVE & DELETE
// ============================================================================

/**
 * Upload a JSON archive to Cloud Storage.
 * 
 * @param {string} companyId 
 * @param {string} archiveKey - e.g., "2026-1-j" or "2026-1-c"
 * @param {Array} documents - The documents to archive
 * @returns {string} - Storage path of the uploaded file
 */
async function uploadArchive(companyId, archiveKey, documents) {
  const storagePath = `companies/${companyId}/archives/${archiveKey}.json`;
  const file = bucket.file(storagePath);

  const jsonContent = JSON.stringify(documents, null, 0); // Compact JSON for storage efficiency

  await file.save(jsonContent, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'no-cache',
      metadata: {
        docCount: String(documents.length),
        archiveKey: archiveKey,
        companyId: companyId,
        archivedAt: new Date().toISOString(),
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

  // Download and verify doc count
  const [content] = await file.download();
  const parsed = JSON.parse(content.toString('utf8'));

  if (parsed.length !== expectedCount) {
    throw new Error(
      `Archive verification failed: ${storagePath} has ${parsed.length} docs, expected ${expectedCount}`
    );
  }

  console.log(`✅ Archive verified: ${storagePath} (${parsed.length} docs)`);
  return true;
}

/**
 * Delete documents from Firestore in batches.
 * 
 * @param {string} collectionPath - Full Firestore collection path
 * @param {string} dateField - 'finishedAt' or 'createdAt'
 * @param {Date} startDate - Start of range (inclusive)
 * @param {Date} endDate - End of range (inclusive)
 * @returns {number} - Number of documents deleted
 */
async function deleteDocumentsByDateRange(collectionPath, dateField, startDate, endDate) {
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await db.collection(collectionPath)
      .where(dateField, '>=', startISO)
      .where(dateField, '<=', endISO)
      .limit(BATCH_SIZE)
      .get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    totalDeleted += snapshot.docs.length;

    console.log(`🗑️ Deleted batch of ${snapshot.docs.length} docs from ${collectionPath} (total: ${totalDeleted})`);

    if (snapshot.docs.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return totalDeleted;
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
  if (manifest[finishedKey]) {
    console.log(`⏭️ ${finishedKey} already archived (${manifest[finishedKey].docCount} docs on ${manifest[finishedKey].archivedAt})`);
  } else {
    const collectionPath = `companies/${companyId}/finishedJobs`;
    const docs = await queryDocumentsByDateRange(collectionPath, 'finishedAt', startDate, endDate);

    if (docs.length === 0) {
      console.log(`📭 No finishedJobs found for ${year}-${month}`);
      // Record in manifest so we don't re-query next run
      manifest[finishedKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
      manifestUpdated = true;
    } else {
      console.log(`📊 Found ${docs.length} finishedJobs for ${year}-${month}`);

      // Step 1: Upload to Storage
      await uploadArchive(companyId, finishedKey, docs);

      // Step 2: Verify upload
      await verifyArchive(companyId, finishedKey, docs.length);

      // Step 3: Delete from Firestore (only after verified upload)
      const deleted = await deleteDocumentsByDateRange(collectionPath, 'finishedAt', startDate, endDate);
      console.log(`✅ Archived and deleted ${deleted} finishedJobs for ${year}-${month}`);


      // Step 4: Update manifest
      manifest[finishedKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        deletedCount: deleted,
      };
      manifestUpdated = true;
    }
  }

  // ---- CERTIFICATIONS ----
  const certsKey = `${year}-${month}-c`;
  if (manifest[certsKey]) {
    console.log(`⏭️ ${certsKey} already archived (${manifest[certsKey].docCount} docs on ${manifest[certsKey].archivedAt})`);
  } else {
    const collectionPath = `companies/${companyId}/certifications`;
    const docs = await queryDocumentsByDateRange(collectionPath, 'createdAt', startDate, endDate);

    if (docs.length === 0) {
      console.log(`📭 No certifications found for ${year}-${month}`);
      manifest[certsKey] = { archivedAt: new Date().toISOString(), docCount: 0, empty: true };
      manifestUpdated = true;
    } else {
      console.log(`📊 Found ${docs.length} certifications for ${year}-${month}`);

      // Step 1: Upload to Storage
      await uploadArchive(companyId, certsKey, docs);

      // Step 2: Verify upload
      await verifyArchive(companyId, certsKey, docs.length);

      // Step 3: Delete from Firestore
      const deleted = await deleteDocumentsByDateRange(collectionPath, 'createdAt', startDate, endDate);
      console.log(`✅ Archived and deleted ${deleted} certifications for ${year}-${month}`);

      // Step 4: Update manifest
      manifest[certsKey] = {
        archivedAt: new Date().toISOString(),
        docCount: docs.length,
        deletedCount: deleted,
      };
      manifestUpdated = true;
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
  console.log('🚀 Smart-Job Archiver - Firestore → Cloud Storage Migration');
  console.log('='.repeat(60));

  const target = getTargetMonth();
  console.log(`📅 Target month: ${target.year}-${target.month}`);
  console.log(`📅 Date range: ${target.startDate.toISOString()} → ${target.endDate.toISOString()}`);
  console.log(`📦 Storage bucket: ${BUCKET_NAME}`);
  console.log(`📂 Archive path: companies/{companyId}/archives/`);

  // Discover all companies
  let companies = [];
  try {
    const companiesSnapshot = await db.collection('companies').get();
    companies = companiesSnapshot.docs.map(doc => doc.id);
    console.log(`\n🏢 Found ${companies.length} companies: ${companies.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to list companies:', error);
    process.exit(1);
  }

  if (companies.length === 0) {
    console.log('⚠️ No companies found, nothing to archive.');
    process.exit(0);
  }

  // Process each company
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const companyId of companies) {
    try {
      await processCompany(companyId, target);
      successCount++;
    } catch (error) {
      failCount++;
      errors.push({ company: companyId, error: error.message });
      console.error(`❌ Failed to process company ${companyId}:`, error);
      // Continue with next company - partial failure is acceptable
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
