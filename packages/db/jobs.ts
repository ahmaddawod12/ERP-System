import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from './client';

const {
  appUsers,
  clients,
  companyMemberships,
  jobAttachments,
  jobPartUsages,
  jobs,
} = require('./schema');
const {
  allocateCompanyCounter,
  findActiveMembership,
  resolveCompanyByPublicId,
} = require('./membership');
const {
  deductUserInventoryPartsInTransaction,
} = require('./inventory');

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneMeta(meta) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...meta }
    : {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizePartList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      quantity: Number(entry.quantity || 0),
      partId: entry.partId,
      unit: typeof entry.unit === 'string' ? entry.unit : undefined,
    }));
}

function normalizeAttachmentRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.storagePath === 'string') {
        return { storagePath: entry.storagePath.trim() };
      }
      return null;
    })
    .filter((entry) => entry && entry.storagePath);
}

function resolveDueAt(value) {
  if (!value) return null;
  const parsed = asDate(value, null);
  return parsed || null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function resolveJobDateColumn(dateField) {
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

async function getMembershipIdentity(tx, companyInternalId, membershipId) {
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

async function getMembershipByMemberNo(tx, companyInternalId, memberNo) {
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

async function getClientByNo(tx, companyInternalId, clientNo) {
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

async function getJobRowByNo(tx, companyInternalId, jobNo) {
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

function buildJobMeta(payload, existingMeta: any = {}) {
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

async function replaceJobAttachments(tx, jobInternalId, userId, photos, signature, now) {
  await tx.delete(jobAttachments).where(eq(jobAttachments.jobId, jobInternalId));

  const rows = [];
  for (const photo of normalizeAttachmentRefs(photos)) {
    rows.push({
      jobId: jobInternalId,
      storagePath: photo.storagePath,
      kind: 'photo',
      uploadedByUserId: userId || null,
      createdAt: now,
    });
  }
  if (signature && typeof signature === 'object' && typeof signature.storagePath === 'string' && signature.storagePath.trim()) {
    rows.push({
      jobId: jobInternalId,
      storagePath: signature.storagePath.trim(),
      kind: 'signature',
      uploadedByUserId: userId || null,
      createdAt: now,
    });
  }

  if (rows.length > 0) {
    await tx.insert(jobAttachments).values(rows);
  }
}

async function replaceJobPartUsages(tx, jobInternalId, companyInternalId, partsUsed, now) {
  await tx.delete(jobPartUsages).where(eq(jobPartUsages.jobId, jobInternalId));

  const normalizedParts = normalizePartList(partsUsed)
    .filter((part) => Number.isFinite(Number(part.quantity)) && Number(part.quantity) >= 0 && part.id !== undefined && part.id !== null && String(part.id).trim() !== '');

  if (normalizedParts.length === 0) {
    return;
  }

  const requestedPartNos = Array.from(new Set(normalizedParts
    .map((part) => numericOrNull(part.id ?? part.partId))
    .filter((partNo) => partNo)));
  const partIdByNo = new Map();
  if (requestedPartNos.length > 0) {
    const partResult = await tx.execute(sql`
      SELECT id, part_no
      FROM inventory_parts
      WHERE company_id = ${companyInternalId}
        AND part_no = ANY(${requestedPartNos})
    `);
    for (const row of partResult.rows || []) {
      partIdByNo.set(Number(row.part_no), row.id);
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

function mapJobRecord(jobRow, attachmentRows, partRows, assignmentIdentity, creatorIdentity, clientRow) {
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
    timeFrom: meta.timeFrom || undefined,
    timeTo: meta.timeTo || undefined,
    signingPerson: meta.signingPerson || undefined,
    photos,
    signature: signatureRow ? { storagePath: signatureRow.storagePath } : null,
    parts: Array.isArray(meta.parts) ? meta.parts : undefined,
    partsUsed: partRows.map((row) => ({
      id: row.partNo != null ? Number(row.partNo) : (row.partNameSnapshot || ''),
      name: row.partNameSnapshot || '',
      quantity: Number(row.quantity || 0),
    })),
    travelDistance: meta.travelDistance == null ? null : Number(meta.travelDistance),
    finishedAt: jobRow.finishedAt instanceof Date ? jobRow.finishedAt.toISOString() : (jobRow.finishedAt ? String(jobRow.finishedAt) : undefined),
    deniedAt: jobRow.deniedAt instanceof Date ? jobRow.deniedAt.toISOString() : (jobRow.deniedAt ? String(jobRow.deniedAt) : undefined),
    deniedBy: meta.deniedBy || undefined,
    approvedBy: meta.approvedBy || undefined,
    isCert: jobRow.isCert === true,
    tags: Array.isArray(meta.tags) ? meta.tags : undefined,
    images: Array.isArray(meta.images) ? meta.images : undefined,
  };
}

async function fetchJobDetail(tx, companyInternalId, jobRow) {
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
    `).then((result) => result.rows || []),
    getMembershipIdentity(tx, companyInternalId, jobRow.assignedMembershipId),
    getMembershipIdentity(tx, companyInternalId, jobRow.createdByMembershipId),
    jobRow.clientId
      ? tx.select({ clientNo: clients.clientNo, name: clients.name, phone: clients.phone }).from(clients).where(eq(clients.id, jobRow.clientId)).limit(1).then((rows) => rows[0] || null)
      : Promise.resolve(null),
  ]);

  return mapJobRecord(jobRow, attachmentRows, partRows, assignmentIdentity, creatorIdentity, clientRow);
}

async function getPersistedJobPartUsages(tx, jobInternalId) {
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
    .map((row) => ({
      id: row.part_no != null ? Number(row.part_no) : null,
      quantity: Number(row.quantity || 0),
    }))
    .filter((row) => Number.isInteger(row.id) && Number.isFinite(row.quantity) && row.quantity > 0);
}

async function createJob(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
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
      (error as any).code = 'permission-denied';
      throw error;
    }

    const jobNo = await allocateCompanyCounter(tx, company.id, 'job_no');
    const assignedMembership = input.wid ? await getMembershipByMemberNo(tx, company.id, input.wid) : null;
    const clientRow = input.cid ? await getClientByNo(tx, company.id, input.cid) : null;
    if (input.wid && !assignedMembership) {
      const error = new Error('Assigned worker not found');
      (error as any).code = 'not-found';
      throw error;
    }
    if (input.cid && !clientRow) {
      const error = new Error('Client not found');
      (error as any).code = 'not-found';
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

    await replaceJobAttachments(tx, jobRow.id, input.createdByUserId, input.photos, input.signature, now);
    await replaceJobPartUsages(tx, jobRow.id, company.id, input.partsUsed || [], now);
    if (status === 'finished' && input.inventoryDeductionTargetUid) {
      await deductUserInventoryPartsInTransaction(tx, company.id, {
        targetUid: input.inventoryDeductionTargetUid,
        partsUsed: input.partsUsed || [],
        jobId: jobRow.id,
      }, now);
    }

    return { jobId: String(jobNo), duplicate: false };
  });
}

async function updateJob(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const updateData: Record<string, any> = { updatedAt: now };
    if (Object.prototype.hasOwnProperty.call(input, 'title')) updateData.title = input.title || null;
    if (Object.prototype.hasOwnProperty.call(input, 'description')) updateData.description = input.description || null;
    if (Object.prototype.hasOwnProperty.call(input, 'notes')) updateData.notes = input.notes || null;
    if (Object.prototype.hasOwnProperty.call(input, 'location')) updateData.location = input.location || null;
    if (Object.prototype.hasOwnProperty.call(input, 'address')) updateData.address = input.address || null;
    if (Object.prototype.hasOwnProperty.call(input, 'category')) updateData.category = input.category || null;
    if (Object.prototype.hasOwnProperty.call(input, 'priority')) updateData.priority = input.priority || null;
    if (Object.prototype.hasOwnProperty.call(input, 'dueDate')) updateData.dueAt = resolveDueAt(input.dueDate);
    if (Object.prototype.hasOwnProperty.call(input, 'status') && input.status) updateData.status = input.status;
    if (Object.prototype.hasOwnProperty.call(input, 'finishedAt')) updateData.finishedAt = input.finishedAt ? asDate(input.finishedAt, now) : null;
    if (Object.prototype.hasOwnProperty.call(input, 'deniedAt')) updateData.deniedAt = input.deniedAt ? asDate(input.deniedAt, now) : null;
    if (Object.prototype.hasOwnProperty.call(input, 'cid')) {
      const clientRow = input.cid ? await getClientByNo(tx, company.id, input.cid) : null;
      if (input.cid && !clientRow) {
        const error = new Error('Client not found');
        (error as any).code = 'not-found';
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
        (error as any).code = 'not-found';
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

async function deleteJob(input, options: any = {}) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      (error as any).code = 'not-found';
      throw error;
    }
    if (jobRow.isCert === true) {
      const error = new Error('Cannot delete a job that has a generated document (isCert=true)');
      (error as any).code = 'failed-precondition';
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

async function acceptJob(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const jobRow = await getJobRowByNo(tx, company.id, input.jobId);
    if (!jobRow) {
      const error = new Error('Job not found');
      (error as any).code = 'not-found';
      throw error;
    }
    if (jobRow.status && !['pending', 'waiting'].includes(jobRow.status)) {
      const error = new Error(`Cannot accept job with status "${jobRow.status}". Expected: pending, waiting`);
      (error as any).code = 'failed-precondition';
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

async function getJobRecordById(companyId, jobId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) return null;

  return db.transaction(async (tx) => {
    const jobRow = await getJobRowByNo(tx, company.id, jobId);
    if (!jobRow) return null;
    return fetchJobDetail(tx, company.id, jobRow);
  });
}

async function listCompanyJobsDetailed(companyId, profile, options: any = {}) {
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
  const requestedStatuses = normalizeStringList(options.status);
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
      `).then((result) => result.rows || []),
      (() => {
        // Only query the membership rows actually referenced by these jobs.
        const referencedMembershipIds = [
          ...new Set(
            jobRows
              .flatMap((row) => [row.assignedMembershipId, row.createdByMembershipId])
              .filter(Boolean),
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
        `).then((result) => result.rows || []);
      })(),
      (() => {
        // Only query the client rows actually referenced by these jobs.
        const referencedClientIds = [...new Set(jobRows.map((row) => row.clientId).filter(Boolean))];
        if (referencedClientIds.length === 0) return Promise.resolve([]);
        return tx
          .select({ id: clients.id, clientNo: clients.clientNo, name: clients.name, phone: clients.phone })
          .from(clients)
          .where(inArray(clients.id, referencedClientIds));
      })(),
    ]);

    const attachmentsByJobId = new Map();
    for (const row of attachmentRows) {
      const key = String(row.jobId);
      if (!attachmentsByJobId.has(key)) attachmentsByJobId.set(key, []);
      attachmentsByJobId.get(key).push(row);
    }

    const partUsageByJobId = new Map();
    for (const row of partUsageRows) {
      const key = String(row.job_id);
      if (!partUsageByJobId.has(key)) partUsageByJobId.set(key, []);
      partUsageByJobId.get(key).push(row);
    }

    const membershipById = new Map();
    for (const row of membershipRows) {
      membershipById.set(String(row.id), {
        membershipId: row.id,
        memberNo: row.member_no,
        role: row.role,
        userId: row.user_id,
        name: row.name || '',
        phoneNumber: row.phone_number || '',
      });
    }

    const clientById = new Map();
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

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore
      ? encodeJobsCursor(lastRow[dateFieldKey] ?? lastRow.createdAt, String(lastRow.id))
      : null;

    return { items, nextCursor };
  });
}

export { acceptJob, createJob, deleteJob, encodeJobsCursor, getJobRecordById, listCompanyJobsDetailed, updateJob };

