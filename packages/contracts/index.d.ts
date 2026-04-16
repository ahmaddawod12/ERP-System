/**
 * @smart-job/contracts
 * TypeScript declarations for the shared contracts package.
 * v3 (2026-04-04): Canonical account-type and subscription-tier semantics.
 */

export type RoleTitle = 'manager' | 'worker' | 'user' | 'basic' | 'dev';
export type RoleLowercase = RoleTitle;

export declare const Role: Readonly<Record<RoleTitle, RoleTitle>>;
export declare const RoleLower: Readonly<Record<RoleLowercase, RoleLowercase>>;

export type JobStatusValue = 'pending' | 'waiting' | 'finished' | 'denied';
export declare const JobStatus: Readonly<{
  Pending: 'pending';
  Waiting: 'waiting';
  Finished: 'finished';
  Denied: 'denied';
}>;
export declare const ACTIVE_JOB_STATUSES: readonly ['pending', 'waiting'];

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
export declare const DOC_TYPE: Readonly<{
  PRICE_PROPOSAL: 10;
  DELIVERY_NOTE: 200;
  RETURN_CERTIFICATE: 210;
  TAX_INVOICE: 305;
  REFUND: 330;
  RECEIPT: 400;
}>;
export declare const DOC_SUFFIX: Readonly<Record<DocTypeCode, string>>;
export declare const VAT_RATE: 0.18;

export type AccountTypeValue = 'solo' | 'business';
export type TierValue = 'Basic' | 'Solo' | 'Team' | 'Enterprise';
export type SubStatusValue = 'active' | 'trial' | 'expired';

export declare const AccountType: Readonly<{
  Solo: 'solo';
  Business: 'business';
}>;
export declare const ACCOUNT_TYPE_VALUES: readonly ['solo', 'business'];
export declare const Tier: Readonly<Record<TierValue, TierValue>>;
export declare const TIER_VALUES: readonly ['Basic', 'Solo', 'Team', 'Enterprise'];
export declare const UPGRADEABLE_TIERS: readonly ['Solo', 'Team', 'Enterprise'];
export declare const TIER_RANK: Readonly<Record<TierValue, number>>;
export declare const SubStatus: Readonly<Record<SubStatusValue, SubStatusValue>>;
export declare function normalizeAccountType(accountType: string | null | undefined): AccountTypeValue | '';
export declare function normalizeTier(tier: string | null | undefined): TierValue | '';
export declare function getTierRank(tier: TierValue | string | null | undefined): number;
export declare function getSubscriptionTierForRole(
  role: RoleTitle | string | null | undefined,
  accountType?: AccountTypeValue | string | null | undefined,
): TierValue;
export declare function getEnabledModulesForTier(tier: TierValue | string | null | undefined): {
  team: boolean;
  solojob: boolean;
  documents: boolean;
  teaminventory: boolean;
  companyinventory: boolean;
  inventory: boolean;
};

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
