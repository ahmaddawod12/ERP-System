import { setDatabaseErrorCode } from './errors';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  getDb,
  type DatabaseOptions,
  type SmartJobTransaction,
} from './client';
import type { LegacyUserProfile } from './access';
import {
  appUsers,
  clients,
  companyMemberships,
  jobAttachments,
  jobPartUsages,
  jobs,
} from './schema';
import {
  allocateCompanyCounter,
  findActiveMembership,
  resolveCompanyByPublicId,
} from './membership';
import {
  deductUserInventoryPartsInTransaction,
} from './inventory';

type UnknownRecord = Record<string, unknown>;
type DateInput = string | number | Date | null | undefined;
type JobStatus = typeof jobs.$inferSelect['status'];
type JobRow = Omit<typeof jobs.$inferSelect, 'entityVersion' | 'searchText'>;
type MembershipIdentity = {
  membershipId: string;
  memberNo: number;
  role: 'manager' | 'worker' | 'user' | 'basic';
  userId: string;
  name: string;
  phoneNumber: string;
  email?: string;
};
type ClientIdentity = Pick<typeof clients.$inferSelect, 'id' | 'clientNo' | 'name' | 'phone'>;
type AttachmentRow = Pick<typeof jobAttachments.$inferSelect, 'storagePath' | 'kind'>;
type PartUsageRow = {
  partNo: number | null;
  partNameSnapshot: string | null;
  quantity: number;
};
type NormalizedPart = {
  id: unknown;
  name: string;
  quantity: number;
  partId: unknown;
  unit?: string;
};
type AttachmentRef = { storagePath: string };

type JobMutationInput = {
  companyId: string | number;
  jobId?: string | number;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  location?: string | null;
  address?: string | null;
  category?: string | null;
  priority?: string | null;
  dueDate?: DateInput;
  status?: JobStatus;
  finishedAt?: DateInput;
  deniedAt?: DateInput;
  cid?: string | number | null;
  cname?: string | null;
  cphone?: string | null;
  wid?: string | number | null;
  wname?: string | null;
  mid?: string | number | null;
  mname?: string | null;
  createdByName?: string | null;
  createdByUserId?: string;
  updatedByUserId?: string | null;
  userId?: string | null;
  acceptedByUserId?: string;
  inventoryDeductionTargetUid?: string | null;
  idempotencyKey?: string | null;
  isCert?: boolean;
  photos?: unknown;
  signature?: unknown;
  partsUsed?: unknown;
  now?: DateInput;
  timeFrom?: unknown;
  timeTo?: unknown;
  travelDistance?: unknown;
  signingPerson?: unknown;
  tags?: unknown;
  images?: unknown;
  parts?: unknown;
  deniedBy?: unknown;
  approvedBy?: unknown;
};

type JobQueryOptions = DatabaseOptions & {
  limit?: number;
  pageSize?: number;
  status?: string | readonly string[];
  dateField?: 'updatedAt' | 'finishedAt' | 'dueAt' | 'createdAt';
  dateFrom?: DateInput;
  dateTo?: DateInput;
  afterCursor?: string | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asDate<T extends Date | null>(value: DateInput, fallback: T): Date | T {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneMeta(meta: unknown): UnknownRecord {
  return { ...asRecord(meta) };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizePartList(value: unknown): NormalizedPart[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is UnknownRecord => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry: UnknownRecord) => ({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      quantity: Number(entry.quantity || 0),
      partId: entry.partId,
      unit: typeof entry.unit === 'string' ? entry.unit : undefined,
    }));
}

const VALID_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['waiting', 'finished', 'denied'],
  waiting: ['pending', 'finished', 'denied'],
  finished: [],
  denied: [],
};

function isValidStatusTransition(
  currentStatus: JobStatus | null | undefined,
  nextStatus: JobStatus,
): boolean {
  const current = currentStatus || 'pending';
  return VALID_STATUS_TRANSITIONS[current]?.includes(nextStatus) || false;
}

function normalizeAttachmentRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: unknown) => {
      const record = asRecord(entry);
      if (typeof record.storagePath === 'string') {
        return { storagePath: record.storagePath.trim() };
      }
      return null;
    })
    .filter((entry): entry is AttachmentRef => Boolean(entry?.storagePath));
}

function copyUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value)
    ? value.map((entry: unknown) => entry)
    : undefined;
}

function resolveDueAt(value: DateInput): Date | null {
  if (!value) return null;
  const parsed = asDate(value, null);
  return parsed || null;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry: unknown) => String(entry || '').trim())
      .filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function resolveJobDateColumn(dateField: unknown) {
  switch (String(dateField || '').trim()) {
    case 'updatedAt':
      return jobs.updatedAt;
    case 'finishedAt':
      return jobs.finishedAt;
    case 'dueAt':
      return jobs.dueAt;
    case 'createdAt':
    default:
      return jobs.createdAt;
  }
}

