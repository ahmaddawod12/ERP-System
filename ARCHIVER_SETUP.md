# Cloud Run Job: Firestore → Cloud Storage Archiver

## Overview

This Cloud Run **Job** (not a Service) runs monthly to migrate old data from Firestore to Cloud Storage, reducing Firestore storage costs. Data older than ~6 months is archived as monthly JSON files.

### Data Tiering

| Age | Storage | Access Pattern |
|-----|---------|---------------|
| 0-90 days | MMKV local cache | Instant, offline-first |
| 90-180 days | Firestore | Live queries |
| 180+ days | Cloud Storage | Monthly JSON archives |

### What Gets Archived

- **finished jobs**: `companies/{companyId}/jobs` (status=finished) → archived by `finishedAt`
- **documents**: `companies/{companyId}/documents` → archived by `createdAt`

### Storage Structure

```
gs://cooling-inventory-5be04.firebasestorage.app/
└── companies/
    └── {companyId}/
        └── archives/
            ├── manifest.json              # Tracks what's been archived (idempotency)
            ├── 2025-7-j.json             # finished jobs for July 2025
            ├── 2025-7-d.json             # documents for July 2025
            ├── 2025-8-j.json             # finished jobs for August 2025
            ├── 2025-8-d.json             # documents for August 2025
            └── ...
```

### Naming Convention

- `{YYYY}-{M}-j.json` → finished jobs for that month
- `{YYYY}-{M}-d.json` → documents for that month
- `manifest.json` → idempotency tracker

---

## Setup Instructions

### Prerequisites

- Google Cloud CLI (`gcloud`) installed and authenticated
- Project: `cooling-inventory-5be04`
- Region: `us-central1` (or your preferred region)

### 1. Build and Push Docker Image

```bash
cd cloudrun-archiver

# Build the Docker image
gcloud builds submit --tag gcr.io/cooling-inventory-5be04/archiver-job

# Alternative: use Artifact Registry (recommended)
gcloud builds submit --tag us-central1-docker.pkg.dev/cooling-inventory-5be04/cloud-run-source-deploy/archiver-job
```

### 2. Create the Cloud Run Job

```bash
gcloud run jobs create archiver-job \
  --image gcr.io/cooling-inventory-5be04/archiver-job \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --max-retries 3 \
  --task-timeout 30m \
  --set-env-vars "ARCHIVE_BUCKET=cooling-inventory-5be04.firebasestorage.app"
```

### 3. Set Up Cloud Scheduler (Monthly Trigger)

```bash
# Create a scheduler job that runs on the 1st of each month at 03:00 UTC
gcloud scheduler jobs create http archiver-monthly-trigger \
  --location us-central1 \
  --schedule "0 3 1 * *" \
  --uri "https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/cooling-inventory-5be04/jobs/archiver-job:run" \
  --http-method POST \
  --oauth-service-account-email cooling-inventory-5be04@appspot.gserviceaccount.com
```

### 4. IAM Permissions

The Cloud Run Job's service account needs:

```bash
PROJECT_ID=cooling-inventory-5be04
SA_EMAIL=${PROJECT_ID}@appspot.gserviceaccount.com

# Firestore read/write
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user"

# Cloud Storage read/write
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# Cloud Run invoker (for scheduler)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.invoker"
```

### 5. Firestore Indexes Required

The archiver queries by date range fields. Ensure these composite indexes exist:

```
Collection: companies/{companyId}/jobs
  Fields: status ASC, finishedAt ASC

Collection: companies/{companyId}/documents
  Fields: createdAt ASC
```

These are single-field indexes that Firestore creates automatically for top-level fields. No additional composite indexes are needed for the archiver since it only queries on a single date field with ordering.

### 6. Storage Lifecycle (Optional - For Further Cost Reduction)

Configure Nearline/Archive storage classes for old archives:

```bash
# Create lifecycle rule to move archives older than 365 days to Nearline
cat > /tmp/lifecycle.json << 'EOF'
{
  "rule": [
    {
      "action": { "type": "SetStorageClass", "storageClass": "NEARLINE" },
      "condition": {
        "age": 365,
        "matchesPrefix": ["companies/"]
      }
    },
    {
      "action": { "type": "SetStorageClass", "storageClass": "ARCHIVE" },
      "condition": {
        "age": 1095,
        "matchesPrefix": ["companies/"]
      }
    }
  ]
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://cooling-inventory-5be04.firebasestorage.app
```

