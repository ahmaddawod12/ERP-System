import { setDatabaseErrorCode } from './errors';
import { eq } from 'drizzle-orm';
import { getDb, type DatabaseOptions } from './client';
import { companyCounters } from './schema';
import { allocateCompanyCounter, resolveCompanyByPublicId } from './membership';

type DocumentCounterKey = Extract<
  typeof companyCounters.$inferInsert['counterKey'],
  `doc_${string}`
>;

function normalizeDocumentCounterKey(documentType: unknown): DocumentCounterKey {
  const numericType = Number(documentType);
  if (!Number.isInteger(numericType) || numericType < 1) {
    const error = new Error('Document type is required');
    setDatabaseErrorCode(error, 'invalid-argument');
    throw error;
  }
  return `doc_${numericType}` as DocumentCounterKey;
}

async function getCompanyDocumentCounterValue(
  companyId: string | number,
  documentType: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const counterKey = normalizeDocumentCounterKey(documentType);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
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
      setDatabaseErrorCode(error, 'failed-precondition');
      throw error;
    }
    return nextValue;
  });
}

async function allocateCompanyDocumentNumber(
  companyId: string | number,
  documentType: string | number,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const counterKey = normalizeDocumentCounterKey(documentType);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, companyId);
    if (!company) {
      const error = new Error('Company not found');
      setDatabaseErrorCode(error, 'not-found');
      throw error;
    }
    return allocateCompanyCounter(tx, company.id, counterKey);
  });
}

export { allocateCompanyDocumentNumber, getCompanyDocumentCounterValue };