async function getMembershipIdentity(
  tx: SmartJobTransaction,
  companyInternalId: string,
  membershipId: string | null,
): Promise<MembershipIdentity | null> {
  if (!membershipId) return null;
  const rows = await tx
    .select({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
      role: companyMemberships.role,
      displayName: companyMemberships.displayName,
      phoneNumber: companyMemberships.phoneNumber,
      userId: companyMemberships.userId,
      userDisplayName: appUsers.displayName,
      userPhoneNumber: appUsers.phoneNumber,
      email: appUsers.email,
    })
    .from(companyMemberships)
    .leftJoin(appUsers, eq(appUsers.id, companyMemberships.userId))
    .where(and(
      eq(companyMemberships.companyId, companyInternalId),
      eq(companyMemberships.id, membershipId),
      eq(companyMemberships.status, 'active'),
    ))
    .limit(1);
  const row = rows[0] || null;
  if (!row) return null;
  return {
    membershipId: row.id,
    memberNo: row.memberNo,
    role: row.role,
    userId: row.userId,
    name: row.displayName || row.userDisplayName || row.email || String(row.memberNo || ''),
    phoneNumber: row.phoneNumber || row.userPhoneNumber || '',
    email: row.email || '',
  };
}

async function getMembershipByMemberNo(
  tx: SmartJobTransaction,
  companyInternalId: string,
  memberNo: unknown,
): Promise<MembershipIdentity | null> {
  const normalizedMemberNo = numericOrNull(memberNo);
  if (!normalizedMemberNo) return null;

  const rows = await tx
    .select({
      id: companyMemberships.id,
      memberNo: companyMemberships.memberNo,
      role: companyMemberships.role,
      userId: companyMemberships.userId,
      displayName: companyMemberships.displayName,
      phoneNumber: companyMemberships.phoneNumber,
      userDisplayName: appUsers.displayName,
      userPhoneNumber: appUsers.phoneNumber,
      email: appUsers.email,
    })
    .from(companyMemberships)
    .leftJoin(appUsers, eq(appUsers.id, companyMemberships.userId))
    .where(and(
      eq(companyMemberships.companyId, companyInternalId),
      eq(companyMemberships.memberNo, normalizedMemberNo),
      eq(companyMemberships.status, 'active'),
    ))
    .limit(1);

  const row = rows[0] || null;
  if (!row) return null;
  return {
    membershipId: row.id,
    memberNo: row.memberNo,
    role: row.role,
    userId: row.userId,
    name: row.displayName || row.userDisplayName || row.email || String(row.memberNo || ''),
    phoneNumber: row.phoneNumber || row.userPhoneNumber || '',
    email: row.email || '',
  };
}

async function getClientByNo(
  tx: SmartJobTransaction,
  companyInternalId: string,
  clientNo: unknown,
): Promise<ClientIdentity | null> {
  const normalizedClientNo = numericOrNull(clientNo);
  if (!normalizedClientNo) return null;

  const rows = await tx
    .select({
      id: clients.id,
      clientNo: clients.clientNo,
      name: clients.name,
      phone: clients.phone,
    })
    .from(clients)
    .where(and(
      eq(clients.companyId, companyInternalId),
      eq(clients.clientNo, normalizedClientNo),
    ))
    .limit(1);
  return rows[0] || null;
}

async function getJobRowByNo(
  tx: SmartJobTransaction,
  companyInternalId: string,
  jobNo: unknown,
): Promise<JobRow | null> {
  const normalizedJobNo = numericOrNull(jobNo);
  if (!normalizedJobNo) return null;

  const rows = await tx
    .select({
      id: jobs.id,
      companyId: jobs.companyId,
      jobNo: jobs.jobNo,
      status: jobs.status,
      title: jobs.title,
      description: jobs.description,
      notes: jobs.notes,
      location: jobs.location,
      address: jobs.address,
      category: jobs.category,
      priority: jobs.priority,
      dueAt: jobs.dueAt,
      clientId: jobs.clientId,
      assignedMembershipId: jobs.assignedMembershipId,
      createdByMembershipId: jobs.createdByMembershipId,
      acceptedByUserId: jobs.acceptedByUserId,
      acceptedAt: jobs.acceptedAt,
      finishedAt: jobs.finishedAt,
      deniedAt: jobs.deniedAt,
      deniedByUserId: jobs.deniedByUserId,
      isCert: jobs.isCert,
      idempotencyKey: jobs.idempotencyKey,
      clientNameSnapshot: jobs.clientNameSnapshot,
      clientPhoneSnapshot: jobs.clientPhoneSnapshot,
      assignedMemberNameSnapshot: jobs.assignedMemberNameSnapshot,
      createdByNameSnapshot: jobs.createdByNameSnapshot,
      meta: jobs.meta,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyInternalId),
      eq(jobs.jobNo, normalizedJobNo),
    ))
    .limit(1);

  return rows[0] || null;
}

