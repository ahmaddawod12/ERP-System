import { sql } from 'drizzle-orm';
import { DOC_TYPE } from '@smart-job/contracts';
import { getDb, type DatabaseOptions } from './client';
import { createOrUpdateDocumentRecord } from './documents';
import { resolveCompanyByPublicId } from './membership';

type ReservationStatus =
  | 'reserved'
  | 'approved'
  | 'generated'
  | 'failed'
  | 'burned'
  | 'rejected'
  | 'validation_failed'
  | 'submission_failed'
  | 'approval_received_needs_reconcile';

type IdempotencyStatus = 'approved' | 'in_progress' | 'failed';

type ReserveTaxInvoiceInput = {
  companyId: string | number;
  uid: string;
  idempotencyHash: string;
  requestHash?: string | null;
  clientName?: string | null;
  record?: Record<string, unknown>;
  now?: string | Date;
  expireAt?: string | Date;
  staleAfterMs?: number;
};

type UpdateReservationInput = {
  reservationId: string;
  status: string;
  confirmationNumber?: string | null;
  payload?: Record<string, unknown>;
  now?: string | Date;
};

type UpdateTaxIdempotencyInput = {
  companyId: string | number;
  idempotencyHash: string;
  status: string;
  resultPayload?: unknown;
  now?: string | Date;
};

function asDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function normalizeReservationStatus(value: unknown): ReservationStatus {
  const normalized = String(value || '').trim();
  const allowed = new Set([
    'reserved',
    'approved',
    'generated',
    'failed',
    'burned',
    'rejected',
    'validation_failed',
    'submission_failed',
    'approval_received_needs_reconcile',
  ]);
  return allowed.has(normalized) ? normalized as ReservationStatus : 'failed';
}

function normalizeIdempotencyStatus(value: unknown): IdempotencyStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'in_progress') return 'in_progress';
  return 'failed';
}

