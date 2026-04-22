import { eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { resolveCompanyByPublicId } from './membership';
import { companySyncState } from './schema';

const VERSION_FIELDS = [
  'jobsVersion',
  'documentsVersion',
  'clientsVersion',
  'workersVersion',
  'companyInventoryVersion',
];

function emptyCompanySyncState() {
  return {
    jobsVersion: 0,
    documentsVersion: 0,
    clientsVersion: 0,
    workersVersion: 0,
    companyInventoryVersion: 0,
    updatedAt: '',
  };
}

function toIsoString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toISOString === 'function') return value.toISOString();
  return String(value);
}

function toSafeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function mapCompanySyncStateRow(row) {
  if (!row) {
    return emptyCompanySyncState();
  }
  return {
    jobsVersion: toSafeInteger(row.jobsVersion ?? row.jobs_version),
    documentsVersion: toSafeInteger(row.documentsVersion ?? row.documents_version),
    clientsVersion: toSafeInteger(row.clientsVersion ?? row.clients_version),
    workersVersion: toSafeInteger(row.workersVersion ?? row.workers_version),
    companyInventoryVersion: toSafeInteger(row.companyInventoryVersion ?? row.company_inventory_version),
    updatedAt: toIsoString(row.updatedAt ?? row.updated_at),
  };
}

function normalizeAbsoluteValues(values: any = {}) {
  return {
    jobsVersion: toSafeInteger(values.jobsVersion),
    documentsVersion: toSafeInteger(values.documentsVersion),
    clientsVersion: toSafeInteger(values.clientsVersion),
    workersVersion: toSafeInteger(values.workersVersion),
    companyInventoryVersion: toSafeInteger(values.companyInventoryVersion),
  };
}

function normalizeIncrements(input: any = {}) {
  const increments: any = {
    jobsVersion: 0,
    documentsVersion: 0,
    clientsVersion: 0,
    workersVersion: 0,
    companyInventoryVersion: 0,
  };

  const fields: any = Array.isArray(input.fields) ? input.fields : [];
  for (const field of fields) {
    if (VERSION_FIELDS.includes(field)) {
      increments[field] += 1;
    }
  }

  if (input.increments && typeof input.increments === 'object') {
    for (const field of VERSION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input.increments, field)) {
        increments[field] += toSafeInteger(input.increments[field]);
      }
    }
  }

  return increments;
}

async function getCompanySyncState(companyId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    return emptyCompanySyncState();
  }

  const rows = await db
    .select({
      jobsVersion: companySyncState.jobsVersion,
      documentsVersion: companySyncState.documentsVersion,
      clientsVersion: companySyncState.clientsVersion,
      workersVersion: companySyncState.workersVersion,
      companyInventoryVersion: companySyncState.companyInventoryVersion,
      updatedAt: companySyncState.updatedAt,
    })
    .from(companySyncState)
    .where(eq(companySyncState.companyId, company.id))
    .limit(1);

  return mapCompanySyncStateRow(rows[0] || null);
}

async function initializeCompanySyncState(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const values = normalizeAbsoluteValues(input.values || input);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const result = await tx.execute(sql`
      INSERT INTO company_sync_state (
        company_id,
        jobs_version,
        documents_version,
        clients_version,
        workers_version,
        company_inventory_version,
        updated_at
      ) VALUES (
        ${company.id},
        ${values.jobsVersion},
        ${values.documentsVersion},
        ${values.clientsVersion},
        ${values.workersVersion},
        ${values.companyInventoryVersion},
        NOW()
      )
      ON CONFLICT (company_id)
      DO UPDATE SET
        jobs_version = EXCLUDED.jobs_version,
        documents_version = EXCLUDED.documents_version,
        clients_version = EXCLUDED.clients_version,
        workers_version = EXCLUDED.workers_version,
        company_inventory_version = EXCLUDED.company_inventory_version,
        updated_at = NOW()
      RETURNING jobs_version, documents_version, clients_version, workers_version, company_inventory_version, updated_at
    `);

    return mapCompanySyncStateRow(result.rows?.[0] || null);
  });
}

async function bumpCompanySyncState(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const increments: any = normalizeIncrements(input);
  const hasChanges = VERSION_FIELDS.some((field) => increments[field] > 0);
  if (!hasChanges) {
    return getCompanySyncState(input.companyId, options);
  }

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const result = await tx.execute(sql`
      INSERT INTO company_sync_state (
        company_id,
        jobs_version,
        documents_version,
        clients_version,
        workers_version,
        company_inventory_version,
        updated_at
      ) VALUES (
        ${company.id},
        ${increments.jobsVersion},
        ${increments.documentsVersion},
        ${increments.clientsVersion},
        ${increments.workersVersion},
        ${increments.companyInventoryVersion},
        NOW()
      )
      ON CONFLICT (company_id)
      DO UPDATE SET
        jobs_version = company_sync_state.jobs_version + EXCLUDED.jobs_version,
        documents_version = company_sync_state.documents_version + EXCLUDED.documents_version,
        clients_version = company_sync_state.clients_version + EXCLUDED.clients_version,
        workers_version = company_sync_state.workers_version + EXCLUDED.workers_version,
        company_inventory_version = company_sync_state.company_inventory_version + EXCLUDED.company_inventory_version,
        updated_at = NOW()
      RETURNING jobs_version, documents_version, clients_version, workers_version, company_inventory_version, updated_at
    `);

    return mapCompanySyncStateRow(result.rows?.[0] || null);
  });
}

export { bumpCompanySyncState, getCompanySyncState, initializeCompanySyncState };