function buildJobMeta(
  payload: JobMutationInput,
  existingMeta: unknown = {},
): UnknownRecord {
  const meta = cloneMeta(existingMeta);

  if (Object.prototype.hasOwnProperty.call(payload, 'timeFrom')) meta.timeFrom = payload.timeFrom || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'timeTo')) meta.timeTo = payload.timeTo || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'travelDistance')) meta.travelDistance = payload.travelDistance == null ? null : Number(payload.travelDistance);
  if (Object.prototype.hasOwnProperty.call(payload, 'signingPerson')) meta.signingPerson = payload.signingPerson || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) meta.tags = normalizeStringArray(payload.tags);
  if (Object.prototype.hasOwnProperty.call(payload, 'images')) meta.images = normalizeStringArray(payload.images);
  if (Object.prototype.hasOwnProperty.call(payload, 'parts')) meta.parts = normalizePartList(payload.parts);
  if (Object.prototype.hasOwnProperty.call(payload, 'deniedBy')) meta.deniedBy = payload.deniedBy || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'approvedBy')) meta.approvedBy = payload.approvedBy || null;

  return meta;
}

async function replaceJobAttachments(
  tx: SmartJobTransaction,
  jobInternalId: string,
  userId: string | null,
  photos: unknown,
  signature: unknown,
  now: Date,
) {
  await tx.delete(jobAttachments).where(eq(jobAttachments.jobId, jobInternalId));

  const rows: Array<typeof jobAttachments.$inferInsert> = [];
  for (const photo of normalizeAttachmentRefs(photos)) {
    rows.push({
      jobId: jobInternalId,
      storagePath: photo.storagePath,
      kind: 'photo',
      uploadedByUserId: userId || null,
      createdAt: now,
    });
  }
  const signatureRecord = asRecord(signature);
  if (typeof signatureRecord.storagePath === 'string' && signatureRecord.storagePath.trim()) {
    rows.push({
      jobId: jobInternalId,
      storagePath: signatureRecord.storagePath.trim(),
      kind: 'signature',
      uploadedByUserId: userId || null,
      createdAt: now,
    });
  }

  if (rows.length > 0) {
    await tx.insert(jobAttachments).values(rows);
  }
}

async function replaceJobPartUsages(
  tx: SmartJobTransaction,
  jobInternalId: string,
  companyInternalId: string,
  partsUsed: unknown,
  now: Date,
) {
  await tx.delete(jobPartUsages).where(eq(jobPartUsages.jobId, jobInternalId));

  const normalizedParts = normalizePartList(partsUsed)
    .filter((part) => Number.isFinite(Number(part.quantity)) && Number(part.quantity) >= 0 && part.id !== undefined && part.id !== null && String(part.id).trim() !== '');

  if (normalizedParts.length === 0) {
    return;
  }

  const requestedPartNos = Array.from(new Set(normalizedParts
    .map((part) => numericOrNull(part.id ?? part.partId))
    .filter((partNo) => partNo)));
  const partIdByNo = new Map<number, string>();
  if (requestedPartNos.length > 0) {
    const partResult = await tx.execute(sql`
      SELECT id, part_no
      FROM inventory_parts
      WHERE company_id = ${companyInternalId}
        AND part_no = ANY(${requestedPartNos})
    `);
    for (const value of partResult.rows || []) {
      const row = value as UnknownRecord;
      partIdByNo.set(Number(row.part_no), String(row.id));
    }
  }

  await tx.insert(jobPartUsages).values(normalizedParts.map((part) => {
    const partNo = numericOrNull(part.id ?? part.partId);
    const quantity = Number(part.quantity || 0);
    return {
      jobId: jobInternalId,
      inventoryPartId: partNo ? (partIdByNo.get(partNo) || null) : null,
      partNameSnapshot: part.name || null,
      quantity: String(quantity),
      createdAt: now,
    };
  }));
}

