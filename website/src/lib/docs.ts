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
    summary: "Understand Manager, Worker, User, Basic, and Dev access patterns.",
    body: [
      "Manager controls workers, jobs, company inventory, and clients.",
      "Worker handles assigned jobs and inventory picks.",
      "User (solo owner) manages own jobs and personal inventory.",
      "Basic keeps only clients and documents access; upgrade for jobs.",
      "Dev role is full-access for internal support and implementation.",
    ],
  },
  {
    slug: "job-lifecycle",
    title: "Job Lifecycle",
    summary: "Pending jobs move to completed history with status transitions.",
    body: [
      "Create jobs in PendingJobs with optional workerId assignment.",
      "Workers and managers update statuses as work progresses.",
      "When marked completed, job is copied into finishedJobs and removed from pending.",
      "Document generation can be triggered after completion.",
    ],
  },
  {
    slug: "inventory",
    title: "Inventory",
    summary: "Track company and personal inventory with quantity and threshold.",
    body: [
      "Team accounts store inventory under companies/{companyId}/business_data/inventory/parts.",
      "Solo users store personal items under users/{uid}/personal_inventory.",
      "Workers can submit inventory picks to decrement stock and log usage.",
      "Low threshold values help flag parts that need reordering.",
    ],
  },
  {
    slug: "documents-pdfs",
    title: "Documents / PDFs",
    summary: "Generate certifications with API tasks and optional Cloud Run forwarding.",
    body: [
      "Use /api/documents/generate to queue a certification task.",
      "The API writes into companies/{companyId}/certifications.",
      "If CLOUDRUN_PDF_URL is set, requests are forwarded to Cloud Run for advanced generation.",
      "Document history is visible in /app/documents.",
    ],
  },
  {
    slug: "cache-model-overview",
    title: "Cache Model Overview",
    summary: "Web UI favors optimistic updates while Firestore remains source of truth.",
    body: [
      "Client actions update UI quickly and then re-fetch latest Firestore snapshots.",
      "Server-side APIs handle sensitive operations: invites, counters, and upgrade requests.",
      "Use Firebase emulator suite locally for safe integration testing.",
      "Production deploys should monitor logs for API and function retries.",
    ],
  },
];

export const docsBySlug = Object.fromEntries(docs.map((item) => [item.slug, item])) as Record<string, DocEntry>;

