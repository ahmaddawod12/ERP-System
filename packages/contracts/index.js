/**
 * @smart-job/contracts
 * Shared enums, constants, and Firestore path builders for the Smart-Job ERP monorepo.
 *
 * Consumed by: functions/, website/, phone_app/, cloudrun-pdf/, scripts/
 *
 * v2 (2026-02-28): Unified jobs collection, removed ID prefixes, summary-based cache.
 */

// ── Roles ──────────────────────────────────────────────────────────────────
/** Canonical lowercase roles as stored in Firestore profile docs. */
const Role = Object.freeze({
  manager: 'manager',
  worker:  'worker',
  user:    'user',
  basic:   'basic',
  dev:     'dev',
});

/** Lowercase role set used for internal permission checks. */
const RoleLower = Object.freeze({
  manager: 'manager',
  worker:  'worker',
  user:    'user',
  basic:   'basic',
  dev:     'dev',
});

// ── Job Status ─────────────────────────────────────────────────────────────
const JobStatus = Object.freeze({
  Pending:  'pending',
  Waiting:  'waiting',
  Finished: 'finished',
  Denied:   'denied',
});

/** Statuses that represent an active (pre-completion) job. */
const ACTIVE_JOB_STATUSES = [JobStatus.Pending, JobStatus.Waiting];

// ── Document Type Codes ────────────────────────────────────────────────────
const DocType = Object.freeze({
  PriceProposal:      10,
  DeliveryNote:       200,
  ReturnCertificate:  210,
  TaxInvoice:         305,
  Refund:             330,
  Receipt:            400,
});

/** Reverse lookup: code → key name */
const DocTypeLabel = Object.freeze(
  Object.fromEntries(Object.entries(DocType).map(([k, v]) => [v, k]))
);

/**
 * SCREAMING_SNAKE alias – used by functions/, cloudrun-pdf/, and phone_app/ modules
 * that historically referenced DOC_TYPE.TAX_INVOICE etc.
 */
const DOC_TYPE = Object.freeze({
  PRICE_PROPOSAL:     DocType.PriceProposal,
  DELIVERY_NOTE:      DocType.DeliveryNote,
  RETURN_CERTIFICATE: DocType.ReturnCertificate,
  TAX_INVOICE:        DocType.TaxInvoice,
  REFUND:             DocType.Refund,
  RECEIPT:            DocType.Receipt,
});

/**
 * Document ID suffix codes used when generating document IDs.
 */
const DOC_SUFFIX = Object.freeze({
  [DOC_TYPE.TAX_INVOICE]:        'TI',
  [DOC_TYPE.PRICE_PROPOSAL]:     'PP',
  [DOC_TYPE.REFUND]:             'RD',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC',
  [DOC_TYPE.DELIVERY_NOTE]:      'DN',
  [DOC_TYPE.RECEIPT]:            'RT',
});

/** Israeli VAT rate (18%) — single source of truth across the monorepo. */
const VAT_RATE = 0.18;

// ── Subscription Tiers ─────────────────────────────────────────────────────
const Tier = Object.freeze({
  Basic: 'Basic',
  User:  'User',
  Team:  'Team',
  Dev:   'Dev',
});

const SubStatus = Object.freeze({
  Active:  'active',
  Trial:   'trial',
  Expired: 'expired',
});

// ── Firestore Path Builders ────────────────────────────────────────────────
const paths = {
  // User-scoped
  userProfile:   (uid) => `users/${uid}/data/profile`,
  userCache:     (uid) => `users/${uid}/data/cache`,
  userInventory: (uid) => `users/${uid}/data/inventory`,

  // Company-scoped
  companyRoot:        (cid) => `companies/${cid}`,
  businessInfo:       (cid) => `companies/${cid}/data/business_info`,
  subscription:       (cid) => `companies/${cid}/data/subscription`,
  companyInventory:   (cid) => `companies/${cid}/data/inventory`,
  companyCache:       (cid) => `companies/${cid}/data/cache`,
  worker:             (cid, wid) => `companies/${cid}/workers/${wid}`,
  workers:            (cid) => `companies/${cid}/workers`,
  manager:            (cid, mid) => `companies/${cid}/managers/${mid}`,
  managers:           (cid) => `companies/${cid}/managers`,
  client:             (cid, clientId) => `companies/${cid}/clients/${clientId}`,
  clients:            (cid) => `companies/${cid}/clients`,
  job:                (cid, jobId) => `companies/${cid}/jobs/${jobId}`,
  jobs:               (cid) => `companies/${cid}/jobs`,
  document:           (cid, docId) => `companies/${cid}/documents/${docId}`,
  documents:          (cid) => `companies/${cid}/documents`,
  invite:             (cid, inviteId) => `companies/${cid}/invites/${inviteId}`,

  // Counters (each counter is a separate doc with a single `next` field)
  counterWnext:       (cid) => `companies/${cid}/counters/wnext`,
  counterMnext:       (cid) => `companies/${cid}/counters/mnext`,
  counterCnext:       (cid) => `companies/${cid}/counters/cnext`,
  counterJnext:       (cid) => `companies/${cid}/counters/jnext`,

  // Top-level collections
  upgradeRequest:     (id) => `upgrade_requests/${id}`,
  contactRequest:     (id) => `contact_requests/${id}`,
  documentTask:       (id) => `documentTasks/${id}`,
};

/**
 * Resolve the effective companyId for data paths.
 * companyId must always come from the backend profile/company context.
 */
function resolveCompanyScope(companyId) {
  const normalized = String(companyId || '').trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}

// ── Exports ────────────────────────────────────────────────────────────────
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
  Tier,
  SubStatus,
  paths,
  resolveCompanyScope,
};