function mapJobRecord(
  jobRow: JobRow,
  attachmentRows: AttachmentRow[],
  partRows: PartUsageRow[],
  assignmentIdentity: MembershipIdentity | null,
  creatorIdentity: MembershipIdentity | null,
  clientRow: ClientIdentity | null,
) {
  const meta = cloneMeta(jobRow.meta);
  const photos = attachmentRows
    .filter((row) => row.kind === 'photo')
    .map((row) => ({ storagePath: row.storagePath }));
  const signatureRow = attachmentRows.find((row) => row.kind === 'signature');

  return {
    id: String(jobRow.jobNo),
    title: jobRow.title || '',
    description: jobRow.description || '',
    notes: jobRow.notes || undefined,
    location: jobRow.location || undefined,
    address: jobRow.address || undefined,
    category: jobRow.category || undefined,
    priority: jobRow.priority || undefined,
    dueDate: jobRow.dueAt instanceof Date ? jobRow.dueAt.toISOString() : (jobRow.dueAt || undefined),
    cname: jobRow.clientNameSnapshot || clientRow?.name || '',
    cphone: jobRow.clientPhoneSnapshot || clientRow?.phone || undefined,
    cid: clientRow?.clientNo != null ? String(clientRow.clientNo) : undefined,
    status: jobRow.status,
    wid: assignmentIdentity?.memberNo != null ? String(assignmentIdentity.memberNo) : null,
    wname: assignmentIdentity?.name || jobRow.assignedMemberNameSnapshot || undefined,
    mid: creatorIdentity?.role === 'manager' && creatorIdentity.memberNo != null ? String(creatorIdentity.memberNo) : (meta.mid != null ? String(meta.mid) : undefined),
    mname: creatorIdentity?.role === 'manager' ? creatorIdentity.name : (jobRow.createdByNameSnapshot || meta.mname || undefined),
    createdAt: jobRow.createdAt instanceof Date ? jobRow.createdAt.toISOString() : String(jobRow.createdAt || ''),
    updatedAt: jobRow.updatedAt instanceof Date ? jobRow.updatedAt.toISOString() : (jobRow.updatedAt ? String(jobRow.updatedAt) : undefined),
    timeFrom: meta.timeFrom ? String(meta.timeFrom) : undefined,
    timeTo: meta.timeTo ? String(meta.timeTo) : undefined,
    signingPerson: meta.signingPerson ? String(meta.signingPerson) : undefined,
    photos,
    signature: signatureRow ? { storagePath: signatureRow.storagePath } : null,
    parts: copyUnknownArray(meta.parts),
    partsUsed: partRows.map((row) => ({
      id: row.partNo != null ? Number(row.partNo) : (row.partNameSnapshot || ''),
      name: row.partNameSnapshot || '',
      quantity: Number(row.quantity || 0),
    })),
    travelDistance: meta.travelDistance == null ? null : Number(meta.travelDistance),
    finishedAt: jobRow.finishedAt instanceof Date ? jobRow.finishedAt.toISOString() : (jobRow.finishedAt ? String(jobRow.finishedAt) : undefined),
    deniedAt: jobRow.deniedAt instanceof Date ? jobRow.deniedAt.toISOString() : (jobRow.deniedAt ? String(jobRow.deniedAt) : undefined),
    deniedBy: meta.deniedBy ? String(meta.deniedBy) : undefined,
    approvedBy: meta.approvedBy ? String(meta.approvedBy) : undefined,
    isCert: jobRow.isCert === true,
    tags: copyUnknownArray(meta.tags),
    images: copyUnknownArray(meta.images),
  };
}

function mapPartUsageSqlRows(values: readonly unknown[]): PartUsageRow[] {
  return values.map((value) => {
    const row = value as UnknownRecord;
    return {
      partNo: row.part_no == null ? null : Number(row.part_no),
      partNameSnapshot: row.part_name_snapshot == null ? null : String(row.part_name_snapshot),
      quantity: Number(row.quantity || 0),
    };
  });
}

function normalizeJobStatusList(value: unknown): JobStatus[] {
  return normalizeStringList(value).filter((status): status is JobStatus => (
    status === 'pending'
    || status === 'waiting'
    || status === 'finished'
    || status === 'denied'
  ));
}

async function fetchJobDetail(
  tx: SmartJobTransaction,
  companyInternalId: string,
  jobRow: JobRow,
) {
  const [attachmentRows, partRows, assignmentIdentity, creatorIdentity, clientRow] = await Promise.all([
    tx
      .select({ storagePath: jobAttachments.storagePath, kind: jobAttachments.kind })
      .from(jobAttachments)
      .where(eq(jobAttachments.jobId, jobRow.id)),
    tx.execute(sql`
      SELECT
        u.quantity,
        u.part_name_snapshot,
        p.part_no
      FROM job_part_usages u
      LEFT JOIN inventory_parts p ON p.id = u.inventory_part_id
      WHERE u.job_id = ${jobRow.id}
      ORDER BY u.created_at ASC
    `).then((result) => mapPartUsageSqlRows(result.rows || [])),
    getMembershipIdentity(tx, companyInternalId, jobRow.assignedMembershipId),
    getMembershipIdentity(tx, companyInternalId, jobRow.createdByMembershipId),
    jobRow.clientId
      ? tx.select({ id: clients.id, clientNo: clients.clientNo, name: clients.name, phone: clients.phone }).from(clients).where(eq(clients.id, jobRow.clientId)).limit(1).then((rows) => rows[0] || null)
      : Promise.resolve(null),
  ]);

  return mapJobRecord(jobRow, attachmentRows, partRows, assignmentIdentity, creatorIdentity, clientRow);
}

async function getPersistedJobPartUsages(
  tx: SmartJobTransaction,
  jobInternalId: string,
) {
  const result = await tx.execute(sql`
    SELECT
      u.quantity,
      p.part_no
    FROM job_part_usages u
    LEFT JOIN inventory_parts p ON p.id = u.inventory_part_id
    WHERE u.job_id = ${jobInternalId}
    ORDER BY u.created_at ASC
  `);

  return (result.rows || [])
    .map((value) => {
      const row = value as UnknownRecord;
      return {
      id: row.part_no != null ? Number(row.part_no) : null,
      quantity: Number(row.quantity || 0),
      };
    })
    .filter((row): row is { id: number; quantity: number } => (
      Number.isInteger(row.id) && Number.isFinite(row.quantity) && row.quantity > 0
    ));
}