async function reserveTaxInvoiceSubmission(
  input: ReserveTaxInvoiceInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const expireAt = asDate(input.expireAt, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const staleAfterMs = Math.max(1_000, Number(input.staleAfterMs || 5 * 60 * 1000) || 5 * 60 * 1000);

  return db.transaction(async (tx) => {
    const company = await resolveCompanyByPublicId(tx, input.companyId);
    if (!company) {
      const error = new Error('Company not found');
      (error as any).code = 'not-found';
      throw error;
    }

    const existingResult = await tx.execute(sql`
      SELECT id, status, result_payload, locked_at
      FROM tax_invoice_idempotency
      WHERE company_id = ${company.id}
        AND idempotency_hash = ${String(input.idempotencyHash || '').trim()}
      LIMIT 1
      FOR UPDATE
    `);
    const existing = existingResult.rows?.[0] as Record<string, unknown> | undefined;

    if (existing) {
      if (existing.status === 'approved' && existing.result_payload) {
        return { duplicate: true, result: existing.result_payload };
      }
      const lockedAtMs = existing.locked_at ? new Date(String(existing.locked_at)).getTime() : 0;
      if (existing.status === 'in_progress' && lockedAtMs && Date.now() - lockedAtMs < staleAfterMs) {
        const error = new Error('Invoice submission with this idempotency key is already in progress');
        (error as any).code = 'already-exists';
        throw error;
      }
    }

    const counterResult = await tx.execute(sql`
      UPDATE company_counters
      SET next_value = next_value + 1,
          updated_at = NOW()
      WHERE company_id = ${company.id}
        AND counter_key = 'doc_305'
      RETURNING next_value - 1 AS allocated_value
    `);
    const row = counterResult.rows?.[0] as Record<string, unknown> | undefined;
    const documentNumber = Number(row?.allocated_value);
    if (!Number.isInteger(documentNumber) || documentNumber < 1) {
      const error = new Error('Failed to allocate tax invoice number');
      (error as any).code = 'failed-precondition';
      throw error;
    }

    const documentId = `TI${documentNumber}-${input.companyId}`;
    const storedDocument = await createOrUpdateDocumentRecord({
      companyId: input.companyId,
      documentId,
      documentType: DOC_TYPE.TAX_INVOICE,
      documentNumber,
      createdByUserId: input.uid,
      generationStatus: 'pending',
      createOnly: true,
      record: {
        ...(input.record || {}),
        documentId,
        documentNumber,
        createdAt: now.toISOString(),
      },
    }, { db: tx });

    const reservationInsert = await tx.execute(sql`
      INSERT INTO tax_invoice_reservations (
        company_id,
        document_id,
        document_number,
        status,
        reserved_by_user_id,
        client_name_snapshot,
        status_payload,
        created_at,
        updated_at
      ) VALUES (
        ${company.id},
        ${storedDocument.internalDocumentId},
        ${documentNumber},
        'reserved',
        ${String(input.uid || '').trim()},
        ${String(input.clientName || '').trim() || null},
        ${JSON.stringify({ publicDocumentId: documentId })}::jsonb,
        ${now},
        ${now}
      )
      RETURNING id
    `);
    const reservationRow = reservationInsert.rows?.[0] as Record<string, unknown> | undefined;
    const reservationId = reservationRow?.id ? String(reservationRow.id) : null;

    if (existing) {
      await tx.execute(sql`
        UPDATE tax_invoice_idempotency
        SET status = 'in_progress',
            reservation_id = ${reservationId},
            document_id = ${storedDocument.internalDocumentId},
            request_hash = ${String(input.requestHash || '').trim() || null},
            result_payload = NULL,
            locked_at = ${now},
            expire_at = ${expireAt},
            updated_at = ${now}
        WHERE id = ${existing.id}
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO tax_invoice_idempotency (
          company_id,
          idempotency_hash,
          user_id,
          status,
          reservation_id,
          document_id,
          request_hash,
          result_payload,
          locked_at,
          expire_at,
          created_at,
          updated_at
        ) VALUES (
          ${company.id},
          ${String(input.idempotencyHash || '').trim()},
          ${String(input.uid || '').trim()},
          'in_progress',
          ${reservationId},
          ${storedDocument.internalDocumentId},
          ${String(input.requestHash || '').trim() || null},
          NULL,
          ${now},
          ${expireAt},
          ${now},
          ${now}
        )
      `);
    }

    return {
      duplicate: false,
      documentId,
      documentNumber,
      internalDocumentId: storedDocument.internalDocumentId,
      reservationId,
    };
  });
}

async function updateTaxInvoiceReservation(
  input: UpdateReservationInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};

  await db.execute(sql`
    UPDATE tax_invoice_reservations
    SET status = ${normalizeReservationStatus(input.status)},
        external_confirmation_number = ${input.confirmationNumber || null},
        status_payload = COALESCE(status_payload, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb,
        updated_at = ${now}
    WHERE id = ${input.reservationId}
  `);
}

async function updateTaxInvoiceIdempotency(
  input: UpdateTaxIdempotencyInput,
  options: DatabaseOptions = {},
) {
  const db = options.db || getDb(options.env);
  const now = asDate(input.now, new Date());
  const status = normalizeIdempotencyStatus(input.status);
  const companyId = Number(input.companyId);
  if (!Number.isInteger(companyId) || companyId < 1) {
    const error = new Error('Company ID is required');
    (error as any).code = 'invalid-argument';
    throw error;
  }
  const payload = Object.prototype.hasOwnProperty.call(input, 'resultPayload')
    ? input.resultPayload
    : undefined;

  const resultPayloadSql = payload === undefined
    ? sql`result_payload`
    : sql`${JSON.stringify(payload)}::jsonb`;

  await db.execute(sql`
    UPDATE tax_invoice_idempotency
    SET status = ${status},
        result_payload = ${resultPayloadSql},
        updated_at = ${now},
        locked_at = CASE WHEN ${status} = 'in_progress' THEN ${now} ELSE locked_at END
    WHERE company_id = (
      SELECT id FROM companies WHERE public_company_id = ${companyId} LIMIT 1
    )
      AND idempotency_hash = ${String(input.idempotencyHash || '').trim()}
  `);
}

export { reserveTaxInvoiceSubmission, updateTaxInvoiceIdempotency, updateTaxInvoiceReservation };

