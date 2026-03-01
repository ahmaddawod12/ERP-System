# Cloud Run + Pub/Sub Document Generation System

## Overview

This system uses a **single merged Cloud Run service** (`pdf-service`) for both PDF preview and generation, with Pub/Sub for message queuing. The service shares a single Puppeteer browser instance with 2 concurrent tabs for efficient resource usage.

### Architecture

```
Frontend App                          Cloud Functions                      Pub/Sub                     Cloud Run (pdf-service)
     │                                      │                                │                             │
     │ publishPreviewTask/              │                                │                             │
     │ publishGenerateTask              │                                │                             │
     ├──────────────────────────────────►│                                │                             │
     │                                      │ Check busy flag                │                             │
     │                                      │ Create task in Firestore       │                             │
     │                                      │ Publish to topic               │                             │
     │                                      ├────────────────────────────────►│                             │
     │                                      │                                │ Push to /preview           │
     │◄──────────────────────────────────┤ Return taskId                   │ or /generate endpoint      │
     │                                      │                                ├────────────────────────────►│
     │ Listen to documentTasks/{taskId}│                                │                             │ Shared Browser
     │                                      │                                │                             │ (2 tabs max)
     │                                      │                                │                             │
     │                                      │                                │                             │ Tab 1: preview
     │                                      │                                │                             │ Tab 2: generate
     │                                      │                                │                             │
     │ Task status: completed              │                                │                             │ Update task status
     │◄─────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Get previewURL/downloadURL         │                                │                             │
```

### Key Features

- **Single merged service**: Both preview and generate in one container
- **Shared browser**: One Puppeteer browser with 2 concurrent tabs
- **Min instances = 0**: Scale to zero when idle (cost optimization)
- **Max instances = 5**: Testing level configuration
- **Concurrency = 2**: 2 browser tabs shared between preview & generate
- **Memory = 2Gi, CPU = 2**: Optimal for Puppeteer PDF generation
- **Busy flag**: Prevents duplicate documents from concurrent requests
- **Task tracking**: Firestore document for real-time status updates

## Setup Instructions

### 1. Install Required Dependencies

```bash
cd functions
npm install @google-cloud/pubsub
```

### 2. Create Pub/Sub Topics

```bash
# Preview topic
gcloud pubsub topics create document-preview

# Generate topic
gcloud pubsub topics create document-generate
```

### 3. Build and Deploy Cloud Run Service (Merged)

The merged `pdf-service` handles both preview and generate requests with a shared browser.

```bash
cd cloudrun-pdf

# Build Docker image
gcloud builds submit --tag gcr.io/cooling-inventory-5be04/pdf-service

# Deploy merged service
gcloud run deploy pdf-service `
  --image gcr.io/cooling-inventory-5be04/pdf-service `
  --platform managed `
  --region us-central1 `
  --memory 2Gi `
  --cpu 2 `
  --timeout 300 `
  --concurrency 2 `
  --min-instances 0 `
  --max-instances 5 `
  --allow-unauthenticated `
  --set-env-vars="AWS_REGION=eu-west-1" `
  --set-secrets="AWS_ACCESS_KEY_ID=aws-access-key-id:latest,AWS_SECRET_ACCESS_KEY=aws-secret-access-key:latest"
```

### 4. Create Pub/Sub Subscriptions with Push Endpoints

Both subscriptions point to the same Cloud Run service but different endpoints.

```bash
# Get the service URL
$SERVICE_URL = gcloud run services describe pdf-service --region us-central1 --format 'value(status.url)'

# Create push subscription for preview (points to /preview endpoint)
gcloud pubsub subscriptions create document-preview-sub `
  --topic=document-preview `
  --push-endpoint="https://pdf-service-625201590447.us-central1.run.app/preview" `
  --ack-deadline=300 `
  --message-retention-duration=10m `
  --min-retry-delay=10s `
  --max-retry-delay=600s

# Create push subscription for generate (points to /generate endpoint)
gcloud pubsub subscriptions create document-generate-sub `
  --topic=document-generate `
  --push-endpoint="https://pdf-service-625201590447.us-central1.run.app/generate" `
  --ack-deadline=300 `
  --message-retention-duration=10m `
  --min-retry-delay=10s `
  --max-retry-delay=600s
```

