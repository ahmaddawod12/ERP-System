import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import { z } from "zod";

import type { EmailWorkerConfig } from "./config.js";

const canonicalDeliverySchema = z.object({
  delivery_id: z.uuid(),
  internal_company_id: z.uuid(),
  public_company_id: z.coerce.number().int().positive(),
  internal_document_id: z.uuid(),
  document_code: z.string().trim().min(1).max(64),
  document_number: z.coerce.number().int().positive(),
  document_type: z.coerce.number().int().positive(),
  language: z.string().trim().min(2).max(8),
  recipient_email: z.string().trim().email().max(320),
  recipient_name: z.string().trim().max(200).nullable(),
  business_name: z.string().trim().min(1).max(200),
  storage_path: z.string().trim().min(1).max(1024),
  send_attempt: z.coerce.number().int().positive(),
}).strict();

interface CanonicalDeliveryRow extends QueryResultRow {
  delivery_id: string;
  internal_company_id: string;
  public_company_id: string | number;
  internal_document_id: string;
  document_code: string;
  document_number: string | number;
  document_type: string | number;
  language: string;
  recipient_email: string;
  recipient_name: string | null;
  business_name: string;
  storage_path: string;
  send_attempt: string | number;
}

export type CanonicalEmailDelivery = {
  readonly leaseToken: string;
  readonly deliveryId: string;
  readonly companyId: string;
  readonly publicCompanyId: number;
  readonly documentId: string;
  readonly documentCode: string;
  readonly documentNumber: number;
  readonly documentType: number;
  readonly language: string;
  readonly recipientEmail: string;
  readonly recipientName: string | null;
  readonly businessName: string;
  readonly storagePath: string;
  readonly attempt: number;
};

export class EmailDeliveryStore {
  readonly #pool: Pool;

  constructor(config: EmailWorkerConfig["database"]) {
    this.#pool = new Pool(config);
  }

  async claim(deliveryId: string, leaseSeconds: number): Promise<CanonicalEmailDelivery | null> {
    const leaseToken = randomUUID();
    const result = await this.#pool.query<CanonicalDeliveryRow>(
      "SELECT * FROM private.claim_email_delivery($1::uuid, $2::uuid, $3::integer)",
      [deliveryId, leaseToken, leaseSeconds],
    );
    if (result.rows.length === 0) return null;
    const row = canonicalDeliverySchema.parse(result.rows[0]);
    const expectedPrefix = `${row.internal_company_id}/documents/`;
    if (!row.storage_path.startsWith(expectedPrefix)) {
      throw new TypeError("Canonical document storage path is outside the tenant prefix");
    }
    return {
      leaseToken,
      deliveryId: row.delivery_id,
      companyId: row.internal_company_id,
      publicCompanyId: row.public_company_id,
      documentId: row.internal_document_id,
      documentCode: row.document_code,
      documentNumber: row.document_number,
      documentType: row.document_type,
      language: row.language,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      businessName: row.business_name,
      storagePath: row.storage_path,
      attempt: row.send_attempt,
    };
  }

  async complete(delivery: CanonicalEmailDelivery, providerMessageId: string): Promise<void> {
    const result = await this.#pool.query<{ completed: boolean }>(
      `SELECT private.complete_email_delivery(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, clock_timestamp()
      ) AS completed`,
      [delivery.deliveryId, delivery.leaseToken, delivery.companyId, delivery.documentId, providerMessageId],
    );
    if (result.rows[0]?.completed !== true) {
      throw new Error("Email completion lease was rejected");
    }
  }

  async resolveFailure(
    delivery: CanonicalEmailDelivery,
    outcome: "queued" | "failed" | "delivery_unknown",
    error: string,
    retryAfterSeconds = 30,
  ): Promise<void> {
    const result = await this.#pool.query<{ resolved: boolean }>(
      `SELECT private.resolve_email_delivery_failure(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::integer
      ) AS resolved`,
      [
        delivery.deliveryId,
        delivery.leaseToken,
        delivery.companyId,
        delivery.documentId,
        outcome,
        error.slice(0, 2_000),
        retryAfterSeconds,
      ],
    );
    if (result.rows[0]?.resolved !== true) {
      throw new Error("Email failure lease was rejected");
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
