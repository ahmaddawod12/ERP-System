export interface DocEntry {
  slug: string;
  title: string;
  summary: string;
  body: string[];
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
    summary: "Pending jobs transition through statuses to finished history.",
    body: [
      "Create jobs in PendingJobs with a generated p_XXXXX id and optional workerId assignment.",
      "Workers and managers update statuses: pending → waiting → finished (or denied).",
      "When marked finished, job is moved to finishedJobs with an f_XXXXX id.",
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
      "Workers can pick parts from company inventory, which adds them to their personal inventory.",
      "Low threshold values help flag parts that need reordering.",
    ],
  },
  {
    slug: "documents-pdfs",
    title: "Documents / PDFs",
    summary: "Generate documents via Pub/Sub Cloud Functions with PDF preview and generation.",
    body: [
      "Documents are created using publishPreviewTask and publishGenerateTask Cloud Functions (via Firebase callable).",
      "Tax Invoices (type 305) use getInvoiceApproval on me-west1 for Tax Authority approval before PDF generation.",
      "Document types: Price Proposal (10), Delivery Note (200), Return Certificate (210), Tax Invoice (305), Refund (330), Receipt (400).",
      "Tasks are tracked via documentTasks/{taskId} Firestore documents with status: pending → queued → completed/failed.",
      "The legacy /api/documents/generate route (generateDocumentV1) still exists for backward compatibility.",
      "Document history and document details are visible in /app/documents.",
    ],
  },
  {
    slug: "cache-model-overview",
    title: "Cache Model Overview",
    summary: "Web UI favors optimistic updates while Firestore remains source of truth.",
    body: [
      "Client actions update UI quickly and then re-fetch latest Firestore snapshots.",
      "Server-side APIs handle sensitive operations: invites, counters, onboarding joins, and upgrade requests.",
      "Use Firebase emulator suite locally for safe integration testing.",
      "Production deploys should monitor logs for API and function retries.",
    ],
  },
];

export const docsBySlug = Object.fromEntries(docs.map((item) => [item.slug, item])) as Record<string, DocEntry>;