### 5. Update Cloud Functions

Add the Pub/Sub functions to your `functions/index.js`:

```javascript
// Add import at top
const { PubSub } = require('@google-cloud/pubsub');

// Copy content from pubsub-tasks.js and add to index.js
// OR require the file:
// const pubsubTasks = require('./pubsub-tasks');
```

### 6. Deploy Cloud Functions

```bash
cd functions
firebase deploy --only functions
```

### 7. Remove Old Cloud Functions (Optional)

After testing, remove the old functions:
- `previewDocument`
- `generateDocument`

## Frontend Integration

### Using the useDocumentTask Hook (Recommended)

The `useDocumentTask` hook provides a convenient way to publish tasks and listen for completion with callbacks.

```javascript
import { useDocumentTask } from '../hooks';

// In your component
const {
  publishPreview,
  publishGenerate,
  listenToTask, // For listening to existing task IDs
  taskStatus,
  previewURL,
  downloadURL,
  isCompleted,
  isFailed,
  error,
  reset,
} = useDocumentTask({
  onPreviewComplete: (url) => {
    console.log('Preview ready:', url);
    // Show PDF viewer modal
  },
  onGenerateComplete: (url, docId) => {
    console.log('Document generated:', url, docId);
    // Show success message
  },
  onError: (error) => {
    console.error('Failed:', error);
    // Show error message
  },
});

// Example: Publish a preview task
const handlePreview = async () => {
  try {
    await publishPreview({
      type: 'priceProposal',
      date: '2026-01-09',
      client: { name: 'John Doe', email: 'john@example.com' },
      items: [{ description: 'Service', quantity: 1, price: 100 }],
      company: { name: 'My Company' },
      language: 'he',
      documentNumber: 'PROP-001',
    });
    // Callbacks will handle completion/error
  } catch (err) {
    // Initial publish failed (e.g., network error)
  }
};

// Example: Listen to existing task (from getInvoiceApproval)
const handleTaxInvoice = async () => {
  const result = await getInvoiceApproval(documentData);
  if (result.data.pdfTaskId) {
    // Start listening to the async PDF generation
    listenToTask(result.data.pdfTaskId);
  }
};
```

### Tax Invoice Flow (getInvoiceApproval Integration)

The `getInvoiceApproval` function now publishes PDF generation to Pub/Sub instead of generating inline:

```javascript
const handleSubmitTaxInvoice = async () => {
  // 1. Call getInvoiceApproval to submit to Tax Authority
  const getApprovalFunction = httpsCallable(middleEastFunctions, 'getInvoiceApproval');
  const result = await getApprovalFunction(documentData);
  
  // 2. Check if Tax Authority approved
  if (result.data.approved) {
    console.log('Tax Authority approved!');
    console.log('Confirmation:', result.data.confirmationNumber);
    
    // 3. PDF generation is now async via Pub/Sub
    if (result.data.pdfTaskPublished && result.data.pdfTaskId) {
      // Start listening for PDF completion
      listenToTask(result.data.pdfTaskId);
      // Show "Generating PDF..." message
    } else {
      // PDF task publishing failed, but document is saved
      // User can regenerate from Document History
    }
  }
};
```

### Manual Publishing (Without Hook)

```javascript
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../firebase';

// Publish preview task
const publishPreviewTask = httpsCallable(functions, 'publishPreviewTask');

const result = await publishPreviewTask({
  documentType: 'priceProposal',
  companyName: 'mycompany',
  documentData: {
    client: { name: 'John Doe', email: 'john@example.com' },
    items: [{ description: 'Service', quantity: 1, price: 100 }],
    language: 'he',
    date: '2026-01-09'
  }
});

const taskId = result.data.taskId;
```

