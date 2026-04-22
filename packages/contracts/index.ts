export const Role = Object.freeze({
  manager: 'manager',
  worker: 'worker',
  user: 'user',
  basic: 'basic',
  dev: 'dev',
} as const);

export type RoleTitle = (typeof Role)[keyof typeof Role];

export const JobStatus = Object.freeze({
  Pending: 'pending',
  Waiting: 'waiting',
  Finished: 'finished',
  Denied: 'denied',
} as const);

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

export const DocType = Object.freeze({
  PriceProposal: 10,
  DeliveryNote: 200,
  ReturnCertificate: 210,
  TaxInvoice: 305,
  Refund: 330,
  Receipt: 400,
} as const);

export type DocTypeCode = (typeof DocType)[keyof typeof DocType];

export const DocTypeLabel = Object.freeze(
  Object.fromEntries(Object.entries(DocType).map(([key, value]) => [value, key])) as Record<DocTypeCode, string>,
);

export const DOC_TYPE = Object.freeze({
  PRICE_PROPOSAL: DocType.PriceProposal,
  DELIVERY_NOTE: DocType.DeliveryNote,
  RETURN_CERTIFICATE: DocType.ReturnCertificate,
  TAX_INVOICE: DocType.TaxInvoice,
  REFUND: DocType.Refund,
  RECEIPT: DocType.Receipt,
} as const);

export const DOC_SUFFIX = Object.freeze({
  [DOC_TYPE.TAX_INVOICE]: 'TI',
  [DOC_TYPE.PRICE_PROPOSAL]: 'PP',
  [DOC_TYPE.REFUND]: 'RD',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC',
  [DOC_TYPE.DELIVERY_NOTE]: 'DN',
  [DOC_TYPE.RECEIPT]: 'RT',
} as const satisfies Record<DocTypeCode, string>);

export const VAT_RATE = 0.18;

export const AccountType = Object.freeze({
  Solo: 'solo',
  Business: 'business',
} as const);

export type AccountTypeValue = (typeof AccountType)[keyof typeof AccountType];

export const ACCOUNT_TYPE_VALUES = Object.freeze([
  AccountType.Solo,
  AccountType.Business,
] as const);

export const Tier = Object.freeze({
  Basic: 'Basic',
  Solo: 'Solo',
  Team: 'Team',
  Enterprise: 'Enterprise',
} as const);

export type TierValue = (typeof Tier)[keyof typeof Tier];

export const TIER_VALUES = Object.freeze([
  Tier.Basic,
  Tier.Solo,
  Tier.Team,
  Tier.Enterprise,
] as const);

export const UPGRADEABLE_TIERS = Object.freeze([
  Tier.Solo,
  Tier.Team,
  Tier.Enterprise,
] as const);

export const TIER_RANK = Object.freeze({
  [Tier.Basic]: 0,
  [Tier.Solo]: 1,
  [Tier.Team]: 2,
  [Tier.Enterprise]: 3,
} as const satisfies Record<TierValue, number>);

export const SubStatus = Object.freeze({
  Active: 'active',
  Trial: 'trial',
  Expired: 'expired',
} as const);

export type SubStatusValue = (typeof SubStatus)[keyof typeof SubStatus];

function includesValue<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return (values as readonly string[]).includes(value);
}

export function normalizeAccountType(accountType?: string | null): AccountTypeValue | '' {
  const raw = String(accountType || '').trim().toLowerCase();
  return includesValue(ACCOUNT_TYPE_VALUES, raw) ? raw : '';
}

export function normalizeTier(tier?: string | null): TierValue | '' {
  const raw = String(tier || '').trim();
  return includesValue(TIER_VALUES, raw) ? raw : '';
}

export function getTierRank(tier?: string | null): number {
  const normalized = normalizeTier(tier);
  return normalized ? TIER_RANK[normalized] : TIER_RANK[Tier.Basic];
}

export function getSubscriptionTierForRole(role?: string | null, accountType?: string | null): TierValue {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedAccountType = normalizeAccountType(accountType);

  if (normalizedRole === Role.basic) return Tier.Basic;
  if (normalizedRole === Role.dev) return Tier.Enterprise;
  if (normalizedRole === Role.manager || normalizedRole === Role.worker) return Tier.Team;
  if (normalizedRole === Role.user && normalizedAccountType === AccountType.Business) return Tier.Team;
  return Tier.Solo;
}

export function getEnabledModulesForTier(tier?: string | null) {
  const resolvedTier = normalizeTier(tier) || Tier.Basic;
  const isBasic = resolvedTier === Tier.Basic;
  const isTeamOrAbove = getTierRank(resolvedTier) >= getTierRank(Tier.Team);

  return {
    team: isTeamOrAbove,
    solojob: !isBasic,
    documents: true,
    teaminventory: isTeamOrAbove,
    companyinventory: isTeamOrAbove,
    inventory: !isBasic,
  };
}

export const paths = {
  userProfile: (uid: string) => `users/${uid}/data/profile`,
  userCache: (uid: string) => `users/${uid}/data/cache`,
  userInventory: (uid: string) => `users/${uid}/data/inventory`,

  companyRoot: (companyId: string) => `companies/${companyId}`,
  businessInfo: (companyId: string) => `companies/${companyId}/data/business_info`,
  subscription: (companyId: string) => `companies/${companyId}/data/subscription`,
  companyInventory: (companyId: string) => `companies/${companyId}/data/inventory`,
  companyCache: (companyId: string) => `companies/${companyId}/data/cache`,
  worker: (companyId: string, wid: string) => `companies/${companyId}/workers/${wid}`,
  workers: (companyId: string) => `companies/${companyId}/workers`,
  manager: (companyId: string, mid: string) => `companies/${companyId}/managers/${mid}`,
  managers: (companyId: string) => `companies/${companyId}/managers`,
  client: (companyId: string, clientId: string) => `companies/${companyId}/clients/${clientId}`,
  clients: (companyId: string) => `companies/${companyId}/clients`,
  job: (companyId: string, jobId: string) => `companies/${companyId}/jobs/${jobId}`,
  jobs: (companyId: string) => `companies/${companyId}/jobs`,
  document: (companyId: string, docId: string) => `companies/${companyId}/documents/${docId}`,
  documents: (companyId: string) => `companies/${companyId}/documents`,
  invite: (companyId: string, inviteId: string) => `companies/${companyId}/invites/${inviteId}`,

  counterWnext: (companyId: string) => `companies/${companyId}/counters/wnext`,
  counterMnext: (companyId: string) => `companies/${companyId}/counters/mnext`,
  counterCnext: (companyId: string) => `companies/${companyId}/counters/cnext`,
  counterJnext: (companyId: string) => `companies/${companyId}/counters/jnext`,

  upgradeRequest: (id: string) => `upgrade_requests/${id}`,
  contactRequest: (id: string) => `contact_requests/${id}`,
  documentTask: (id: string) => `documentTasks/${id}`,
};

export function resolveCompanyScope(companyId?: string | null): string {
  const normalized = String(companyId || '').trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}