async function createJob(
  input: JobMutationInput & { createdByUserId: string },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    if (input.idempotencyKey) {
      const duplicateRows = await tx
        .select({ jobNo: jobs.jobNo })
        .from(jobs)
        .where(and(
          eq(jobs.companyId, company.id),
          eq(jobs.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      const duplicate = duplicateRows[0] || null;
      if (duplicate) {
        return { jobId: String(duplicate.jobNo), duplicate: true };
      }
    }

    const createdByMembership = await findActiveMembership(tx, input.createdByUserId, company.id);
    if (!createdByMembership) {
      const error = new Error('Creator is not an active company member');
      setDatabaseErrorCode(error, 'permission-denied');
      throw error;
    }

    const jobNo = await allocateCompanyCounter(tx, company.id, 'job_no');
    const assignedMembership = input.wid ? await getMembershipByMemberNo(tx, company.id, input.wid) : null;
    const clientRow = input.cid ? await getClientByNo(tx, company.id, input.cid) : null;
    if (input.wid && !assignedMembership) {
      const error = new Error('Assigned worker not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }
    if (input.cid && !clientRow) {
      const error = new Error('Client not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const status = input.status || 'pending';
    const meta = buildJobMeta(input, {
      mname: input.mname || null,
      mid: input.mid || null,
    });

    const [jobRow] = await tx.insert(jobs).values({
      companyId: company.id,
      jobNo,
      status,
      title: input.title || null,
      description: input.description || null,
      notes: input.notes || null,
      location: input.location || null,
      address: input.address || null,
      category: input.category || null,
      priority: input.priority || null,
      dueAt: resolveDueAt(input.dueDate),
      clientId: clientRow?.id || null,
      assignedMembershipId: assignedMembership?.membershipId || null,
      createdByMembershipId: createdByMembership.id,
      finishedAt: status === 'finished' ? asDate(input.finishedAt, now) : null,
      deniedAt: status === 'denied' ? asDate(input.deniedAt, now) : null,
      isCert: input.isCert === true,
      idempotencyKey: input.idempotencyKey || null,
      clientNameSnapshot: clientRow?.name || input.cname || null,
      clientPhoneSnapshot: clientRow?.phone || input.cphone || null,
      assignedMemberNameSnapshot: assignedMembership?.name || input.wname || null,
      createdByNameSnapshot: input.mname || input.createdByName || null,
      meta,
      createdAt: now,
      updatedAt: now,
    }).returning({
      id: jobs.id,
      companyId: jobs.companyId,
      jobNo: jobs.jobNo,
      status: jobs.status,
      title: jobs.title,
      description: jobs.description,
      notes: jobs.notes,
      location: jobs.location,
      address: jobs.address,
      category: jobs.category,
      priority: jobs.priority,
      dueAt: jobs.dueAt,
      clientId: jobs.clientId,
      assignedMembershipId: jobs.assignedMembershipId,
      createdByMembershipId: jobs.createdByMembershipId,
      acceptedByUserId: jobs.acceptedByUserId,
      acceptedAt: jobs.acceptedAt,
      finishedAt: jobs.finishedAt,
      deniedAt: jobs.deniedAt,
      deniedByUserId: jobs.deniedByUserId,
      isCert: jobs.isCert,
      idempotencyKey: jobs.idempotencyKey,
      clientNameSnapshot: jobs.clientNameSnapshot,
      clientPhoneSnapshot: jobs.clientPhoneSnapshot,
      assignedMemberNameSnapshot: jobs.assignedMemberNameSnapshot,
      createdByNameSnapshot: jobs.createdByNameSnapshot,
      meta: jobs.meta,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    });

    if (!jobRow) {
      throw new Error('Job insert did not return a record');
    }

    await replaceJobAttachments(tx, jobRow.id, input.createdByUserId, input.photos, input.signature, now);
    await replaceJobPartUsages(tx, jobRow.id, company.id, input.partsUsed || [], now);
    if (status === 'finished' && input.inventoryDeductionTargetUid) {
      await deductUserInventoryPartsInTransaction(tx, company.id, {
        targetUid: input.inventoryDeductionTargetUid,
        partsUsed: normalizePartList(input.partsUsed),
        jobId: jobRow.id,
      }, now);
    }

    return { jobId: String(jobNo), duplicate: false };
  });
}

async function updateJob(
  input: JobMutationInput & { jobId: string | number },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const updateData: Partial<typeof jobs.$inferInsert> = { updatedAt: now };
    if (Object.prototype.hasOwnProperty.call(input, 'title')) updateData.title = input.title || null;
    if (Object.prototype.hasOwnProperty.call(input, 'description')) updateData.description = input.description || null;
    if (Object.prototype.hasOwnProperty.call(input, 'notes')) updateData.notes = input.notes || null;
    if (Object.prototype.hasOwnProperty.call(input, 'location')) updateData.location = input.location || null;
    if (Object.prototype.hasOwnProperty.call(input, 'address')) updateData.address = input.address || null;
    if (Object.prototype.hasOwnProperty.call(input, 'category')) updateData.category = input.category || null;
    if (Object.prototype.hasOwnProperty.call(input, 'priority')) updateData.priority = input.priority || null;
    if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) updateData.dueAt = resolveDueAt(input.dueDate);
    if (Object.prototype.hasOwnProperty.call(input, 'status') && input.status) {
      if (!isValidStatusTransition(jobRow.status, input.status)) {
        const error = new Error(`Invalid status transition from ${jobRow.status || 'pending'} to ${input.status}`);
        setDatabaseErrorCode(error, 'failed-precondition');
        throw error;
      }
      updateData.status = input.status;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'finishedAt')) updateData.finishedAt = input.finishedAt ? asDate(input.finishedAt, now) : null;
    if (Object.prototype.hasOwnProperty.call(input, 'deniedAt')) updateData.deniedAt = input.deniedAt ? asDate(input.deniedAt, now) : null;
    if (Object.prototype.hasOwnProperty.call(input, 'cid')) {
      const clientRow = input.cid ? await getClientByNo(tx, company.id, input.cid) : null;
      if (input.cid && !clientRow) {
        const error = new Error('Client not found');
        setDatabaseErrorCode(error, 'not-found');
        throw error;
      }
      updateData.clientId = clientRow?.id || null;
      updateData.clientNameSnapshot = clientRow?.name || input.cname || null;
      updateData.clientPhoneSnapshot = clientRow?.phone || input.cphone || null;
    } else {
      if (Object.prototype.hasOwnProperty.call(input, 'cname')) updateData.clientNameSnapshot = input.cname || null;
      if (Object.prototype.hasOwnProperty.call(input, 'cphone')) updateData.clientPhoneSnapshot = input.cphone || null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'wid')) {
      const assignedMembership = input.wid ? await getMembershipByMemberNo(tx, company.id, input.wid) : null;
      if (input.wid && !assignedMembership) {
        const error = new Error('Assigned worker not found');
        setDatabaseErrorCode(error, 'not-found');
        throw error;
      }
      updateData.assignedMembershipId = assignedMembership?.membershipId || null;
      updateData.assignedMemberNameSnapshot = assignedMembership?.name || input.wname || null;
    }

    updateData.meta = buildJobMeta(input, jobRow.meta);
    await tx.update(jobs).set(updateData).where(eq(jobs.id, jobRow.id));

    if (Object.prototype.hasOwnProperty.call(input, 'photos') || Object.prototype.hasOwnProperty.call(input, 'signature')) {
      const existingAttachmentRows = await tx
        .select({ storagePath: jobAttachments.storagePath, kind: jobAttachments.kind })
        .from(jobAttachments)
        .where(eq(jobAttachments.jobId, jobRow.id));
      const nextPhotos = Object.prototype.hasOwnProperty.call(input, 'photos')
        ? input.photos
        : existingAttachmentRows
          .filter((row) => row.kind === 'photo')
          .map((row) => ({ storagePath: row.storagePath }));
      const nextSignature = Object.prototype.hasOwnProperty.call(input, 'signature')
        ? input.signature
        : (() => {
          const existingSignature = existingAttachmentRows.find((row) => row.kind === 'signature');
          return existingSignature ? { storagePath: existingSignature.storagePath } : null;
        })();
      await replaceJobAttachments(
        tx,
        jobRow.id,
        input.updatedByUserId || input.userId || null,
        nextPhotos,
        nextSignature,
        now,
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'partsUsed')) {
      await replaceJobPartUsages(tx, jobRow.id, company.id, input.partsUsed || [], now);
    }

    return { jobId: String(jobRow.jobNo) };
  });
}

