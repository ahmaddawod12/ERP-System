export interface DocTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface DocLink {
  label: string;
  href: string;
}

export interface DocEntry {
  slug: string;
  title: string;
  summary: string;
  body: string[];
  tables?: DocTable[];
  links?: DocLink[];
}

export const docs: DocEntry[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    summary: "Create an account, complete onboarding, and launch your first workflow.",
    body: [
      "Register with email and password, then continue to onboarding.",
      "Choose Solo owner or Business with workers.",
      "Managers create a company profile; workers join using companyId + invite code.",
      "Select language and theme, then open /app.",
    ],
  },
  {
    slug: "roles",
    title: "Roles",
    summary: "Understand manager, worker, user, basic, and dev access patterns.",
    body: [
      "manager controls workers, jobs, company inventory, and clients.",
      "worker handles assigned jobs and inventory picks.",
      "user (solo owner) manages own jobs and personal inventory.",
      "basic keeps only clients and documents access; upgrade for jobs.",
      "dev role is full-access for internal support and implementation.",
    ],
  },
  {
    slug: "job-lifecycle",
    title: "Job Lifecycle",
    summary: "Jobs transition through statuses in a unified collection.",
    body: [
      "Create jobs in the unified jobs collection with a sequential id from company jid.",
      "Workers and managers update statuses: pending -> waiting -> finished (or denied).",
      "When marked finished, the job status is updated in place (no collection move).",
      "Document generation can be triggered after completion.",
    ],
  },
  {
    slug: "inventory",
    title: "Inventory",
    summary: "Track company and personal inventory as single documents with parts arrays.",
    body: [
      "Team accounts store inventory as a single doc at companies/{companyId}/data/inventory.",
      "The doc contains a parts array, nextId counter, and lastUpdated timestamp.",
      "Solo users store personal items at users/{uid}/data/inventory in the same format.",
      "Workers can pick parts from company inventory, which adds them to personal inventory.",
      "Low threshold values help flag parts that need reordering.",
    ],
  },
  {
    slug: "documents-pdfs",
    title: "Documents / PDFs",
    summary: "Generate documents via Pub/Sub Cloud Functions with PDF preview and generation.",
    body: [
      "Documents are created using publishPreviewTask and publishGenerateTask callable functions.",
      "Tax Invoices (type 305) use getInvoiceApproval on me-west1 before PDF generation.",
      "Tasks are tracked via documentTasks/{taskId} with status pending -> queued -> completed/failed.",
      "Document history and details are available in /app/documents.",
    ],
  },
  {
    slug: "cache-model-overview",
    title: "Cache Model Overview",
    summary: "Web UI favors optimistic updates while Firestore remains source of truth.",
    body: [
      "Client actions update UI quickly and then re-fetch latest Firestore snapshots.",
      "Server APIs handle sensitive operations: invites, counters, onboarding joins, and upgrades.",
      "Use Firebase emulator suite locally for safe integration testing.",
      "Production deploys should monitor API and function retries.",
    ],
  },
  {
    slug: "data-structures-master",
    title: "Data Structures Reference",
    summary: "Canonical schema map and links to module-specific docs and handoff tables.",
    body: [
      "Master file is kept at repo root: DATA_STRUCTURES.md.",
      "This docs section adds split module references (auth, jobs, documents, inventory).",
      "Use API / Database Tables for handoff to developers and AI tools.",
      "Field naming is mixed: business_info uses snake_case, most other docs use camelCase.",
    ],
    links: [
      { label: "Auth Data Structures", href: "/docs/data-structures-auth" },
      { label: "Jobs Data Structures", href: "/docs/data-structures-jobs" },
      { label: "Documents Data Structures", href: "/docs/data-structures-documents" },
      { label: "Inventory Data Structures", href: "/docs/data-structures-inventory" },
      { label: "API / Database Tables", href: "/docs/api-database-tables" },
    ],
    tables: [
      {
        title: "Core Model Conventions",
        columns: ["Area", "Current Convention", "Notes"],
        rows: [
          ["Company identity", "companyId allocated from system/data/comid", "Never derived from uid"],
          ["Jobs collection", "companies/{companyId}/jobs/{jobId}", "Single collection for pending/waiting/finished/denied"],
          ["Inventory model", "Single document with parts[] + nextId", "No inventory subcollection model"],
          ["Document tasks", "documentTasks/{taskId}", "Async preview/generate tracking"],
          ["Role set", "manager, worker, user, basic, dev", "Used in profile and workers docs"],
        ],
      },
    ],
  },
  {
    slug: "data-structures-auth",
    title: "Auth Data Structures",
    summary: "Profiles, membership, business registration, invites, subscription, and token docs.",
    body: [
      "Auth flows are centered around registerBusinessV1, manageWorker, createInviteV1, and joinCompanyV1.",
      "Profile and worker membership are separate docs and must stay in sync.",
      "Business info and subscription are initialized server-side during onboarding.",
    ],
    tables: [
      {
        title: "Auth Firestore Documents",
        columns: ["Path", "Purpose", "Key Fields"],
        rows: [
          [
            "users/{uid}/data/profile",
            "Canonical user profile",
            "uid, email, role, companyId, name, phoneNumber, accountType, createdAt, updatedAt, pushToken*",
          ],
          [
            "users/{uid}/data/cache",
            "User cache versions",
            "profile, inventory, subscription, lastUpdated",
          ],
          [
            "companies/{companyId}/workers/{wid}",
            "Company membership",
            "workerId, uid, role, email, name, phoneNumber, wid, createdAt, updatedAt",
          ],
          [
            "companies/{companyId}/data/business_info",
            "Business registration",
            "he_name, en_name, vat_number, business_type, city, address, document_numbers, last_updated",
          ],
          [
            "companies/{companyId}/data/subscription",
            "Plan and module gates",
            "tier, status, enabledModules, expiresAt, updatedAt",
          ],
          [
            "companies/{companyId}/data/token",
            "Tax Authority OAuth tokens",
            "accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, callbackId",
          ],
          [
            "companies/{companyId}/invites/{inviteId}",
            "Worker/user/basic onboarding invites",
            "code, targetRole, status, expiresAt, usedBy, usedAt, createdBy",
          ],
          [
            "system/data/comid",
            "Global company counter",
            "comid, updatedAt, lastAllocatedCompanyId, lastAllocatedBy",
          ],
        ],
      },
      {
        title: "Auth API Contracts",
        columns: ["Function", "Input (high level)", "Writes"],
        rows: [
          [
            "registerBusinessV1 (callable)",
            "role, accountType, name/phone, business fields",
            "profile, user cache, company root, workers doc, business_info, subscription, inventory, company cache, system/data/comid",
          ],
          [
            "manageWorker (callable)",
            "action add/edit/delete + companyId + email (+password fields)",
            "worker profile, worker cache, workers doc, company counters/cache, auth user updates/deletes",
          ],
          [
            "updateProfileV1 (callable)",
            "name and/or phoneNumber",
            "profile doc and workers/{wid} mirror update",
          ],
          [
            "updatePushTokenV1 / clearPushTokenV1 (callable)",
            "pushToken payload (or none for clear)",
            "profile pushToken fields",
          ],
          [
            "updateBusinessInfoV1 (callable)",
            "companyId + allowed editable business fields",
            "business_info (excludes vat_number/document_numbers) + company cache.updatedAt",
          ],
          [
            "createInviteV1 / joinCompanyV1 (HTTP)",
            "companyId, inviteCode, email, role, name, phoneNumber",
            "invites doc, workers doc, profile doc, company workersVersion",
          ],
        ],
      },
    ],
  },
  {
    slug: "data-structures-jobs",
    title: "Jobs Data Structures",
    summary: "Unified job model, status transitions, worker assignment, and notification logs.",
    body: [
      "All jobs live in one collection: companies/{companyId}/jobs/{jobId}.",
      "Status transitions are enforced in Cloud Functions to prevent invalid moves.",
      "Company cache.jobsVersion is incremented on all job mutations.",
    ],
    tables: [
      {
        title: "Jobs Firestore Documents",
        columns: ["Path", "Purpose", "Key Fields"],
        rows: [
          [
            "companies/{companyId}/jobs/{jobId}",
            "Unified job record",
            " status, createdAt, updatedAt, wid,mid,mname,wname, client fields, parts/partsUsed, timing/signature fields, isCert",
          ],
          [
            "companies/{companyId}/data/cache",
            "Job-list invalidation",
            "jobsVersion, updatedAt",
          ],
          [
            "users/{workerUid}/data/inventory",
            "Inventory deduction on accept",
            "parts, nextId, lastUpdated",
          ],
          [
            "users/{workerUid}/data/cache",
            "Worker inventory cache bump",
            "inventory, lastUpdated",
          ],
          [
            "notificationLog/{logId}",
            "Assignment/submission dedupe",
            "jobId, notificationType, sentAt, expireAt, messageId, companyId",
          ],
        ],
      },
      {
        title: "Jobs API Contracts",
        columns: ["Function", "Input (high level)", "Writes"],
        rows: [
          [
            "createJobV1 (callable)",
            "companyId, type (pending|finished), whitelisted job payload, optional idempotencyKey",
            "job doc + company jid increment + company cache.jobsVersion",
          ],
          [
            "updateJobV1 (callable)",
            "companyId, jobId, whitelisted update fields",
            "job doc update + company cache.jobsVersion",
          ],
          [
            "acceptJobV1 (callable)",
            "companyId, jobId",
            "job status->finished + acceptedBy/acceptedAt + optional worker inventory deduction + cache bumps",
          ],
          [
            "deleteJobV1 (callable)",
            "companyId, jobId",
            "job delete + company cache.jobsVersion",
          ],
          [
            "onJobAssignTrigger / onJobSubmitTrigger",
            "Firestore trigger on jobs collection",
            "notificationLog entries and push notifications",
          ],
        ],
      },
    ],
  },
  {
    slug: "data-structures-documents",
    title: "Documents Data Structures",
    summary: "Document records, task tracking, tax approval records, locks, and PDF outputs.",
    body: [
      "Document generation is asynchronous via documentTasks and Pub/Sub.",
      "Tax invoice approval writes document metadata before PDF generation completes.",
      "Document locks prevent duplicate concurrent generation per company/type.",
    ],
    tables: [
      {
        title: "Documents Firestore Documents",
        columns: ["Path", "Purpose", "Key Fields"],
        rows: [
          [
            "companies/{companyId}/documents/{docId}",
            "Generated document record",
            "type, client fields, items, totals, createdBy, createdAt, downloadURL, storagePath, tax fields (for 305)",
          ],
          [
            "documentTasks/{taskId}",
            "Async task state",
            "status, type/taskType, documentType, documentId, uid, companyId, pubsubMessageId, queuedAt, previewURL/downloadURL, error",
          ],
          [
            "companies/{companyId}/documentLocks/{lockType}",
            "Generation lock",
            "lockedBy, taskId, lockedAt",
          ],
          [
            "companies/{companyId}/auditLogs/{logId}",
            "Audit trail",
            "action, performedBy, timestamp, documentId, documentType",
          ],
          [
            "taxAuthPending/{authId}",
            "OAuth pending session",
            "state, stateNonce, status, expiresAt, companyId, uid",
          ],
          [
            "taxAuthCallbacks/{authId}",
            "OAuth callback + exchange result",
            "code, used, tokenExchangeSuccess, tokenExchangeError, accessTokenExpiresAt",
          ],
          [
            "companies/{companyId}/data/token",
            "Stored OAuth tokens",
            "accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt",
          ],
        ],
      },
      {
        title: "Documents API Contracts",
        columns: ["Function", "Input (high level)", "Writes"],
        rows: [
          [
            "publishPreviewTask (callable)",
            "documentType, companyId, documentData.client/items",
            "documentTasks/{taskId} pending/queued",
          ],
          [
            "publishGenerateTask (callable)",
            "documentType, companyId, documentData or documentId (type 305)",
            "documentTasks/{taskId} pending/queued, business_info.document_numbers increment (non-305)",
          ],
          [
            "getInvoiceApproval (callable, me-west1)",
            "type 305, companyId, client, items, date/language/notes/jobsData",
            "documents/{docId}, jobs isCert updates, proposal usage flags, company cache versions, audit log, generate task enqueue",
          ],
          [
            "deleteDocumentV1 (callable)",
            "companyId, documentId",
            "document delete + company cache.documentsVersion",
          ],
          [
            "startTaxAuthorityAuth / taxAuthorityCallback",
            "manager auth and OAuth callback payload",
            "taxAuthPending, taxAuthCallbacks, companies/{companyId}/data/token",
          ],
        ],
      },
      {
        title: "Cloud Run PDF Output",
        columns: ["Layer", "Path/Location", "Written Fields"],
        rows: [
          [
            "Storage preview",
            "previews/{uid}/{fileName}.pdf",
            "metadata includes documentType, taskId, expiresAt, firebaseStorageDownloadTokens",
          ],
          [
            "Storage final PDF",
            "companies/{companyId}/{YYYY-MM}/{documentId}/{documentId}.pdf",
            "metadata includes documentId, documentType, companyId, createdBy, generatedAt, pdfSize",
          ],
          [
            "Task completion",
            "documentTasks/{taskId}",
            "status completed/failed, previewURL/downloadURL, storagePath, pdfSize, processingTimeMs, emailSent fields",
          ],
        ],
      },
    ],
  },
  {
    slug: "data-structures-inventory",
    title: "Inventory Data Structures",
    summary: "Company and personal inventory schemas plus pick and mutation actions.",
    body: [
      "Inventory is modeled as single docs containing parts arrays (not subcollections).",
      "updateInventoryV1 handles both company and user scopes.",
      "Pick operations can deduct company stock and merge into personal stock using sourcePartId.",
    ],
    tables: [
      {
        title: "Inventory Firestore Documents",
        columns: ["Path", "Purpose", "Key Fields"],
        rows: [
          [
            "companies/{companyId}/data/inventory",
            "Shared company stock",
            "parts[], nextId, lastUpdated",
          ],
          [
            "users/{uid}/data/inventory",
            "Personal stock",
            "parts[], nextId, lastUpdated, optional sourcePartId per part",
          ],
          [
            "users/{uid}/data/cache",
            "Personal inventory invalidation",
            "inventory, lastUpdated",
          ],
          [
            "companies/{companyId}/data/cache",
            "Company-level invalidation",
            "updatedAt (and summary versions from other flows)",
          ],
          [
            "companies/{companyId}/inventory_picks/{pickId}",
            "Reserved path in rules",
            "No active writer in current codebase",
          ],
        ],
      },
      {
        title: "updateInventoryV1 Actions",
        columns: ["Action", "Required Inputs", "Behavior"],
        rows: [
          ["addPart", "companyId, scope, partName", "Adds part with id from nextId and bumps nextId"],
          ["removePart", "companyId, scope, partId", "Removes part from parts[]"],
          ["togglePart", "companyId, scope, partId", "Flips active flag"],
          ["updatePart", "companyId, scope, partId", "Updates name/quantity/lowThreshold/active"],
          ["pickParts", "companyId, scope=company, targetUid, partsToPick[]", "Checks stock, deducts company quantities, merges into user inventory"],
          ["replaceParts", "companyId, scope, parts[]", "Sanitizes and replaces full parts array"],
        ],
      },
    ],
  },
  {
    slug: "api-database-tables",
    title: "API / Database Tables",
    summary: "Tabular handoff reference for paths, schemas, and write contracts.",
    body: [
      "Use this page as a compact handoff sheet for implementation and AI-assisted work.",
      "For exhaustive detail, keep DATA_STRUCTURES.md as the canonical long-form reference.",
      "All writes for clients/jobs/documents/invites/workers are server-side (Cloud Functions/Admin SDK).",
    ],
    tables: [
      {
        title: "Database Paths (Core)",
        columns: ["Path", "Domain", "Primary Keys/Fields"],
        rows: [
          ["users/{uid}/data/profile", "Auth", "uid, role, companyId, accountType, pushToken*"],
          ["users/{uid}/data/cache", "Cache", "profile, inventory, subscription, lastUpdated"],
          ["users/{uid}/data/inventory", "Inventory", "parts[], nextId, lastUpdated"],
          ["companies/{companyId}", "Company", "companyId, cid, wid, jid, createdBy"],
          ["companies/{companyId}/workers/{wid}", "Auth", "workerId, uid, role, email, wid"],
          ["companies/{companyId}/clients/{clientId}", "Clients", "name, contact fields, vatNumber, notes"],
          ["companies/{companyId}/jobs/{jobId}", "Jobs", "id, jid, status, assignment, client fields, work result fields"],
          ["companies/{companyId}/documents/{docId}", "Documents", "type, client fields, totals, downloadURL, storagePath, tax fields"],
          ["companies/{companyId}/data/business_info", "Auth/Documents", "vat_number, business_type, document_numbers, contact fields"],
          ["companies/{companyId}/data/subscription", "Auth/Billing", "tier, status, enabledModules, expiresAt"],
          ["companies/{companyId}/data/cache", "Cache", "jobsVersion, documentsVersion, clientsVersion, workersVersion, updatedAt"],
          ["companies/{companyId}/data/token", "Tax", "access/refresh tokens and expiry fields"],
          ["documentTasks/{taskId}", "Documents", "status lifecycle, URLs, errors, processing metadata"],
          ["upgrade_requests/{requestId}", "Misc", "uid, tiers, message, status"],
          ["contact_requests/{requestId}", "Misc", "name, email, company, message, status"],
          ["conversations/{conversationId}", "Support", "userId, status, category, unread counters, inline messageN fields"],
        ],
      },
      {
        title: "API Surface (Core)",
        columns: ["Endpoint/Function", "Type", "Main Inputs", "Main Writes"],
        rows: [
          ["registerBusinessV1", "Callable", "role, accountType, profile + business fields", "profile, company root, workers, business_info, subscription, inventories, cache"],
          ["manageWorker", "Callable", "action add/edit/delete, companyId, email", "auth user + profile/worker/cache/counter writes"],
          ["createInviteV1", "HTTP POST", "companyId, targetRole", "invites/{inviteId}"],
          ["joinCompanyV1", "HTTP POST", "companyId, inviteCode, email, optional role/name/phone", "invites, workers, profile, company cache"],
          ["addClientV1 / updateClientV1 / deleteClientV1", "Callable", "companyId + client payload", "clients docs + company cache.clientsVersion"],
          ["createJobV1 / updateJobV1 / acceptJobV1 / deleteJobV1", "Callable", "companyId + job payload", "jobs docs + cache.jobsVersion + optional inventory effects"],
          ["updateInventoryV1", "Callable", "companyId, scope, action, action payload", "inventory docs + user/company cache"],
          ["publishPreviewTask / publishGenerateTask", "Callable", "documentType, companyId, documentData/documentId", "documentTasks + counters"],
          ["getInvoiceApproval", "Callable (me-west1)", "type=305, companyId, client, items", "documents, jobs/proposals, cache, audit logs, documentTasks"],
          ["deleteDocumentV1", "Callable", "companyId, documentId", "documents delete + cache.documentsVersion"],
          ["requestUpgradeV1", "HTTP POST", "requestedTier, currentTier, message", "upgrade_requests"],
          ["contactRequestV1", "HTTP POST", "name, email, company, message", "contact_requests"],
        ],
      },
    ],
    links: [
      { label: "Master Data Structures", href: "/docs/data-structures-master" },
      { label: "Auth Module", href: "/docs/data-structures-auth" },
      { label: "Jobs Module", href: "/docs/data-structures-jobs" },
      { label: "Documents Module", href: "/docs/data-structures-documents" },
      { label: "Inventory Module", href: "/docs/data-structures-inventory" },
    ],
  },
];

export const docsBySlug = Object.fromEntries(docs.map((item) => [item.slug, item])) as Record<string, DocEntry>;
