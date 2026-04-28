import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';

const {
  appUsers,
  clients,
  companyMemberships,
  documentItems,
  documentJobLinks,
  documents,
  jobs,
  proposalUsage,
} = require('./schema');
const {
  findActiveMembership,
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

function coerceTrimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function coerceOptionalString(value) {
  const trimmed = coerceTrimmedString(value);
  return trimmed || null;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeDocumentPayload(record: any = {}) {
  if (record.documentData && typeof record.documentData === 'object' && !Array.isArray(record.documentData)) {
    return { ...record.documentData };
  }
  return {};
}

function normalizeDocumentItems(record: any = {}) {
  const rawItems = Array.isArray(record.items)
    ? record.items
    : (Array.isArray(record.documentData?.items) ? record.documentData.items : []);

  return rawItems
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const description = coerceTrimmedString(item.description || item.name);
      const quantity = Number(item.quantity ?? 0);
      const unitPrice = Number(item.price ?? item.unitPrice ?? 0);
      const partId = numericOrNull(item.partId ?? item.id);
      return {
        lineNo: index + 1,
        description,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        lineTotal: roundCurrency((Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitPrice) ? unitPrice : 0)),
        metadata: partId !== null ? { partId } : {},
      };
    });
}

function normalizeLinkedJobIds(input: any = {}) {
  const source = Array.isArray(input.linkedJobIds)
    ? input.linkedJobIds
    : (Array.isArray(input.record?.jobsData) ? input.record.jobsData.map((entry) => entry?.jobId) : []);
  const ids = [];
  for (const rawId of source) {
    const normalized = coerceTrimmedString(rawId);
    if (normalized && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  }
  return ids;
}

function extractDocumentTotals(record: any = {}) {
  return {
    totalBeforeVat: roundCurrency(record.totalBeforeVat ?? record.documentData?.totals?.totalBeforeVat ?? 0),
    vatAmount: roundCurrency(record.vatAmount ?? record.documentData?.totals?.vatAmount ?? 0),
    totalWithVat: roundCurrency(record.totalWithVat ?? record.documentData?.totals?.totalWithVat ?? 0),
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  const single = coerceTrimmedString(value);
  return single ? [single] : [];
}

function resolveDocumentDateColumnName(dateField: string): string {
  switch (String(dateField || '').trim()) {
    case 'documentDate': return 'd.document_date';
    case 'updatedAt': return 'd.updated_at';
    default: return 'd.created_at';
  }
}

// ─── Cursor helpers ───────────────────────────────────────────────────────────
function encodeDocumentsCursor(dateValue: Date | string | null, rowId: string | null): string {
  const d = dateValue instanceof Date ? dateValue.toISOString() : (dateValue ?? '');
  const i = rowId ?? '';
  return Buffer.from(JSON.stringify({ d, i })).toString('base64');
}

function decodeDocumentsCursor(cursor: string): { dateValue: Date; id: string } | null {
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

function resolveDocumentDateColumnSql(dateField) {
  switch (String(dateField || '').trim()) {
    case 'documentDate':
      return sql`d.document_date`;
    case 'updatedAt':
      return sql`d.updated_at`;
    case 'createdAt':
    default:
      return sql`d.created_at`;
  }
}

function buildDocumentRowValues(input, companyInternalId, createdByMembershipId, clientInternalId, sourcePriceProposalInternalId, now) {
  const record = input.record || {};
  const payload = normalizeDocumentPayload(record);
  const totals = extractDocumentTotals(record);
  const client = payload.client && typeof payload.client === 'object' ? payload.client : {};
  const company = payload.company && typeof payload.company === 'object' ? payload.company : {};
  const documentType = Number(input.documentType ?? record.documentType ?? record.type);
  const documentNumber = Number(input.documentNumber ?? record.documentNumber);

  if (!Number.isInteger(documentType)) {
    const error = new Error('Document type is required');
    (error as any).code = 'invalid-argument';
    throw error;
  }

  if (!Number.isInteger(documentNumber) || documentNumber < 1) {
    const error = new Error('Document number is required');
    (error as any).code = 'invalid-argument';
    throw error;
  }

  return {
    companyId: companyInternalId,
    documentType,
    documentNumber,
    documentCode: coerceTrimmedString(input.documentId || record.documentId),
    generationStatus: coerceTrimmedString(input.generationStatus) || (record.storagePath ? 'completed' : 'pending'),
    taxAuthorityStatus: record.taxAuthorityResponseData ? 'approved' : 'none',
    clientId: clientInternalId,
    createdByMembershipId: createdByMembershipId || null,
    sourcePriceProposalId: sourcePriceProposalInternalId || null,
    storagePath: coerceOptionalString(record.storagePath),
    language: coerceOptionalString(record.language || payload.language),
    documentDate: asDate(record.date || payload.date, null),
    notes: coerceOptionalString(record.notes || payload.notes),
    totalBeforeVat: String(totals.totalBeforeVat),
    vatAmount: String(totals.vatAmount),
    totalWithVat: String(totals.totalWithVat),
    confirmationNumber: coerceOptionalString(record.confirmationNumber || record.taxAuthorityConfirmationNumber || payload.taxAuthorityConfirmationNumber),
    taxAuthorityResponse: record.taxAuthorityResponseData || null,
    emailSent: record.emailSent === true,
    companyNameSnapshot: coerceOptionalString(company.name || company.he_name || company.en_name),
    companyVatSnapshot: coerceOptionalString(company.vatNumber || company.vat_number),
    companyAddressSnapshot: coerceOptionalString(company.address),
    clientNameSnapshot: coerceOptionalString(record.cname || client.name),
    clientPhoneSnapshot: coerceOptionalString(record.cphone || client.phone),
    clientCitySnapshot: coerceOptionalString(record.clientCity || client.city),
    clientVatSnapshot: coerceOptionalString(record.clientVatNumber || client.clientVatNumber || client.vatNumber),
    payload,
    updatedAt: now,
  };
}

async function resolveClientInternalId(tx, companyInternalId, record: any = {}) {
  const clientNo = numericOrNull(record.cid ?? record.clientId ?? record.documentData?.client?.clientId ?? record.documentData?.client?.id);
  if (!clientNo) return null;
  const rows = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(
      eq(clients.companyId, companyInternalId),
      eq(clients.clientNo, clientNo),
    ))
    .limit(1);
  return rows[0]?.id || null;
}

async function resolveSourcePriceProposalInternalId(tx, companyInternalId, sourcePriceProposalId) {
  const documentCode = coerceTrimmedString(sourcePriceProposalId);
  if (!documentCode) return null;
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.companyId, companyInternalId),
      eq(documents.documentCode, documentCode),
    ))
    .limit(1);
  return rows[0]?.id || null;
}