async function deleteJob(
  input: Pick<JobMutationInput, 'companyId'> & { jobId: string | number },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }
    if (jobRow.isCert === true) {
      const error = new Error('Cannot delete a job that has a generated document (isCert=true)');
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    const attachmentRows = await tx
      .select({ storagePath: jobAttachments.storagePath })
      .from(jobAttachments)
      .where(eq(jobAttachments.jobId, jobRow.id));

    await tx.delete(jobs).where(eq(jobs.id, jobRow.id));

    return {
      jobId: String(jobRow.jobNo),
      status: jobRow.status,
      storagePaths: attachmentRows.map((row) => row.storagePath).filter(Boolean),
    };
  });
}

async function acceptJob(
  input: Pick<JobMutationInput, 'companyId' | 'now'> & {
    jobId: string | number;
    acceptedByUserId: string;
  },
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }
    if (jobRow.status && !['pending', 'waiting'].includes(jobRow.status)) {
      const error = new Error(`Cannot accept job with status "${jobRow.status}". Expected: pending, waiting`);
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }

    const assignmentIdentity = await getMembershipIdentity(tx, company.id, jobRow.assignedMembershipId);
    const partUsageRows = await getPersistedJobPartUsages(tx, jobRow.id);
    if (assignmentIdentity?.userId && partUsageRows.length > 0) {
      await deductUserInventoryPartsInTransaction(tx, company.id, {
        targetUid: assignmentIdentity.userId,
        partsUsed: partUsageRows,
        jobId: jobRow.id,
      }, now);
    }

    await tx.update(jobs).set({
      status: 'finished',
      finishedAt: jobRow.finishedAt || now,
      acceptedByUserId: input.acceptedByUserId,
      acceptedAt: now,
      updatedAt: now,
    }).where(eq(jobs.id, jobRow.id));

    return { jobId: String(jobRow.jobNo) };
  });
}

