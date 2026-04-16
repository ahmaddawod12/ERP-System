/**
 * @smart-job/contracts
 * Shared enums, constants, and Firestore path builders for the Smart-Job ERP monorepo.
 *
 * Consumed by: functions/, website/, phone_app/, cloudrun-pdf/, scripts/
 *
 * v3 (2026-04-04): Canonical account-type and subscription-tier semantics.
 */

// Roles
const Role = Object.freeze({
  manager: 'manager',
  worker: 'worker',
  user: 'user',
  basic: 'basic',
  dev: 'dev',
});

const RoleLower = Object.freeze({
  manager: 'manager',
  worker: 'worker',
  user: 'user',
  basic: 'basic',
  dev: 'dev',
});

// Job status
const JobStatus = Object.freeze({
  Pending: 'pending',
  Waiting: 'waiting',
  Finished: 'finished',
  Denied: 'denied',
});

const ACTIVE_JOB_STATUSES = [JobStatus.Pending, JobStatus.Waiting];

// Document types
const DocType = Object.freeze({
  PriceProposal: 10,
  DeliveryNote: 200,
  ReturnCertificate: 210,
  TaxInvoice: 305,
  Refund: 330,
  Receipt: 400,
});

const DocTypeLabel = Object.freeze(
  Object.fromEntries(Object.entries(DocType).map(([key, value]) => [value, key])),
);

const DOC_TYPE = Object.freeze({
  PRICE_PROPOSAL: DocType.PriceProposal,
  DELIVERY_NOTE: DocType.DeliveryNote,
  RETURN_CERTIFICATE: DocType.ReturnCertificate,
  TAX_INVOICE: DocType.TaxInvoice,
  REFUND: DocType.Refund,
  RECEIPT: DocType.Receipt,
});

const DOC_SUFFIX = Object.freeze({
  [DOC_TYPE.TAX_INVOICE]: 'TI',
  [DOC_TYPE.PRICE_PROPOSAL]: 'PP',
  [DOC_TYPE.REFUND]: 'RD',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC',
  [DOC_TYPE.DELIVERY_NOTE]: 'DN',
  [DOC_TYPE.RECEIPT]: 'RT',
});

const VAT_RATE = 0.18;

// Account type / subscription tiers
const AccountType = Object.freeze({
  Solo: 'solo',
  Business: 'business',
});

const ACCOUNT_TYPE_VALUES = Object.freeze([
  AccountType.Solo,
  AccountType.Business,
]);

const Tier = Object.freeze({
  Basic: 'Basic',
  Solo: 'Solo',
  Team: 'Team',
  Enterprise: 'Enterprise',
});

const TIER_VALUES = Object.freeze([
  Tier.Basic,
  Tier.Solo,
  Tier.Team,
  Tier.Enterprise,
]);

const UPGRADEABLE_TIERS = Object.freeze([
  Tier.Solo,
  Tier.Team,
  Tier.Enterprise,
]);

const TIER_RANK = Object.freeze({
  [Tier.Basic]: 0,
  [Tier.Solo]: 1,
  [Tier.Team]: 2,
  [Tier.Enterprise]: 3,
});

const SubStatus = Object.freeze({
  Active: 'active',
  Trial: 'trial',
  Expired: 'expired',
});

function normalizeAccountType(accountType) {
  const raw = String(accountType || '').trim().toLowerCase();
  return ACCOUNT_TYPE_VALUES.includes(raw) ? raw : '';
}

function normalizeTier(tier) {
  const raw = String(tier || '').trim();
  return TIER_VALUES.includes(raw) ? raw : '';
}

function getTierRank(tier) {
  const normalized = normalizeTier(tier);
  return normalized ? TIER_RANK[normalized] : TIER_RANK[Tier.Basic];
}

function getSubscriptionTierForRole(role, accountType) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedAccountType = normalizeAccountType(accountType);

  if (normalizedRole === Role.basic) return Tier.Basic;
  if (normalizedRole === Role.dev) return Tier.Enterprise;
  if (normalizedRole === Role.manager || normalizedRole === Role.worker) return Tier.Team;
  if (normalizedRole === Role.user && normalizedAccountType === AccountType.Business) return Tier.Team;
  return Tier.Solo;
}

function getEnabledModulesForTier(tier) {
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

// Firestore paths
const paths = {
  userProfile: (uid) => `users/${uid}/data/profile`,
  userCache: (uid) => `users/${uid}/data/cache`,
  userInventory: (uid) => `users/${uid}/data/inventory`,

  companyRoot: (companyId) => `companies/${companyId}`,
  businessInfo: (companyId) => `companies/${companyId}/data/business_info`,
  subscription: (companyId) => `companies/${companyId}/data/subscription`,
  companyInventory: (companyId) => `companies/${companyId}/data/inventory`,
  companyCache: (companyId) => `companies/${companyId}/data/cache`,
  worker: (companyId, wid) => `companies/${companyId}/workers/${wid}`,
  workers: (companyId) => `companies/${companyId}/workers`,
  manager: (companyId, mid) => `companies/${companyId}/managers/${mid}`,
  managers: (companyId) => `companies/${companyId}/managers`,
  client: (companyId, clientId) => `companies/${companyId}/clients/${clientId}`,
  clients: (companyId) => `companies/${companyId}/clients`,
  job: (companyId, jobId) => `companies/${companyId}/jobs/${jobId}`,
  jobs: (companyId) => `companies/${companyId}/jobs`,
  document: (companyId, docId) => `companies/${companyId}/documents/${docId}`,
  documents: (companyId) => `companies/${companyId}/documents`,
  invite: (companyId, inviteId) => `companies/${companyId}/invites/${inviteId}`,

  counterWnext: (companyId) => `companies/${companyId}/counters/wnext`,
  counterMnext: (companyId) => `companies/${companyId}/counters/mnext`,
  counterCnext: (companyId) => `companies/${companyId}/counters/cnext`,
  counterJnext: (companyId) => `companies/${companyId}/counters/jnext`,

  upgradeRequest: (id) => `upgrade_requests/${id}`,
  contactRequest: (id) => `contact_requests/${id}`,
  documentTask: (id) => `documentTasks/${id}`,
};

function resolveCompanyScope(companyId) {
  const normalized = String(companyId || '').trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}

module.exports = {
  Role,
  RoleLower,
  JobStatus,
  ACTIVE_JOB_STATUSES,
  DocType,
  DocTypeLabel,
  DOC_TYPE,
  DOC_SUFFIX,
  VAT_RATE,
  AccountType,
  ACCOUNT_TYPE_VALUES,
  Tier,
  TIER_VALUES,
  UPGRADEABLE_TIERS,
  TIER_RANK,
  SubStatus,
  normalizeAccountType,
  normalizeTier,
  getTierRank,
  getSubscriptionTierForRole,
  getEnabledModulesForTier,
  paths,
  resolveCompanyScope,
};