async function fetchInternalJobIds(tx, companyInternalId, linkedJobIds) {
  const numericJobNos = linkedJobIds
    .map((jobId) => numericOrNull(jobId))
    .filter((jobNo) => Number.isInteger(jobNo));
  if (numericJobNos.length === 0) {
    return [];
  }

  const rows = await tx
    .select({ id: jobs.id, jobNo: jobs.jobNo })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyInternalId),
      inArray(jobs.jobNo, numericJobNos),
    ));
  const byJobNo = new Map(rows.map((row) => [Number(row.jobNo), row.id]));
  return numericJobNos.map((jobNo) => byJobNo.get(jobNo)).filter(Boolean);
}

async function replaceDocumentItems(tx, documentInternalId, normalizedItems) {
  await tx.delete(documentItems).where(eq(documentItems.documentId, documentInternalId));
  if (normalizedItems.length === 0) {
    return;
  }
  await tx.insert(documentItems).values(normalizedItems.map((item) => ({
    documentId: documentInternalId,
    lineNo: item.lineNo,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    lineTotal: String(item.lineTotal),
    sourceInventoryPartId: null,
    metadata: item.metadata,
  })));
}

async function replaceDocumentJobLinks(tx, documentInternalId, internalJobIds) {
  await tx.delete(documentJobLinks).where(eq(documentJobLinks.documentId, documentInternalId));
  if (internalJobIds.length === 0) {
    return;
  }
  await tx.insert(documentJobLinks).values(internalJobIds.map((jobInternalId) => ({
    documentId: documentInternalId,
    jobId: jobInternalId,
  })));
}