// ─── Cursor helpers ──────────────────────────────────────────────────────────
function encodeJobsCursor(dateValue: Date | string | null, rowId: string | null): string {
  const d = dateValue instanceof Date ? dateValue.toISOString() : (dateValue ?? '');
  const i = rowId ?? '';
  return Buffer.from(JSON.stringify({ d, i })).toString('base64');
}

function decodeJobsCursor(cursor: string): { dateValue: Date; id: string } | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    const dateValue = new Date(raw.d);
    const id = String(raw.i || '').trim();
    if (Number.isNaN(dateValue.getTime()) || !id) return null;
    return { dateValue, id };
  } catch {
    return null;
  }
}

async function getJobRecordById(
  companyId: string | number,
  jobId: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) return null;

  return db.transaction(async (tx) => {
    const jobRow = await getJobRowByNo(tx, company.id, jobId);
    if (!jobRow) return null;
    return fetchJobDetail(tx, company.id, jobRow);
  });
}

async function listCompanyJobsDetailed(
  companyId: string | number,
  profile: LegacyUserProfile | null,
  options: JobQueryOptions = {},
) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company || !profile) return { items: [], nextCursor: null };

  const normalizedRole = String(profile.role || '').trim().toLowerCase();
  if (normalizedRole === 'basic') {
    return { items: [], nextCursor: null };
  }

  const shouldScopeToMembership = normalizedRole === 'worker' || (normalizedRole === 'user' && String(profile.accountType || '') !== 'solo');
  const scopedMembershipId = shouldScopeToMembership ? profile.membershipId || '' : '';
  const rawLimit = Number(options.limit || options.pageSize);
  // For paginated callers the default page is 50; for archive callers passing limit:10000 we honour that.
  const effectiveLimit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 10000)
    : 50;
  const requestedStatuses = normalizeJobStatusList(options.status);
  const dateFieldKey: 'updatedAt' | 'finishedAt' | 'dueAt' | 'createdAt' = (() => {
    switch (String(options.dateField || '').trim()) {
      case 'updatedAt': return 'updatedAt';
      case 'finishedAt': return 'finishedAt';
      case 'dueAt': return 'dueAt';
      default: return 'createdAt';
    }
  })();
  const dateColumn = resolveJobDateColumn(options.dateField);
  const dateFrom = options.dateFrom ? asDate(options.dateFrom, null) : null;
  const dateTo = options.dateTo ? asDate(options.dateTo, null) : null;
  const afterCursor = options.afterCursor ? decodeJobsCursor(String(options.afterCursor)) : null;

  return db.transaction(async (tx) => {
    const conditions = [
      eq(jobs.companyId, company.id),
      ...(scopedMembershipId ? [eq(jobs.assignedMembershipId, scopedMembershipId)] : []),
      ...(requestedStatuses.length === 1 ? [eq(jobs.status, requestedStatuses[0])] : []),
      ...(requestedStatuses.length > 1 ? [inArray(jobs.status, requestedStatuses)] : []),
      ...(dateFrom ? [gte(dateColumn, dateFrom)] : []),
      ...(dateTo ? [lte(dateColumn, dateTo)] : []),
      // Stable composite cursor: for descending (date, id) order, next page has strictly older tuples.
      ...(afterCursor ? [sql`(${dateColumn}, ${jobs.id}) < (${afterCursor.dateValue}, ${afterCursor.id})`] : []),
    ];

    // Fetch one extra row to detect whether a next page exists.
    const fetchLimit = effectiveLimit + 1;

    const jobRows = await tx
      .select({
        id: jobs.id,
        companyId: jobs.companyId,
        jobNo: jobs.jobNo,
        status: jobs.status,
        title: jobs.title,
        description: jobs.description,
        notes: jobs.notes,
        location: jobs.location,
        address: jobs.address,
        category: jobs.category,
        priority: jobs.priority,
        dueAt: jobs.dueAt,
        clientId: jobs.clientId,
        assignedMembershipId: jobs.assignedMembershipId,
        createdByMembershipId: jobs.createdByMembershipId,
        acceptedByUserId: jobs.acceptedByUserId,
        acceptedAt: jobs.acceptedAt,
        finishedAt: jobs.finishedAt,
        deniedAt: jobs.deniedAt,
        deniedByUserId: jobs.deniedByUserId,
        isCert: jobs.isCert,
        idempotencyKey: jobs.idempotencyKey,
        clientNameSnapshot: jobs.clientNameSnapshot,
        clientPhoneSnapshot: jobs.clientPhoneSnapshot,
        assignedMemberNameSnapshot: jobs.assignedMemberNameSnapshot,
        createdByNameSnapshot: jobs.createdByNameSnapshot,
        meta: jobs.meta,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(dateColumn), desc(jobs.id))
      .limit(fetchLimit);

    // Detect if there is a next page.
    const hasMore = jobRows.length > effectiveLimit;
    const pageRows = hasMore ? jobRows.slice(0, effectiveLimit) : jobRows;

    if (pageRows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const jobIds = pageRows.map((row) => row.id);
    const [attachmentRows, partUsageRows, membershipRows, clientRows] = await Promise.all([
      tx
        .select({ jobId: jobAttachments.jobId, storagePath: jobAttachments.storagePath, kind: jobAttachments.kind })
        .from(jobAttachments)
        .where(inArray(jobAttachments.jobId, jobIds)),
      tx.execute(sql`
        SELECT
          u.job_id,
          u.quantity,
          u.part_name_snapshot,
          p.part_no
        FROM job_part_usages u
        LEFT JOIN inventory_parts p ON p.id = u.inventory_part_id
        WHERE u.job_id = ANY(${jobIds})
        ORDER BY u.created_at ASC
      `).then((result) => (result.rows || []).map((value) => {
        const row = value as UnknownRecord;
        return {
          jobId: String(row.job_id),
          ...mapPartUsageSqlRows([row])[0],
        };
      })),
      (() => {
        // Only query the membership rows actually referenced by these jobs.
        const referencedMembershipIds = [
          ...new Set(
            jobRows
              .flatMap((row) => [row.assignedMembershipId, row.createdByMembershipId])
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (referencedMembershipIds.length === 0) return Promise.resolve([]);
        return tx.execute(sql`
          SELECT
            m.id,
            m.member_no,
            m.role,
            m.user_id,
            COALESCE(m.display_name, u.display_name, u.email, '') AS name,
            COALESCE(m.phone_number, u.phone_number, '') AS phone_number
          FROM company_memberships m
          LEFT JOIN app_users u ON u.id = m.user_id
          WHERE m.id = ANY(${referencedMembershipIds})
            AND m.status = 'active'
        `).then((result) => (result.rows || []).map((value) => value as UnknownRecord));
      })(),
      (() => {
        // Only query the client rows actually referenced by these jobs.
        const referencedClientIds = [
          ...new Set(jobRows.map((row) => row.clientId).filter((id): id is string => Boolean(id))),
        ];
        if (referencedClientIds.length === 0) return Promise.resolve([]);
        return tx
          .select({ id: clients.id, clientNo: clients.clientNo, name: clients.name, phone: clients.phone })
          .from(clients)
          .where(inArray(clients.id, referencedClientIds));
      })(),
    ]);

    const attachmentsByJobId = new Map<string, AttachmentRow[]>();
    for (const row of attachmentRows) {
      const key = String(row.jobId);
      if (!attachmentsByJobId.has(key)) attachmentsByJobId.set(key, []);
      attachmentsByJobId.get(key)?.push(row);
    }

    const partUsageByJobId = new Map<string, PartUsageRow[]>();
    for (const row of partUsageRows) {
      const key = row.jobId;
      if (!partUsageByJobId.has(key)) partUsageByJobId.set(key, []);
      partUsageByJobId.get(key)?.push(row);
    }

    const membershipById = new Map<string, MembershipIdentity>();
    for (const row of membershipRows) {
      membershipById.set(String(row.id), {
        membershipId: String(row.id),
        memberNo: Number(row.member_no),
        role: String(row.role) as MembershipIdentity['role'],
        userId: String(row.user_id),
        name: String(row.name || ''),
        phoneNumber: String(row.phone_number || ''),
      });
    }

    const clientById = new Map<string, ClientIdentity>();
    for (const row of clientRows) {
      clientById.set(String(row.id), row);
    }

    const items = pageRows.map((row) => mapJobRecord(
        row,
        attachmentsByJobId.get(String(row.id)) || [],
        partUsageByJobId.get(String(row.id)) || [],
        membershipById.get(String(row.assignedMembershipId || '')) || null,
        membershipById.get(String(row.createdByMembershipId || '')) || null,
        clientById.get(String(row.clientId || '')) || null,
      ));

    const lastRow = pageRows[pageRows.length - 1] as JobRow;
    const nextCursor = hasMore
      ? encodeJobsCursor(lastRow[dateFieldKey] ?? lastRow.createdAt, String(lastRow.id))
      : null;

    return { items, nextCursor };
  });
}

export { acceptJob, createJob, deleteJob, encodeJobsCursor, getJobRecordById, listCompanyJobsDetailed, updateJob };

