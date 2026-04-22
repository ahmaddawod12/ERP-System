import { and, eq } from 'drizzle-orm';
import { getDb } from './client';

const {
  clients,
  companyMemberships,
  documents,
  jobs,
} = require('./schema');
const {
  allocateCompanyCounter,
  resolveCompanyByPublicId,
} = require('./membership');

function asDate(value, fallback) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function findMembershipId(tx, internalCompanyId, userId) {
  const rows = await tx
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, internalCompanyId),
      eq(companyMemberships.userId, userId),
      eq(companyMemberships.status, 'active'),
    ))
    .limit(1);
  return rows[0]?.id || null;
}

async function getClientByClientNo(companyId, clientNo, options: any = {}) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) return null;

  const normalizedClientNo = Number(clientNo);
  if (!Number.isInteger(normalizedClientNo) || normalizedClientNo < 1) {
    return null;
  }

  const rows = await db
    .select({
      clientNo: clients.clientNo,
      name: clients.name,
      phone: clients.phone,
      email: clients.email,
      address: clients.address,
      city: clients.city,
      vatNumber: clients.vatNumber,
      notes: clients.notes,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(and(
      eq(clients.companyId, company.id),
      eq(clients.clientNo, normalizedClientNo),
    ))
    .limit(1);

  const client = rows[0] || null;
  if (!client) return null;
  return {
    id: String(client.clientNo),
    cid: client.clientNo,
    name: client.name || '',
    cname: client.name || '',
    phone: client.phone || '',
    cphone: client.phone || '',
    email: client.email || undefined,
    address: client.address || undefined,
    city: client.city || undefined,
    vatNumber: client.vatNumber || undefined,
    notes: client.notes || undefined,
    createdAt: client.createdAt instanceof Date ? client.createdAt.toISOString() : String(client.createdAt || ''),
    updatedAt: client.updatedAt instanceof Date ? client.updatedAt.toISOString() : String(client.updatedAt || ''),
  };
}

async function createClient(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const membershipId = await findMembershipId(tx, company.id, input.createdByUserId);
    const clientNo = await allocateCompanyCounter(tx, company.id, 'client_no');
    const [client] = await tx.insert(clients).values({
      companyId: company.id,
      clientNo,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      city: input.city || null,
      vatNumber: input.vatNumber || null,
      notes: input.notes || null,
      createdByMembershipId: membershipId,
      createdAt: now,
      updatedAt: now,
    }).returning({
      clientNo: clients.clientNo,
      name: clients.name,
      email: clients.email,
      phone: clients.phone,
      address: clients.address,
      city: clients.city,
      vatNumber: clients.vatNumber,
      notes: clients.notes,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    });

    return {
      id: String(client.clientNo),
      cid: client.clientNo,
      cname: client.name,
      cphone: client.phone || '',
      email: client.email || undefined,
      address: client.address || undefined,
      city: client.city || undefined,
      vatNumber: client.vatNumber || undefined,
      notes: client.notes || undefined,
      createdAt: client.createdAt instanceof Date ? client.createdAt.toISOString() : String(client.createdAt || now.toISOString()),
      updatedAt: client.updatedAt instanceof Date ? client.updatedAt.toISOString() : String(client.updatedAt || now.toISOString()),
    };
  });
}

async function updateClient(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const clientNo = Number(input.clientId);
    if (!Number.isInteger(clientNo) || clientNo < 1) {
      const error = new Error('Client not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const existingRows = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(
        eq(clients.companyId, company.id),
        eq(clients.clientNo, clientNo),
      ))
      .limit(1);
    const existing = existingRows[0] || null;
    if (!existing) {
      const error = new Error('Client not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const updateData: Record<string, any> = { updatedAt: now };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.email !== undefined) updateData.email = input.email || null;
    if (input.phone !== undefined) updateData.phone = input.phone || null;
    if (input.address !== undefined) updateData.address = input.address || null;
    if (input.city !== undefined) updateData.city = input.city || null;
    if (input.vatNumber !== undefined) updateData.vatNumber = input.vatNumber || null;
    if (input.notes !== undefined) updateData.notes = input.notes || null;

    await tx.update(clients).set(updateData).where(eq(clients.id, existing.id));
    return { clientId: String(clientNo) };
  });
}

async function deleteClient(input, options: any = {}) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const clientNo = Number(input.clientId);
    if (!Number.isInteger(clientNo) || clientNo < 1) {
      const error = new Error('Client not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const existingRows = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(
        eq(clients.companyId, company.id),
        eq(clients.clientNo, clientNo),
      ))
      .limit(1);
    const existing = existingRows[0] || null;
    if (!existing) {
      const error = new Error('Client not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const [jobReference, documentReference] = await Promise.all([
      tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.clientId, existing.id)).limit(1),
      tx.select({ id: documents.id }).from(documents).where(eq(documents.clientId, existing.id)).limit(1),
    ]);
    if ((jobReference && jobReference.length > 0) || (documentReference && documentReference.length > 0)) {
      const error = new Error('Client is referenced by jobs or documents and cannot be deleted');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    await tx.delete(clients).where(eq(clients.id, existing.id));
    return { clientId: String(clientNo) };
  });
}

export { createClient, deleteClient, getClientByClientNo, updateClient };

