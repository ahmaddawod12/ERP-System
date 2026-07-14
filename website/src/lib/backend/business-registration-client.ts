import "server-only";

import {
  BusinessRegistrationResultSchema,
  type BusinessRegistrationRequest,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { backendRequest } from "./transport";

const BUSINESS_REGISTRATION_PATH = "/api/v1/auth/business-registration";

export async function registerBusinessWorkspace(
  input: BusinessRegistrationRequest,
  sessionToken: WebSessionToken,
  idempotencyKey: string,
) {
  const result = await backendRequest(
    BUSINESS_REGISTRATION_PATH,
    BusinessRegistrationResultSchema,
    {
      method: "POST",
      headers: {
        Authorization: `SmartJobSession ${sessionToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return { ...result.data, requestId: result.meta.requestId };
}
