/**
 * @smart-job/contracts
 * TypeScript type declarations for the shared contracts package.
 * v2 (2026-02-28): Unified jobs collection, removed ID prefixes, summary-based cache.
 */

// ── Roles ──────────────────────────────────────────────────────────────────
export type RoleTitle = 'manager' | 'worker' | 'user' | 'basic' | 'dev';
export type RoleLowercase = 'manager' | 'worker' | 'user' | 'basic' | 'dev';

export declare const Role: Readonly<Record<RoleTitle, RoleTitle>>;
export declare const RoleLower: Readonly<Record<RoleLowercase, RoleLowercase>>;

// ── Job Status ─────────────────────────────────────────────────────────────
export type JobStatusValue = 'pending' | 'waiting' | 'finished' | 'denied';

export declare const JobStatus: Readonly<{
  Pending: 'pending';
  Waiting: 'waiting';
  Finished: 'finished';
  Denied: 'denied';
}>;

export declare const ACTIVE_JOB_STATUSES: readonly ['pending', 'waiting'];

// ── Document Type Codes ────────────────────────────────────────────────────
export type DocTypeCode = 10 | 200 | 210 | 305 | 330 | 400;

export declare const DocType: Readonly<{
  PriceProposal: 10;
  DeliveryNote: 200;
  ReturnCertificate: 210;
  TaxInvoice: 305;
  Refund: 330;
  Receipt: 400;
}>;

export declare const DocTypeLabel: Readonly<Record<DocTypeCode, string>>;

/** SCREAMING_SNAKE alias for DOC_TYPE constants used across the monorepo. */
export declare const DOC_TYPE: Readonly<{
  PRICE_PROPOSAL: 10;
  DELIVERY_NOTE: 200;
  RETURN_CERTIFICATE: 210;
  TAX_INVOICE: 305;
  REFUND: 330;
  RECEIPT: 400;
}>;

/** Document ID suffix codes. */
export declare const DOC_SUFFIX: Readonly<Record<DocTypeCode, string>>;

/** Israeli VAT rate (0.18). */
export declare const VAT_RATE: 0.18;

// ── Subscription ───────────────────────────────────────────────────────────
export type TierValue = 'Basic' | 'User' | 'Team' | 'Dev';
export type SubStatusValue = 'active' | 'trial' | 'expired';

export declare const Tier: Readonly<Record<TierValue, TierValue>>;
export declare const SubStatus: Readonly<Record<SubStatusValue, SubStatusValue>>;

// ── Firestore Path Builders ────────────────────────────────────────────────
export declare const paths: {
  userProfile(uid: string): string;
  userCache(uid: string): string;
  userInventory(uid: string): string;

  companyRoot(companyId: string): string;
  businessInfo(companyId: string): string;
  subscription(companyId: string): string;
  companyInventory(companyId: string): string;
  companyCache(companyId: string): string;
  worker(companyId: string, wid: string): string;
  workers(companyId: string): string;
  manager(companyId: string, mid: string): string;
  managers(companyId: string): string;
  client(companyId: string, clientId: string): string;
  clients(companyId: string): string;
  job(companyId: string, jobId: string): string;
  jobs(companyId: string): string;
  document(companyId: string, docId: string): string;
  documents(companyId: string): string;
  invite(companyId: string, inviteId: string): string;

  counterWnext(companyId: string): string;
  counterMnext(companyId: string): string;
  counterCnext(companyId: string): string;
  counterJnext(companyId: string): string;

  upgradeRequest(id: string): string;
  contactRequest(id: string): string;
  documentTask(id: string): string;
};

export declare function resolveCompanyScope(companyId: string | null | undefined): string;
