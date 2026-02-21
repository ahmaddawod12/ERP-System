/**
 * @smart-job/contracts
 * TypeScript type declarations for the shared contracts package.
 */

// ── Roles ──────────────────────────────────────────────────────────────────
export type RoleTitle = 'manager' | 'worker' | 'user' | 'basic' | 'dev';
export type RoleLowercase = 'manager' | 'worker' | 'user' | 'basic' | 'dev';

export declare const Role: Readonly<Record<RoleTitle, RoleTitle>>;
export declare const RoleLower: Readonly<Record<RoleLowercase, RoleLowercase>>;

// ── Job Status ─────────────────────────────────────────────────────────────
export type JobStatusValue = 'pending' | 'received' | 'waiting' | 'finished' | 'denied';

export declare const JobStatus: Readonly<{
  Pending: 'pending';
  Received: 'received';
  Waiting: 'waiting';
  Finished: 'finished';
  Denied: 'denied';
}>;

export declare const ACTIVE_JOB_STATUSES: readonly ['pending', 'received', 'waiting'];

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

// ── Job ID Prefixes ────────────────────────────────────────────────────────
export declare const JobPrefix: Readonly<{
  Pending: 'p_';
  Finished: 'f_';
  Certification: 'c_';
}>;

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
  worker(companyId: string, uid: string): string;
  workers(companyId: string): string;
  client(companyId: string, clientId: string): string;
  clients(companyId: string): string;
  pendingJob(companyId: string, jobId: string): string;
  pendingJobs(companyId: string): string;
  finishedJob(companyId: string, jobId: string): string;
  finishedJobs(companyId: string): string;
  certification(companyId: string, certId: string): string;
  certifications(companyId: string): string;
  invite(companyId: string, inviteId: string): string;

  upgradeRequest(id: string): string;
  contactRequest(id: string): string;
  documentTask(id: string): string;
};

export declare function resolveCompanyScope(companyId: string | null | undefined, uid: string): string;
