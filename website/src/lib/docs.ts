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
    summary: "Create an account, complete onboarding, and use the protected app routes.",
    body: [
      "Sign in with Supabase auth and complete onboarding on the website.",
      "Managers create business workspaces; workers/basic members join via invite flow.",
      "The website uses an opaque Postgres-backed session and a server-only BFF; browsers never call Cloud Run directly.",
      "Core runtime data is SQL-first through the Cloud Run API.",
    ],
  },
  {
    slug: "runtime-boundaries",
    title: "Runtime Boundaries",
    summary: "Understand where reads/writes execute and which layer owns each responsibility.",
    body: [
      "The Cloud Run API is the backend trust boundary in this repository.",
      "Primary company-scoped entities (jobs, clients, documents, inventory, memberships) are SQL-owned.",
      "Firestore remains for compatibility and operational paths only.",
      "Cloud Run PDF and Archiver services handle asynchronous document generation and archive lifecycle.",
    ],
    tables: [
      {
        title: "Ownership Map",
        columns: ["Area", "Primary Layer", "Notes"],
        rows: [
          ["Identity", "Supabase Auth", "uid is canonical identity"],
          ["Tenant scope", "SQL companies + memberships", "companyId normalized to internal UUID server-side"],
          ["Jobs/Clients/Documents/Inventory", "PostgreSQL", "Accessed via gateway handlers and read-model"],
          ["Files", "Cloud Storage", "Persist storagePath, issue signed URLs on demand"],
          ["Operational compatibility", "Firestore", "Limited residual mirrors/locks/metadata"],
        ],
      },
    ],
  },
  {
    slug: "job-lifecycle",
    title: "Job Lifecycle",
    summary: "Canonical statuses and mutation flow for jobs.",
    body: [
      "Valid statuses are pending, waiting, finished, and denied.",
      "Create/update/delete/accept operations go through mutation gateway handlers.",
      "Company job counters are SQL-backed and allocated through shared counter helpers.",
      "Read-model responses preserve canonical short identity fields: wid, wname, mid, mname, cid, cname, cphone.",
    ],
    tables: [
      {
        title: "Job APIs",
        columns: ["Operation", "Input", "Outcome"],
        rows: [
          ["createJobV1", "companyId + job payload", "Creates SQL job and optional part usages"],
          ["updateJobV1", "companyId + jobId + patch", "Updates SQL job and optional part usages"],
          ["acceptJobV1", "companyId + jobId", "Marks job as finished with accepted metadata"],
          ["deleteJobV1", "companyId + jobId", "Deletes SQL job (attachments/usages cascade)"]
        ],
      },
    ],
  },
  {
    slug: "documents-pdfs",
    title: "Documents and PDFs",
    summary: "Asynchronous document flow and task tracking.",
    body: [
      "publishPreviewTask and publishGenerateTask enqueue SQL-backed document_tasks entries.",
      "Task URLs are split by type: preview_url for preview tasks and generate_url for generate tasks.",
      "Generated artifacts persist canonical storagePath references; signed URLs are issued per request.",
      "Tax invoice submission is fail-closed pending certification; the legacy reservation handler cannot create documents or PDFs.",
    ],
    tables: [
      {
        title: "Task Status Contract",
        columns: ["Field", "Meaning", "Source"],
        rows: [
          ["previewURL", "Temporary preview download URL", "document_tasks.preview_url"],
          ["downloadURL", "Generated PDF download URL", "document_tasks.generate_url"],
          ["storagePath", "Canonical stored file reference", "documents.storage_path / task mirror"],
          ["status", "pending|queued|processing|completed|failed", "document_tasks.status"],
        ],
      },
    ],
  },
  {
    slug: "api-database-tables",
    title: "API and Data Contracts",
    summary: "Compact reference for backend surface and data constraints.",
    body: [
      "Use this page for high-level contracts only; canonical source remains architecture.md and packages/db schema.",
      "Do not implement MAX+1 allocation for company-scoped IDs.",
      "Do not persist durable public/bearer URLs on records; persist storagePath only.",
    ],
    tables: [
      {
        title: "Gateway Endpoints",
        columns: ["Route", "Purpose", "Region"],
        rows: [
          ["mutation-gateway", "Protected mutations", "default"],
          ["mutation-gateway-me-west1", "Tax approval mutations", "me-west1"],
          ["read-model", "Kind-based read projection", "default"],
        ],
      },
      {
        title: "Core Invariants",
        columns: ["Invariant", "Rule", "Enforcement"],
        rows: [
          ["Identity", "uid + companyId are canonical", "Auth and company access checks in handlers"],
          ["Counter allocation", "SQL counters only", "Cloud API + DB constraints"],
          ["Job statuses", "pending/waiting/finished/denied", "Enum + API validation"],
          ["File references", "storagePath persisted, signed URLs ephemeral", "Cloud API and Cloud Run logic"],
        ],
      },
    ],
    links: [
      { label: "Architecture", href: "/docs/getting-started" },
      { label: "Job Lifecycle", href: "/docs/job-lifecycle" },
      { label: "Documents and PDFs", href: "/docs/documents-pdfs" },
    ],
  },
];

export const docsBySlug = Object.fromEntries(docs.map((item) => [item.slug, item])) as Record<string, DocEntry>;
