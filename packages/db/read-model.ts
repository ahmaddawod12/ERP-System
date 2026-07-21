import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  getDb,
  type DatabaseOptions,
  type SmartJobQueryExecutor,
} from './client';
import type { LegacyUserProfile } from './access';
import { getCompanySyncState } from './company-sync-state';
import {
  companies,
  companyCounters,
  companyProfiles,
  companySubscriptions,
  documentTasks,
  inventoryLocations,
  inventoryParts,
  documents,
  clients,
} from './schema';
import {
  getUserProfileByFirebaseUid,
  getUserProfileByFirebaseUidForCompany,
} from './access';
import {
  listCompanyWorkers,
  resolveCompanyByPublicId,
} from './membership';
import {
  getDocumentRecordById,
  listCompanyDocumentsDetailed,
} from './documents';
import {
  getJobRecordById,
  listCompanyJobsDetailed,
} from './jobs';

type QueryOptions = DatabaseOptions<SmartJobQueryExecutor>;
type InventoryScope = 'company' | 'user';
type InventorySnapshot = {
  parts: Array<{
    id: number;
    name: string;
    active: boolean;
    quantity: number;
    lowThreshold: number;
    dateAdded: string;
  }>;
  nextId: number;
  lastUpdated: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toIsoString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'object'
    && value !== null
    && 'toISOString' in value
    && typeof value.toISOString === 'function'
  ) return String(value.toISOString());
  return String(value);
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeProfileRole(profile: LegacyUserProfile | null | undefined): string {
  return String(profile?.role || '').trim().toLowerCase();
}

function shouldScopeSqlJobReads(profile: LegacyUserProfile): boolean {
  const role = normalizeProfileRole(profile);
  return role === 'worker' || (role === 'user' && String(profile?.accountType || '').trim().toLowerCase() !== 'solo');
}

function canReadSqlJobRecord(
  profile: LegacyUserProfile | null,
  jobRecord: ({ __sqlAssignedMembershipId?: unknown } & Record<string, unknown>) | null,
): boolean {
  if (!jobRecord || !profile) return false;
  const role = normalizeProfileRole(profile);
  if (role === 'basic') return false;
  if (!shouldScopeSqlJobReads(profile)) return true;
  const membershipId = String(profile?.membershipId || '').trim();
  return Boolean(membershipId) && String(jobRecord?.__sqlAssignedMembershipId || '').trim() === membershipId;
}

function canReadSqlDocumentRecord(profile: LegacyUserProfile | null): boolean {
  return normalizeProfileRole(profile) !== 'worker';
}

