import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';

const {
  companies,
  documents,
  jobs,
} = require('./schema');
const { listCompanyDocumentsDetailed } = require('./documents');
const { listCompanyJobsDetailed } = require('./jobs');
const { resolveCompanyByPublicId } = require('./membership');

const ARCHIVE_QUERY_LIMIT = 10000;

function normalizePublicIds(values, coerce) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const coerced = coerce(value);
    if (coerced === null || seen.has(coerced)) {
      continue;
    }
    seen.add(coerced);
    normalized.push(coerced);
  }

  return normalized;
}

async function listCompanyPublicIds(options: any = {}) {
  const db = options.db || getDb(options.env);
  const rows = await db
    .select({ publicCompanyId: companies.publicCompanyId })
    .from(companies);

  return rows
    .map((row) => String(row.publicCompanyId || '').trim())
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right));
}

async function listArchivedCompanyJobs(companyId, options: any = {}) {
  const result = await listCompanyJobsDetailed(companyId, { role: 'manager' }, {
    ...options,
    limit: ARCHIVE_QUERY_LIMIT,
  });
  const records = result.items;

  if (records.length >= ARCHIVE_QUERY_LIMIT) {
    const error = new Error(`Archive query limit reached for jobs in company ${companyId}`);
    (error as any).code = 'resource-exhausted';
    throw error;
  }

  return records;
}

async function listArchivedCompanyDocuments(companyId, options: any = {}) {
  const result = await listCompanyDocumentsDetailed(companyId, {
    ...options,
    limit: ARCHIVE_QUERY_LIMIT,
  });
  const records = result.items;

  if (records.length >= ARCHIVE_QUERY_LIMIT) {
    const error = new Error(`Archive query limit reached for documents in company ${companyId}`);
    (error as any).code = 'resource-exhausted';
    throw error;
  }

  return records;
}

async function deleteArchivedJobsByIds(companyId, jobIds, options: any = {}) {
  const normalizedJobIds = normalizePublicIds(jobIds, (value) => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  });
  if (normalizedJobIds.length === 0) {
    return 0;
  }

  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    const error = new Error('Company not found');
    (error as any).code = 'not-found';
    throw error;
  }

  const deletedRows = await db.delete(jobs)
    .where(and(
      eq(jobs.companyId, company.id),
      inArray(jobs.jobNo, normalizedJobIds),
    ))
    .returning({ jobNo: jobs.jobNo });

  return deletedRows.length;
}

async function deleteArchivedDocumentsByIds(companyId, documentIds, options: any = {}) {
  const normalizedDocumentIds = normalizePublicIds(documentIds, (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
  });
  if (normalizedDocumentIds.length === 0) {
    return 0;
  }

  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    const error = new Error('Company not found');
    (error as any).code = 'not-found';
    throw error;
  }

  const deletedRows = await db.delete(documents)
    .where(and(
      eq(documents.companyId, company.id),
      inArray(documents.documentCode, normalizedDocumentIds),
    ))
    .returning({ documentCode: documents.documentCode });

  return deletedRows.length;
}

export {
  ARCHIVE_QUERY_LIMIT,
  deleteArchivedDocumentsByIds,
  deleteArchivedJobsByIds,
  listArchivedCompanyDocuments,
  listArchivedCompanyJobs,
  listCompanyPublicIds,
};
