import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from './client';

const {
  companies,
  documents,
  jobs,
  archiveRuns,
} = require('./schema');
const { listCompanyDocumentsDetailed } = require('./documents');
const { listCompanyJobsDetailed } = require('./jobs');
const { resolveCompanyByPublicId } = require('./membership');

const ARCHIVE_QUERY_LIMIT = 10000;

function resolveArchivePageSize(options: any = {}) {
  const rawPageSize = Number(options.pageSize || options.limit);
  return Number.isInteger(rawPageSize) && rawPageSize > 0
    ? Math.min(rawPageSize, ARCHIVE_QUERY_LIMIT)
    : Math.min(1000, ARCHIVE_QUERY_LIMIT);
}

function buildArchivePageOptions(options: any = {}) {
  const { pageSize, limit, ...rest } = options;
  return {
    ...rest,
    limit: resolveArchivePageSize(options),
  };
}

async function listAllArchivedRecords(loadPage, companyId, options: any = {}) {
  const records = [];
  const seenCursors = new Set();
  let afterCursor = options.afterCursor ? String(options.afterCursor) : null;
  const pageOptions = { ...options };
  delete pageOptions.afterCursor;

  while (true) {
    const page = await loadPage(companyId, {
      ...pageOptions,
      ...(afterCursor ? { afterCursor } : {}),
    });
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    records.push(...pageItems);

    if (!page?.nextCursor) {
      return records;
    }

    if (seenCursors.has(page.nextCursor)) {
      const error = new Error(`Archive cursor loop detected for company ${companyId}`);
      (error as any).code = 'failed-precondition';
      throw error;
    }

    seenCursors.add(page.nextCursor);
    afterCursor = page.nextCursor;
  }
}

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

async function listArchivedCompanyJobsPage(companyId, options: any = {}) {
  return listCompanyJobsDetailed(companyId, { role: 'manager' }, buildArchivePageOptions(options));
}

async function listArchivedCompanyJobs(companyId, options: any = {}) {
  return listAllArchivedRecords(listArchivedCompanyJobsPage, companyId, options);
}

async function listArchivedCompanyDocumentsPage(companyId, options: any = {}) {
  return listCompanyDocumentsDetailed(companyId, buildArchivePageOptions(options));
}

async function listArchivedCompanyDocuments(companyId, options: any = {}) {
  return listAllArchivedRecords(listArchivedCompanyDocumentsPage, companyId, options);
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

function normalizeArchiveCompletedAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    const error = new Error('Archive completion time is invalid');
    (error as any).code = 'invalid-argument';
    throw error;
  }
  return date;
}

async function recordArchiveRun(companyId, archiveKey, dataType, details, options = {}) {
  const db = (options as any).db || getDb((options as any).env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    const error = new Error('Company not found');
    (error as any).code = 'not-found';
    throw error;
  }

  const values = {
    companyId: company.id,
    archiveKey: String(archiveKey),
    dataType: String(dataType),
    status: details.status || 'pending',
    docCount: Number(details.docCount || 0),
    deletedCount: Number(details.deletedCount || 0),
    storagePath: details.storagePath || null,
    checksum: details.checksum || null,
    completedAt: normalizeArchiveCompletedAt(details.completedAt),
  };

  await db.insert(archiveRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [archiveRuns.companyId, archiveRuns.archiveKey, archiveRuns.dataType],
      set: {
        status: values.status,
        docCount: values.docCount,
        deletedCount: values.deletedCount,
        storagePath: values.storagePath,
        checksum: values.checksum,
        completedAt: values.completedAt,
      },
    });
}

export {
  ARCHIVE_QUERY_LIMIT,
  deleteArchivedDocumentsByIds,
  deleteArchivedJobsByIds,
  listArchivedCompanyDocuments,
  listArchivedCompanyDocumentsPage,
  listArchivedCompanyJobs,
  listArchivedCompanyJobsPage,
  listCompanyPublicIds,
  normalizeArchiveCompletedAt,
  recordArchiveRun,
};