async function getCompanySubscription(
  internalCompanyId: string,
  options: QueryOptions = {},
) {
  const db = options.db || getDb(options.env);
  const rows = await db
    .select({
      tier: companySubscriptions.tier,
      status: companySubscriptions.status,
      enabledModules: companySubscriptions.enabledModules,
      expiresAt: companySubscriptions.expiresAt,
      updatedAt: companySubscriptions.updatedAt,
    })
    .from(companySubscriptions)
    .where(eq(companySubscriptions.companyId, internalCompanyId))
    .limit(1);
  const row = rows[0] || null;
  if (!row) return null;
  return {
    tier: row.tier,
    status: row.status,
    enabledModules: row.enabledModules || {},
    expiresAt: row.expiresAt ? toIsoString(row.expiresAt) : undefined,
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function getCompanyBusinessInfo(
  internalCompanyId: string,
  options: QueryOptions = {},
) {
  const db = options.db || getDb(options.env);
  const profileRows = await db
    .select({
      heName: companyProfiles.heName,
      enName: companyProfiles.enName,
      city: companyProfiles.city,
      address: companyProfiles.address,
      vatNumber: companyProfiles.vatNumber,
      businessType: companyProfiles.businessType,
      businessEmail: companyProfiles.businessEmail,
      businessPhone: companyProfiles.businessPhone,
      businessFax: companyProfiles.businessFax,
      accountantName: companyProfiles.accountantName,
      accountantEmail: companyProfiles.accountantEmail,
      accountantPhone: companyProfiles.accountantPhone,
      registeredAt: companyProfiles.registeredAt,
      registeredByUserId: companyProfiles.registeredByUserId,
      lastUpdatedAt: companyProfiles.lastUpdatedAt,
    })
    .from(companyProfiles)
    .where(eq(companyProfiles.companyId, internalCompanyId))
    .limit(1);
  const companyProfile = profileRows[0] || null;
  if (!companyProfile) return null;

  const counterRows = await db
    .select({
      counterKey: companyCounters.counterKey,
      nextValue: companyCounters.nextValue,
    })
    .from(companyCounters)
    .where(eq(companyCounters.companyId, internalCompanyId));

  const documentNumbers: Record<string, number> = {};
  for (const row of counterRows) {
    if (!String(row.counterKey).startsWith('doc_')) continue;
    documentNumbers[String(row.counterKey).replace('doc_', '')] = row.nextValue;
  }

  return {
    he_name: companyProfile.heName || '',
    en_name: companyProfile.enName || '',
    city: companyProfile.city || '',
    address: companyProfile.address || '',
    vat_number: companyProfile.vatNumber || '',
    business_type: companyProfile.businessType || '',
    document_numbers: documentNumbers,
    business_email: companyProfile.businessEmail || '',
    business_phone: companyProfile.businessPhone || '',
    business_fax: companyProfile.businessFax || '',
    accountant_name: companyProfile.accountantName || '',
    accountant_email: companyProfile.accountantEmail || '',
    accountant_phone: companyProfile.accountantPhone || '',
    registered_at: toIsoString(companyProfile.registeredAt),
    registered_by: companyProfile.registeredByUserId || '',
    registered_by_role: '',
    last_updated: toIsoString(companyProfile.lastUpdatedAt),
  };
}

async function getInventorySnapshot(
  internalCompanyId: string,
  scope: InventoryScope,
  membershipId: string | null,
  options: QueryOptions = {},
): Promise<InventorySnapshot> {
  const db = options.db || getDb(options.env);
  const locationRows = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(scope === 'company'
      ? and(eq(inventoryLocations.companyId, internalCompanyId), eq(inventoryLocations.locationType, 'company'), isNull(inventoryLocations.membershipId))
      : and(eq(inventoryLocations.companyId, internalCompanyId), eq(inventoryLocations.locationType, 'member'), eq(inventoryLocations.membershipId, membershipId || '')))
    .limit(1);
  const location = locationRows[0] || null;

  if (!location) {
    return {
      parts: [],
      nextId: 1,
      lastUpdated: new Date().toISOString(),
    };
  }

  const partCounterRows = await db
    .select({ nextValue: companyCounters.nextValue })
    .from(companyCounters)
    .where(and(
      eq(companyCounters.companyId, internalCompanyId),
      eq(companyCounters.counterKey, 'part_no'),
    ))
    .limit(1);
  const nextId = toNumber(partCounterRows[0]?.nextValue, 1);

  const partRows = await db.execute(sql`
    SELECT
      p.part_no,
      p.name,
      p.active,
      p.low_threshold,
      p.created_at,
      COALESCE(b.quantity_on_hand, 0) AS quantity_on_hand
    FROM inventory_parts p
    INNER JOIN inventory_balances b ON b.part_id = p.id AND b.location_id = ${location.id}
    WHERE p.company_id = ${internalCompanyId}
      AND p.archived_at IS NULL
    ORDER BY p.part_no ASC
  `);

  const parts = (partRows.rows || []).map((value) => {
    const row = value as Record<string, unknown>;
    return {
    id: toNumber(row.part_no),
    name: String(row.name || ''),
    active: row.active === undefined ? true : Boolean(row.active),
    quantity: toNumber(row.quantity_on_hand, 0),
    lowThreshold: toNumber(row.low_threshold, 0),
    dateAdded: toIsoString(row.created_at),
    };
  });
  return {
    parts,
    nextId,
    lastUpdated: new Date().toISOString(),
  };
}

async function listCompanyClients(
  companyId: string | number,
  options: QueryOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) return [];

  const rows = await db
    .select({
      clientNo: clients.clientNo,
      name: clients.name,
      email: clients.email,
      phone: clients.phone,
      address: clients.address,
      notes: clients.notes,
      city: clients.city,
      vatNumber: clients.vatNumber,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(eq(clients.companyId, company.id))
    .orderBy(clients.clientNo);

  return rows
    .map((row) => ({
      id: String(row.clientNo),
      numericId: row.clientNo,
      name: row.name || '',
      email: row.email || undefined,
      phone: row.phone || undefined,
      address: row.address || undefined,
      notes: row.notes || undefined,
      city: row.city || undefined,
      vatNumber: row.vatNumber || undefined,
      createdAt: toIsoString(row.createdAt),
      updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : undefined,
    }));
}

async function listCompanyJobs(
  companyId: string | number,
  profile: LegacyUserProfile,
  options: NonNullable<Parameters<typeof listCompanyJobsDetailed>[2]> = {},
) {
  // Returns { items: JobRecord[], nextCursor: string | null }
  return listCompanyJobsDetailed(companyId, profile, options);
}

async function listCompanyDocuments(
  companyId: string | number,
  profile: LegacyUserProfile | null,
  options: NonNullable<Parameters<typeof listCompanyDocumentsDetailed>[1]> = {},
) {
  if (!profile) return { items: [], nextCursor: null };
  const normalizedRole = String(profile.role || '').trim().toLowerCase();
  if (normalizedRole === 'worker') {
    return { items: [], nextCursor: null };
  }
  // Returns { items: DocumentRecord[], nextCursor: string | null }
  return listCompanyDocumentsDetailed(companyId, options);
}

async function getBootstrapReadModel(
  uid: string,
  companyId: string | number | null = null,
  options: DatabaseOptions & { includeCollections?: boolean } = {},
) {
  // Bootstrap is count-only / lightweight by default. Callers that need full
  // collections must opt in explicitly and should prefer paginated RPCs.
  const includeCollections = options.includeCollections === true;
  const profile = companyId
    ? await getUserProfileByFirebaseUidForCompany(uid, companyId, options)
    : await getUserProfileByFirebaseUid(uid, options);

  if (!profile) {
    return null;
  }

  const internalCompanyId = profile.internalCompanyId || null;
  const payload: {
    profile: LegacyUserProfile;
    subscription: unknown;
    businessInfo: unknown;
    inventory: InventorySnapshot;
    companyInventory: InventorySnapshot;
    workers: unknown[];
    clients: unknown[];
    jobs: unknown[];
    documents: unknown[];
    jobsNextCursor?: string | null;
    documentsNextCursor?: string | null;
  } = {
    profile,
    subscription: null,
    businessInfo: null,
    inventory: { parts: [], nextId: 1, lastUpdated: new Date().toISOString() },
    companyInventory: { parts: [], nextId: 1, lastUpdated: new Date().toISOString() },
    workers: [],
    clients: [],
    jobs: [],
    documents: [],
  };

  if (!internalCompanyId) {
    return payload;
  }

  // Fetch all four company-scoped metadata fields in parallel.
  [payload.subscription, payload.businessInfo, payload.inventory, payload.companyInventory] = await Promise.all([
    getCompanySubscription(internalCompanyId, options),
    getCompanyBusinessInfo(internalCompanyId, options),
    getInventorySnapshot(internalCompanyId, 'user', profile.membershipId || null, options),
    getInventorySnapshot(internalCompanyId, 'company', null, options),
  ]);

  if (includeCollections) {
    const publicCompanyId = String(profile.companyId || companyId || '');
    // Fetch all four collections in parallel.
    const [workers, clients, jobsResult, documentsResult] = await Promise.all([
      listCompanyWorkers(publicCompanyId, options),
      listCompanyClients(publicCompanyId, options),
      listCompanyJobs(publicCompanyId, profile, options),
      listCompanyDocuments(publicCompanyId, profile, options),
    ]);
    payload.workers = workers;
    payload.clients = clients;
    // Bootstrap always returns the first page of jobs/documents (no cursor) so clients
    // can render immediately and load more on demand.
    payload.jobs = jobsResult.items;
    payload.documents = documentsResult.items;
    payload.jobsNextCursor = jobsResult.nextCursor;
    payload.documentsNextCursor = documentsResult.nextCursor;
  }

  return payload;
}

async function getUserInventorySnapshot(
  companyId: string | number,
  targetUid: string,
  options: QueryOptions = {},
) {
  const targetProfile = await getUserProfileByFirebaseUidForCompany(targetUid, companyId, options);
  if (!targetProfile?.internalCompanyId || !targetProfile?.membershipId) {
    return {
      parts: [],
      nextId: 1,
      lastUpdated: new Date().toISOString(),
    };
  }
  return getInventorySnapshot(targetProfile.internalCompanyId, 'user', targetProfile.membershipId, options);
}

async function getRecordById(
  companyId: string | number,
  recordId: string | number,
  profile: LegacyUserProfile | null,
  options: DatabaseOptions = {},
) {
  const documentMatch = await getDocumentRecordById(companyId, recordId, options);
  if (documentMatch) {
    return canReadSqlDocumentRecord(profile) ? documentMatch : null;
  }
  const jobMatch = await getJobRecordById(companyId, recordId, options);
  return canReadSqlJobRecord(profile, jobMatch) ? jobMatch : null;
}

async function getDocumentTaskStatus(
  taskId: string,
  uid: string,
  options: QueryOptions = {},
) {
  const db = options.db || getDb(options.env);
  const rows = await db
    .select({
      taskKey: documentTasks.taskKey,
      status: documentTasks.status,
      taskType: documentTasks.taskType,
      previewUrl: documentTasks.previewUrl,
      generateUrl: documentTasks.generateUrl,
      storagePath: documentTasks.storagePath,
      documentId: documentTasks.documentId,
      pdfSize: documentTasks.pdfSize,
      error: documentTasks.error,
      requestPayload: documentTasks.requestPayload,
    })
    .from(documentTasks)
    .where(and(
      eq(documentTasks.taskKey, String(taskId || '').trim()),
      eq(documentTasks.userId, uid),
    ))
    .limit(1);
  const row = rows[0] || null;
  if (!row) return null;
  const requestPayload = asRecord(row.requestPayload);
  return {
    taskId: row.taskKey,
    status: row.status,
    taskType: row.taskType,
    previewURL: row.taskType === 'preview'
      ? (row.previewUrl || String(requestPayload.previewURL || '') || null)
      : null,
    downloadURL: row.taskType === 'generate'
      ? (String(requestPayload.downloadURL || '') || row.generateUrl || null)
      : null,
    documentId: row.documentId || String(requestPayload.publicDocumentId || '') || null,
    pdfSize: row.pdfSize || null,
    error: row.error || null,
  };
}

export { getBootstrapReadModel, getCompanyBusinessInfo, getCompanySyncState, getCompanySubscription, getDocumentTaskStatus, getInventorySnapshot, getRecordById, getUserInventorySnapshot, listCompanyClients, listCompanyDocuments, listCompanyJobs };

