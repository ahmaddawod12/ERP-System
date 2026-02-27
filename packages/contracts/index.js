/**
 * @smart-job/contracts
 * Shared enums, constants, and Firestore path builders for the Smart-Job ERP monorepo.
 *
 * Consumed by: functions/, website/, phone_app/, cloudrun-pdf/, scripts/
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
  Received: 'received',
  Waiting:  'waiting',
  Finished: 'finished',
  Denied:   'denied',
});

/** Statuses that represent an active (pre-completion) job. */
const ACTIVE_JOB_STATUSES = [JobStatus.Pending, JobStatus.Received, JobStatus.Waiting];

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

// ── Job ID Prefixes ────────────────────────────────────────────────────────
const JobPrefix = Object.freeze({
  Pending:       'p_',
  Finished:      'f_',
  Document: 'd_',
});

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
  worker:             (cid, uid) => `companies/${cid}/workers/${uid}`,
  workers:            (cid) => `companies/${cid}/workers`,
  client:             (cid, clientId) => `companies/${cid}/clients/${clientId}`,
  clients:            (cid) => `companies/${cid}/clients`,
  pendingJob:         (cid, jobId) => `companies/${cid}/PendingJobs/${jobId}`,
  pendingJobs:        (cid) => `companies/${cid}/PendingJobs`,
  finishedJob:        (cid, jobId) => `companies/${cid}/finishedJobs/${jobId}`,
  finishedJobs:       (cid) => `companies/${cid}/finishedJobs`,
  document:      (cid, docId) => `companies/${cid}/documents/${docId}`,
  documents:     (cid) => `companies/${cid}/documents`,
  invite:             (cid, inviteId) => `companies/${cid}/invites/${inviteId}`,

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
  JobPrefix,
  Tier,
  SubStatus,
  paths,
  resolveCompanyScope,
};
