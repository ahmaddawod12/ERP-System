import { createHash, randomUUID } from "node:crypto";
import {
  TaxInvoiceAcceptedSchema,
  type TaxInvoiceAccepted,
  type TaxInvoiceCreateRequest,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";
import type { TaxGatewayApprovalResult } from "./gateway-client.js";

const createdRowSchema = z.object({
  document_id: z.uuid(),
  document_code: z.string().trim().min(1).max(64),
  document_number: z.coerce.number().int().positive(),
  tax_authority_status: z.literal("reserved"),
  tax_submission_status: z.literal("queued"),
  correlation_id: z.string().trim().min(8).max(128),
  entity_version: z.union([z.string(), z.number().int().positive(), z.bigint().positive()]),
}).strict();

const claimRowSchema = z.object({
  submission_id: z.uuid(),
  internal_company_id: z.uuid(),
  internal_document_id: z.uuid(),
  correlation_id: z.string().trim().min(8).max(128),
  request_payload: z.object({
    invoice: z.record(z.string(), z.unknown()),
  }).passthrough(),
  submission_attempt: z.coerce.number().int().positive(),
}).strict();

interface TaxClaimRow extends QueryResultRow {
  submission_id: string;
  internal_company_id: string;
  internal_document_id: string;
  correlation_id: string;
  request_payload: unknown;
  submission_attempt: number | string;
}

export type ClaimedTaxSubmission = {
  readonly submissionId: string;
  readonly leaseToken: string;
  readonly companyId: string;
  readonly documentId: string;
  readonly correlationId: string;
  readonly invoice: Readonly<Record<string, unknown>>;
  readonly attempt: number;
};

export async function createTaxInvoice(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: TaxInvoiceCreateRequest;
    readonly createdAt: Date;
  },
): Promise<TaxInvoiceAccepted> {
  const result = await transaction.query(
    `SELECT * FROM private.create_api_tax_invoice($1::uuid, $2::jsonb, $3::timestamptz)`,
    [input.internalCompanyId, input.request, input.createdAt],
  );
  const row = createdRowSchema.parse(result.rows[0]);
  // Validate the opaque version even though the accepted response does not
  // expose it yet; malformed database output must fail the transaction.
  encodeEntityVersion(row.entity_version);
  return TaxInvoiceAcceptedSchema.parse({
    documentId: row.document_id,
    documentCode: row.document_code,
    documentNumber: row.document_number,
    taxAuthorityStatus: row.tax_authority_status,
    submissionStatus: row.tax_submission_status,
  });
}

export async function claimTaxSubmissions(
  transaction: DatabaseQueryable,
  input: { readonly limit: number; readonly leaseSeconds: number; readonly submissionId?: string },
): Promise<ClaimedTaxSubmission[]> {
  const leaseToken = randomUUID();
  const result = await transaction.query<TaxClaimRow>(
    `SELECT * FROM private.claim_api_tax_submission_batch(
      $1::uuid, $2::integer, $3::integer, $4::uuid
    )`,
    [leaseToken, input.limit, input.leaseSeconds, input.submissionId ?? null],
  );
  return result.rows.map((unknownRow) => {
    const row = claimRowSchema.parse(unknownRow);
    return {
      submissionId: row.submission_id,
      leaseToken,
      companyId: row.internal_company_id,
      documentId: row.internal_document_id,
      correlationId: row.correlation_id,
      invoice: row.request_payload.invoice,
      attempt: row.submission_attempt,
    };
  });
}

export async function retryTaxSubmission(
  transaction: DatabaseQueryable,
  submission: ClaimedTaxSubmission,
  error: unknown,
): Promise<void> {
  const result = await transaction.query<{ retried: boolean }>(
    `SELECT private.retry_api_tax_submission($1::uuid, $2::uuid, $3::text, $4::integer) AS retried`,
    [submission.submissionId, submission.leaseToken, safeError(error), 30],
  );
  if (result.rows[0]?.retried !== true) throw new Error("Tax submission retry lease was rejected");
}

export async function markTaxSubmissionUnknown(
  transaction: DatabaseQueryable,
  submission: ClaimedTaxSubmission,
  error: unknown,
): Promise<void> {
  const result = await transaction.query<{ marked: boolean }>(
    `SELECT private.mark_api_tax_submission_unknown($1::uuid, $2::uuid, $3::text) AS marked`,
    [submission.submissionId, submission.leaseToken, safeError(error)],
  );
  if (result.rows[0]?.marked !== true) throw new Error("Tax submission unknown-state lease was rejected");
}

export async function processTaxSubmissionResult(
  transaction: DatabaseQueryable,
  submission: ClaimedTaxSubmission,
  result: TaxGatewayApprovalResult,
): Promise<{ readonly idempotentReplay: boolean }> {
  const canonicalResult = {
    status: result.status,
    confirmationNumber: result.confirmationNumber ?? null,
    authorityRequestId: result.authorityRequestId ?? null,
  };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(canonicalResult))
    .digest("hex");
  const processed = await transaction.query<{ processed: boolean; idempotent_replay: boolean }>(
    `SELECT processed, idempotent_replay
     FROM private.process_api_tax_submission_result(
       $1::varchar(128), $2::varchar(128), $3::varchar(64),
       $4::varchar(32), $5::varchar(128), $6::varchar(256),
       $7::varchar(128), $8::text, $9::timestamptz
     )`,
    [
      submission.correlationId,
      `immediate:${submission.submissionId}`,
      payloadHash,
      result.status,
      result.confirmationNumber ?? null,
      result.authorityRequestId ?? null,
      null,
      null,
      new Date(),
    ],
  );
  if (processed.rows[0]?.processed !== true) throw new Error("Tax result was not processed");
  return { idempotentReplay: processed.rows[0].idempotent_replay };
}

function safeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 2_000);
  return "Tax submission failed";
}
