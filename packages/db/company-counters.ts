import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { companyCounters } from './schema';
import { allocateCompanyCounter, resolveCompanyByPublicId } from './membership';

function normalizeDocumentCounterKey(documentType) {
  const numericType = Number(documentType);
  if (!Number.isInteger(numericType) || numericType < 1) {
    const error = new Error('Document type is required');
    (error as any).code = 'invalid-argument';
    throw error;
  }
  return `doc_${numericType}`;
}

async function getCompanyDocumentCounterValue(companyId, documentType, options: any = {}) {
  const db = options.db || getDb(options.env);
  const counterKey = normalizeDocumentCounterKey(documentType);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const rows = await tx
      .select({ counterKey: companyCounters.counterKey, nextValue: companyCounters.nextValue })
      .from(companyCounters)
      .where(eq(companyCounters.companyId, company.id));
    const matched = rows.find((row) => String(row.counterKey) === counterKey);
    const nextValue = Number(matched?.nextValue);
    if (!Number.isInteger(nextValue) || nextValue < 1) {
      const error = new Error(`Counter ${counterKey} not found`);
      (error as any).code = 'failed-precondition';
      throw error;
    }
    return nextValue;
  });
}

async function allocateCompanyDocumentNumber(companyId, documentType, options: any = {}) {
  const db = options.db || getDb(options.env);
  const counterKey = normalizeDocumentCounterKey(documentType);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }
    return allocateCompanyCounter(tx, company.id, counterKey);
  });
}

export { allocateCompanyDocumentNumber, getCompanyDocumentCounterValue };

