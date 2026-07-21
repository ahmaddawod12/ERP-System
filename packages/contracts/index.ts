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

export const TaxAuthorityStatus = Object.freeze({
  None: 'none',
  Reserved: 'reserved',
  Submitted: 'submitted',
  Approved: 'approved',
  Rejected: 'rejected',
  Failed: 'failed',
  Burned: 'burned',
} as const);

export type TaxAuthorityStatusValue =
  (typeof TaxAuthorityStatus)[keyof typeof TaxAuthorityStatus];

export const TaxSubmissionMode = Object.freeze({
  Disabled: 'disabled',
  Sandbox: 'sandbox',
  Production: 'production',
} as const);

export type TaxSubmissionModeValue =
  (typeof TaxSubmissionMode)[keyof typeof TaxSubmissionMode];

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

export const DOC_LABELS = Object.freeze({
  [DOC_TYPE.PRICE_PROPOSAL]: { en: 'Price Proposal', he: 'הצעת מחיר', ar: 'عرض سعر' },
  [DOC_TYPE.DELIVERY_NOTE]: { en: 'Delivery Note', he: 'תעודת משלוח', ar: 'إشعار تسليم' },
  [DOC_TYPE.RETURN_CERTIFICATE]: { en: 'Return Certificate', he: 'תעודת החזרה', ar: 'شهادة إرجاع' },
  [DOC_TYPE.TAX_INVOICE]: { en: 'Tax Invoice', he: 'חשבונית מס', ar: 'فاتورة ضريبية' },
  [DOC_TYPE.REFUND]: { en: 'Refund', he: 'זיכוי', ar: 'استرداد' },
  [DOC_TYPE.RECEIPT]: { en: 'Receipt', he: 'קבלה', ar: 'إيصال' },
} as const satisfies Record<DocTypeCode, { en: string; he: string; ar: string }>);

export const DOC_COLORS = Object.freeze({
  [DOC_TYPE.PRICE_PROPOSAL]: '#3B82F6',
  [DOC_TYPE.DELIVERY_NOTE]: '#8B5CF6',
  [DOC_TYPE.RETURN_CERTIFICATE]: '#EC4899',
  [DOC_TYPE.TAX_INVOICE]: '#10B981',
  [DOC_TYPE.REFUND]: '#F59E0B',
  [DOC_TYPE.RECEIPT]: '#06B6D4',
} as const satisfies Record<DocTypeCode, string>);

export const DOC_GRADIENTS = Object.freeze({
  [DOC_TYPE.PRICE_PROPOSAL]: ['#3B82F6', '#2563EB'],
  [DOC_TYPE.DELIVERY_NOTE]: ['#8B5CF6', '#7C3AED'],
  [DOC_TYPE.RETURN_CERTIFICATE]: ['#EC4899', '#DB2777'],
  [DOC_TYPE.TAX_INVOICE]: ['#10B981', '#059669'],
  [DOC_TYPE.REFUND]: ['#F59E0B', '#D97706'],
  [DOC_TYPE.RECEIPT]: ['#06B6D4', '#0891B2'],
} as const satisfies Record<DocTypeCode, [string, string]>);

export const DOC_ICONS = Object.freeze({
  [DOC_TYPE.PRICE_PROPOSAL]: 'file-document-edit',
  [DOC_TYPE.DELIVERY_NOTE]: 'truck-delivery',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'file-certificate',
  [DOC_TYPE.TAX_INVOICE]: 'file-document',
  [DOC_TYPE.REFUND]: 'cash-refund',
  [DOC_TYPE.RECEIPT]: 'receipt',
} as const satisfies Record<DocTypeCode, string>);

export function getDocumentLabel(code: number, language: string): string {
  const labels = DOC_LABELS[code as DocTypeCode];
  if (!labels) return 'Document';
  return labels[language as keyof typeof labels] ?? labels.en ?? 'Document';
}

export const AccountType = Object.freeze({
  Solo: 'solo',
  Business: 'business',
} as const);

export type AccountTypeValue = (typeof AccountType)[keyof typeof AccountType];

export const ACCOUNT_TYPE_VALUES = Object.freeze([
  AccountType.Solo,
  AccountType.Business,
] as const);

export const RegistrationMode = Object.freeze({
  Basic: 'basic',
  Solo: 'solo',
  Business: 'business',
} as const);

export type RegistrationModeValue = (typeof RegistrationMode)[keyof typeof RegistrationMode];

export const REGISTRATION_MODE_VALUES = Object.freeze([
  RegistrationMode.Basic,
  RegistrationMode.Solo,
  RegistrationMode.Business,
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
    clients: true,
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