async function listCompanyDocumentsDetailed(companyId, options: any = {}) {
  const db = options.db || getDb(options.env);
  const company = await resolveCompanyByPublicId(db, companyId);
  if (!company) {
    return { items: [], nextCursor: null };
  }
  const rawLimit = Number(options.limit || options.pageSize);
  const effectiveLimit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 10000)
    : 50;
  const afterCursor = options.afterCursor ? decodeDocumentsCursor(String(options.afterCursor)) : null;
  const requestedStatuses = normalizeStringList(options.status);
  const requestedDocumentType = Number(options.documentType);
  const requestedCreatedByUid = coerceTrimmedString(options.createdByUid);
  const requestedDateFrom = options.dateFrom ? asDate(options.dateFrom, null) : null;
  const requestedDateTo = options.dateTo ? asDate(options.dateTo, null) : null;
  const dateColumn = resolveDocumentDateColumnSql(options.dateField);
  const dateColumnName = resolveDocumentDateColumnName(options.dateField);
  const cursorFilter = afterCursor
    ? sql` AND (${sql.raw(dateColumnName)}, d.id) < (${afterCursor.dateValue}, ${afterCursor.id})`
    : sql``;

  // Optional filter by a specific document code (used by getDocumentRecordById for targeted lookups).
  const documentCodeFilter = options.documentCode
    ? sql` AND d.document_code = ${String(options.documentCode)}`
    : sql``;
  const documentTypeFilter = Number.isInteger(requestedDocumentType)
    ? sql` AND d.document_type = ${requestedDocumentType}`
    : sql``;
  const createdByUidFilter = requestedCreatedByUid
    ? sql` AND cm.user_id = ${requestedCreatedByUid}`
    : sql``;
  const dateFromFilter = requestedDateFrom
    ? sql` AND ${dateColumn} >= ${requestedDateFrom}`
    : sql``;
  const dateToFilter = requestedDateTo
    ? sql` AND ${dateColumn} <= ${requestedDateTo}`
    : sql``;
  const statusFilter = requestedStatuses.length > 0
    ? sql` AND d.generation_status IN (${sql.join(requestedStatuses.map((status) => sql`${status}`), sql`, `)})`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      d.id,
      d.document_type,
      d.document_number,
      d.document_code,
      d.generation_status,
      d.updated_at,
      d.client_name_snapshot,
      d.client_phone_snapshot,
      d.client_city_snapshot,
      d.client_vat_snapshot,
      d.storage_path,
      d.notes,
      d.confirmation_number,
      d.payload,
      d.total_before_vat,
      d.vat_amount,
      d.total_with_vat,
      d.language,
      d.document_date,
      d.tax_authority_response,
      d.created_at,
      cm.user_id AS created_by_uid,
      COALESCE(cm.display_name, au.display_name, au.email, '') AS created_by_name,
      src.document_code AS source_price_proposal_code,
      used_by.document_code AS used_by_document_code
    FROM documents d
    LEFT JOIN company_memberships cm ON cm.id = d.created_by_membership_id
    LEFT JOIN app_users au ON au.id = cm.user_id
    LEFT JOIN documents src ON src.id = d.source_price_proposal_id
    LEFT JOIN proposal_usage pu ON pu.proposal_document_id = d.id
    LEFT JOIN documents used_by ON used_by.id = pu.consumer_document_id
    WHERE d.company_id = ${company.id}
      AND NOT (d.document_type = 305 AND d.tax_authority_status <> 'approved')
      ${documentCodeFilter}
      ${documentTypeFilter}
      ${createdByUidFilter}
      ${dateFromFilter}
      ${dateToFilter}
      ${statusFilter}
      ${cursorFilter}
    ORDER BY ${dateColumn} DESC, d.id DESC
    LIMIT ${sql.raw(String(effectiveLimit + 1))}
  `);

  const allRows = rows.rows || [];
  const hasMore = allRows.length > effectiveLimit;
  const documentRows = hasMore ? allRows.slice(0, effectiveLimit) : allRows;
  if (documentRows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const documentIds = documentRows.map((row) => row.id);
  const [itemRows, jobLinkRows] = await Promise.all([
    db.execute(sql`
      SELECT document_id, line_no, description, quantity, unit_price, metadata
      FROM document_items
      WHERE document_id = ANY(${documentIds})
      ORDER BY line_no ASC
    `).then((result) => result.rows || []),
    db.execute(sql`
      SELECT l.document_id, j.job_no
      FROM document_job_links l
      INNER JOIN jobs j ON j.id = l.job_id
      WHERE l.document_id = ANY(${documentIds})
      ORDER BY j.job_no ASC
    `).then((result) => result.rows || []),
  ]);

  const itemsByDocumentId = new Map();
  for (const row of itemRows) {
    const key = String(row.document_id);
    if (!itemsByDocumentId.has(key)) itemsByDocumentId.set(key, []);
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    itemsByDocumentId.get(key).push({
      description: row.description,
      quantity: Number(row.quantity || 0),
      price: Number(row.unit_price || 0),
      partId: numericOrNull(metadata.partId),
    });
  }

  const jobsByDocumentId = new Map();
  for (const row of jobLinkRows) {
    const key = String(row.document_id);
    if (!jobsByDocumentId.has(key)) jobsByDocumentId.set(key, []);
    jobsByDocumentId.get(key).push({ jobId: String(row.job_no) });
  }

  const mappedRows = documentRows.map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const payloadClient = payload.client && typeof payload.client === 'object' ? payload.client : {};
    const items = itemsByDocumentId.get(String(row.id)) || [];
    const jobsData = jobsByDocumentId.get(String(row.id)) || payload.jobsData || [];
    const confirmationNumber = row.confirmation_number || payload.taxAuthorityConfirmationNumber || undefined;
    return {
      id: row.document_code || String(row.document_number),
      type: Number(row.document_type),
      documentType: Number(row.document_type),
      documentNumber: row.document_number,
      documentId: row.document_code || String(row.document_number),
      cname: row.client_name_snapshot || payloadClient.name || undefined,
      cphone: row.client_phone_snapshot || payloadClient.phone || undefined,
      clientCity: row.client_city_snapshot || payloadClient.city || undefined,
      clientVatNumber: row.client_vat_snapshot || payloadClient.clientVatNumber || payloadClient.vatNumber || undefined,
      cid: coerceOptionalString(payloadClient.clientId || payloadClient.id),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
      storagePath: row.storage_path || undefined,
      notes: row.notes || payload.notes || undefined,
      confirmationNumber,
      taxAuthorityConfirmationNumber: confirmationNumber,
      items,
      totalBeforeVat: roundCurrency(row.total_before_vat),
      vatAmount: roundCurrency(row.vat_amount),
      totalWithVat: roundCurrency(row.total_with_vat),
      documentData: payload,
      paymentMethod: payload.paymentMethod || undefined,
      paymentInfo: payload.paymentInfo || undefined,
      createdByUid: row.created_by_uid || undefined,
      createdByName: row.created_by_name || undefined,
      language: row.language || payload.language || undefined,
      date: row.document_date ? (row.document_date instanceof Date ? row.document_date.toISOString().slice(0, 10) : String(row.document_date)) : (payload.date || undefined),
      jobsData,
      priceProposalId: row.source_price_proposal_code || payload.priceProposalId || undefined,
      status: row.generation_status || undefined,
      taxAuthorityResponseData: row.tax_authority_response || null,
      isUsed: Boolean(row.used_by_document_code),
      usedByDocumentId: row.used_by_document_code || undefined,
      invoiceReference: payload.invoiceReference || undefined,
    };
  });

  const lastRow = documentRows[documentRows.length - 1];
  // Choose the cursor date value from the selected column that matches the sort key.
  const cursorDateValue: Date | string = (() => {
    switch (String(options.dateField || '').trim()) {
      case 'documentDate': return lastRow.document_date ?? lastRow.created_at;
      case 'updatedAt': return lastRow.updated_at ?? lastRow.created_at;
      default: return lastRow.created_at;
    }
  })();
  const nextCursor = hasMore
    ? encodeDocumentsCursor(cursorDateValue, String(lastRow.id))
    : null;

  return { items: mappedRows, nextCursor };
}

async function getDocumentRecordById(companyId, documentId, options: any = {}) {
  const documentCode = String(documentId || '').trim();
  if (!documentCode) return null;
  // Use the documentCode filter so the query fetches exactly 1 row instead of up to 10 000.
  const results = await listCompanyDocumentsDetailed(companyId, {
    ...options,
    documentCode,
    limit: 1,
  });
  return results.items[0] || null;
}

async function createOrUpdateDocumentRecord(input, options: any = {}) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const documentCode = coerceTrimmedString(input.documentId || input.record?.documentId);
    if (!documentCode) {
      const error = new Error('Document ID is required');
      (error as any).code = 'invalid-argument';
      throw error;
    }

    const existingRows = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(
        eq(documents.companyId, company.id),
        eq(documents.documentCode, documentCode),
      ))
      .limit(1);
    const existing = existingRows[0] || null;
    if (input.createOnly && existing) {
      const error = new Error('Document already exists');
      (error as any).code = 'already-exists';
      throw error;
    }

    const record = input.record || {};
    const sourcePriceProposalId = input.sourcePriceProposalId || record.priceProposalId || record.documentData?.priceProposalId;
    // Run three independent lookups in parallel.
    const [createdByMembership, clientInternalId, sourcePriceProposalInternalId] = await Promise.all([
      input.createdByUserId ? findActiveMembership(tx, input.createdByUserId, company.id) : Promise.resolve(null),
      resolveClientInternalId(tx, company.id, record),
      resolveSourcePriceProposalInternalId(tx, company.id, sourcePriceProposalId),
    ]);
    const rowValues = buildDocumentRowValues(input, company.id, createdByMembership?.id || null, clientInternalId, sourcePriceProposalInternalId, now);

    let documentInternalId = existing?.id || null;
    if (documentInternalId) {
      await tx.update(documents).set(rowValues).where(eq(documents.id, documentInternalId));
    } else {
      const inserted = await tx.insert(documents).values({
        ...rowValues,
        createdAt: asDate(record.createdAt, now),
      }).returning({ id: documents.id });
      documentInternalId = inserted[0].id;
    }

    const normalizedItems = normalizeDocumentItems(record);
    await replaceDocumentItems(tx, documentInternalId, normalizedItems);

    const linkedJobIds = normalizeLinkedJobIds(input);
    const internalJobIds = await fetchInternalJobIds(tx, company.id, linkedJobIds);
    await replaceDocumentJobLinks(tx, documentInternalId, internalJobIds);

    if (input.markLinkedJobsCertified === true && internalJobIds.length > 0) {
      await tx.update(jobs).set({
        isCert: true,
        updatedAt: now,
      }).where(inArray(jobs.id, internalJobIds));
    }

    if (input.markSourcePriceProposalUsed === true && sourcePriceProposalInternalId) {
      await tx.insert(proposalUsage).values({
        proposalDocumentId: sourcePriceProposalInternalId,
        consumerDocumentId: documentInternalId,
        usedByUserId: input.createdByUserId || null,
        usedAt: now,
      }).onConflictDoUpdate({
        target: proposalUsage.proposalDocumentId,
        set: {
          consumerDocumentId: documentInternalId,
          usedByUserId: input.createdByUserId || null,
          usedAt: now,
        },
      });
    }

    return {
      documentId: documentCode,
      internalDocumentId: documentInternalId,
      storagePath: rowValues.storagePath || null,
    };
  });
}

async function deleteDocumentRecord(input, options: any = {}) {
  const db = options.db || getDb(options.env);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const documentRecord = await getDocumentRecordById(input.companyId, input.documentId, { db: tx });
    if (!documentRecord) {
      const error = new Error('Document not found');
      (error as any).code = 'not-found';
      throw error;
    }

    if (Number(documentRecord.documentType) === 305 && documentRecord.taxAuthorityResponseData) {
      const error = new Error('Cannot delete a Tax Authority approved invoice');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    await tx.delete(documents).where(and(
      eq(documents.companyId, company.id),
      eq(documents.documentCode, coerceTrimmedString(input.documentId)),
    ));

    return {
      documentId: coerceTrimmedString(input.documentId),
      storagePath: documentRecord.storagePath || null,
    };
  });
}

export { createOrUpdateDocumentRecord, deleteDocumentRecord, encodeDocumentsCursor, getDocumentRecordById, listCompanyDocumentsDetailed };

