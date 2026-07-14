import "server-only";

import {
  ContactRequestCreatedResultSchema,
  type ContactRequestCreateRequest,
} from "@smart-job/api-contracts";
import { backendRequest } from "./transport";

export async function createContactRequest(
  input: ContactRequestCreateRequest,
  idempotencyKey: string,
) {
  const result = await backendRequest(
    "/api/v1/contact-requests",
    ContactRequestCreatedResultSchema,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { data: result.data, backendRequestId: result.meta.requestId };
}
