import {
  ContactRequestCreatedResultSchema,
  type ContactRequestCreateRequest,
  type ContactRequestCreatedResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";

const createdRowSchema = z.object({
  request_id: z.uuid(),
  created_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface CreatedRow extends QueryResultRow {
  readonly request_id: string;
  readonly created_at: Date | string;
}

export async function createContactRequest(
  transaction: DatabaseQueryable,
  request: ContactRequestCreateRequest,
): Promise<ContactRequestCreatedResult> {
  const result = await transaction.query<CreatedRow>(
    `SELECT request_id, created_at
     FROM private.create_api_contact_request(
       $1::text,
       $2::text,
       $3::text,
       $4::text,
       $5::text
     )`,
    [request.name, request.email, request.company, request.subject ?? null, request.message],
  );
  const row = createdRowSchema.parse(result.rows[0]);
  return ContactRequestCreatedResultSchema.parse({
    requestId: row.request_id,
    status: "received",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}