This gives:
- 0-365 days: Standard storage ($0.020/GB)
- 365-1095 days: Nearline ($0.010/GB) 
- 1095+ days: Archive ($0.0012/GB) — **~94% cheaper**

---

## Manual Execution

### Run Now (for testing)

```bash
gcloud run jobs execute archiver-job --region us-central1
```

### View Logs

```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=archiver-job" \
  --limit 100 \
  --format "value(textPayload)"
```

### Check Execution Status

```bash
gcloud run jobs executions list --job archiver-job --region us-central1
```

---

## Safety & Idempotency

### Manifest System

Each company has a `manifest.json` in Storage that tracks which months have been archived:

```json
{
  "2025-7-j": { "archivedAt": "2026-01-01T03:05:12Z", "docCount": 150, "deletedCount": 150 },
  "2025-7-d": { "archivedAt": "2026-01-01T03:05:15Z", "docCount": 42, "deletedCount": 42 },
  "2025-8-j": { "archivedAt": "2026-02-01T03:04:30Z", "docCount": 0, "empty": true }
}
```

### Safety Guarantees

1. **Upload before delete**: Data is uploaded to Storage AND verified before any Firestore deletion
2. **Verification**: After upload, the archive is re-downloaded and document count is verified
3. **Idempotent**: If a month is already in the manifest, it's skipped (safe to re-run)
4. **Per-company isolation**: Failure in one company doesn't affect others
5. **Batch deletes**: Uses Firestore batch writes (max 500 per batch) for efficient deletion
6. **No permanent loss**: Data exists in Storage indefinitely; archives are never auto-deleted

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Job runs twice in same month | Skipped via manifest (idempotent) |
| Upload succeeds, delete fails | Manifest records upload; next run skips archive, deletes retry naturally |
| Network failure mid-process | Per-company isolation; other companies continue |
| Empty month (no data) | Recorded in manifest as `empty: true`, no file uploaded |
| Very large month (50k+ docs) | Paginated queries (5000 per page), batch deletes (500 per batch) |
| Year boundary (e.g., March 2026 → September 2025) | Month calculation handles negative months correctly |

---

## Mobile App Integration

The `CacheContext.js` in the React Native app is updated to support 3-tier data access:

1. **Cache hit (0-90 days)**: Returns from MMKV instantly
2. **Firestore (90-180 days)**: Queries Firestore normally
3. **Storage fallback (180+ days)**: If Firestore returns 0 docs for an old month, downloads the JSON archive from Storage, parses it, and caches it locally in MMKV

### Key Functions

- `getDataForMonth(monthDate, dataType)` - Automatically handles all 3 tiers
- `getDataForDateRange(startDate, endDate, dataType)` - Handles ranges spanning multiple tiers
- `fetchFromArchive(companyName, year, month, dataType)` - Direct archive download (exposed for advanced use)

---

## Updating

To redeploy after changes:

```bash
cd cloudrun-archiver
gcloud builds submit --tag gcr.io/cooling-inventory-5be04/archiver-job
gcloud run jobs update archiver-job --image gcr.io/cooling-inventory-5be04/archiver-job --region us-central1
```

---

## Cost Estimation

### Before (all in Firestore)
- 100,000 documents × 1KB avg = ~100MB Firestore storage
- Firestore: $0.18/GB/month × 0.1GB = **$0.018/month**

### After (old data in Storage)
- 70% of data archived → 70MB in Storage, 30MB in Firestore
- Firestore: $0.18/GB × 0.03GB = $0.0054
- Storage (Standard): $0.020/GB × 0.07GB = $0.0014
- **Total: $0.0068/month (62% savings)**
- With Nearline/Archive classes: **up to 94% savings** on archived data

### Read Costs
- Archived data is rarely accessed (maybe 1-2x/month per user)
- Storage download: $0.12/GB (negligible for JSON files)
- vs. Firestore read: $0.06/100K reads (saved by not querying empty collections)