### Listening for Task Completion (Manual)

```javascript
// Listen to task document
const taskRef = doc(db, 'documentTasks', taskId);

const unsubscribe = onSnapshot(taskRef, (doc) => {
  if (doc.exists()) {
    const data = doc.data();
    
    if (data.status === 'completed') {
      // Task completed successfully
      const previewURL = data.previewURL; // For preview tasks
      const downloadURL = data.downloadURL; // For generate tasks
      unsubscribe();
      // Handle success
    } else if (data.status === 'failed') {
      // Task failed
      const error = data.error;
      unsubscribe();
      // Handle error
    }
    // else status is 'pending' or 'queued' - still processing
  }
});
```

## Firestore Structure

### Task Document (`documentTasks/{taskId}`)

```javascript
{
  taskId: 'preview_priceProposal_1704812345678_abc123',
  type: 'preview' | 'generate',
  documentType: 'taxInvoice' | 'priceProposal' | 'refund' | 'returnCertificate',
  documentId: null | 'existing-doc-id', // For taxInvoice generate
  username: 'john',
  companyName: 'mycompany',
  status: 'pending' | 'queued' | 'completed' | 'failed',
  createdAt: Timestamp,
  createdBy: 'john@example.com',
  documentData: { ... }, // Input data
  
  // After queuing
  pubsubMessageId: 'msg-id',
  queuedAt: Timestamp,
  
  // After completion
  completedAt: Timestamp,
  processingTimeMs: 5000,
  
  // For preview
  previewURL: 'https://...',
  storagePath: 'previews/john/preview_xxx.pdf',
  pdfSize: 123456,
  expiresAt: '2026-01-09T12:00:00Z',
  
  // For generate
  downloadURL: 'https://...',
  storagePath: 'companies/mycompany/documents/xxx/xxx.pdf',
  isNewDocument: true,
  
  // On failure
  error: 'Error message'
}
```

### Busy Lock Document (`companies/{companyName}/documentLocks/{type}`)

```javascript
{
  lockedBy: 'john',
  taskId: 'preview_priceProposal_xxx',
  lockedAt: Timestamp
}
```

## Configuration Options

### Cloud Run Settings

| Setting | Value | Reason |
|---------|-------|--------|
| Memory | 2Gi | Puppeteer/Chromium requirements |
| CPU | 2 | PDF generation needs CPU |
| Timeout | 300s | Allow time for PDF generation |
| Concurrency | 2 | 2 browser tabs per instance |
| Min instances | 0 | Scale to zero for cost |
| Max instances | 5 | Testing level |

### Pub/Sub Settings

| Setting | Value | Reason |
|---------|-------|--------|
| Ack deadline | 300s | Match Cloud Run timeout |
| Message retention | 10m | Retry window |
| Min retry delay | 10s | Initial retry delay |
| Max retry delay | 600s | Maximum retry delay |

## Troubleshooting

### Task stuck in "pending"

1. Check Pub/Sub subscription is correctly configured
2. Check Cloud Run service is healthy
3. Check Cloud Run logs for errors

### "Another document is being generated" error

This means the busy flag is set. Options:
1. Wait a few seconds and retry
2. The lock auto-expires after 5 minutes
3. Manually clear: delete `companies/{companyName}/documentLocks/{type}`

### PDF generation failed

1. Check Cloud Run logs
2. Check task document's `error` field
3. Common issues:
   - HTML too large (max 5MB)
   - Too many items (max 100)
   - Invalid numeric values

## Cost Considerations

- **Cloud Run**: Pay only when processing requests
- **Pub/Sub**: Minimal cost for message delivery
- **Cloud Functions**: Minimal cost for publishing tasks
- **Cold start**: First request after scale-to-zero may take ~10-30 seconds

## Security

- Cloud Functions validate authentication
- Cloud Run endpoints are protected by Pub/Sub push authentication
- Busy flags prevent duplicate submissions
- Task documents track all operations for auditing
