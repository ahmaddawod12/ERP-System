import { z } from "zod";

import type { TaxAuthorityConfig } from "./config.js";
import {
  OAuthTokenResultSchema,
  TaxApprovalResultSchema,
  type OAuthTokenExchangeRequest,
  type OAuthTokenResult,
  type TaxApprovalRequest,
  type TaxApprovalResult,
} from "./contracts.js";
import { TaxGatewayError } from "./errors.js";
import {
  fetchWithTimeout,
  readBoundedJson,
  type FetchImplementation,
} from "./http-client.js";

const oauthAuthorityResponseSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  token_type: z.string().trim().min(1).max(64),
  expires_in: z.union([z.number(), z.string()]),
  refresh_token: z.string().min(1).max(16_384).optional(),
  scope: z.string().trim().min(1).max(2_000).optional(),
}).loose();

const MAXIMUM_AUTHORITY_RESPONSE_BYTES = 262_144;

export interface TaxAuthorityClient {
  exchangeToken(request: OAuthTokenExchangeRequest): Promise<OAuthTokenResult>;
  requestApproval(request: TaxApprovalRequest): Promise<TaxApprovalResult>;
}

function authorityFailure(response: Response, operation: "oauth" | "approval"): TaxGatewayError {
  const retryable = response.status === 408
    || response.status === 425
    || response.status === 429
    || response.status >= 500;
  const statusCode = retryable ? 503 : operation === "oauth" ? 401 : 422;
  const code = retryable
    ? "TAX_AUTHORITY_UNAVAILABLE"
    : operation === "oauth"
      ? "TAX_OAUTH_REJECTED"
      : "TAX_APPROVAL_REJECTED";
  return new TaxGatewayError(
    statusCode,
    code,
    retryable
      ? "The tax authority is temporarily unavailable."
      : `The tax authority rejected the ${operation} request.`,
    retryable,
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstValue(
  records: readonly Record<string, unknown>[],
  names: readonly string[],
): unknown {
  for (const record of records) {
    for (const name of names) {
      if (Object.hasOwn(record, name)) return record[name];
    }
  }
  return undefined;
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : undefined;
}

function normalizeApprovalResponse(payload: unknown, httpStatus: number): TaxApprovalResult {
  const root = objectValue(payload);
  if (root === null) {
    throw new TaxGatewayError(
      502,
      "INVALID_TAX_AUTHORITY_RESPONSE",
      "The tax authority returned an invalid approval response.",
      true,
    );
  }

  const message = objectValue(root.Message) ?? objectValue(root.message);
  const records = message === null ? [root] : [message, root];
  const authorityStatus = boundedString(
    firstValue(records, ["status", "Status", "approvalStatus", "Approval_Status"]),
    64,
  )?.toLowerCase();
  const confirmationNumber = boundedString(
    firstValue(records, [
      "confirmationNumber",
      "Confirmation_Number",
      "allocationNumber",
      "Allocation_Number",
    ]),
    128,
  );
  const authorityRequestId = boundedString(
    firstValue(records, ["requestId", "Request_Id", "request_id", "correlationId"]),
    256,
  );
  const applicationStatus = Number(authorityStatus);

  if (
    authorityStatus === "rejected"
    || authorityStatus === "error"
    || (Number.isFinite(applicationStatus) && applicationStatus >= 400)
  ) {
    throw new TaxGatewayError(
      422,
      "TAX_APPROVAL_REJECTED",
      "The tax authority rejected the approval request.",
      false,
    );
  }

  if (httpStatus === 202 || authorityStatus === "pending" || authorityStatus === "accepted") {
    return TaxApprovalResultSchema.parse({
      status: "pending",
      ...(authorityRequestId === undefined ? {} : { authorityRequestId }),
    });
  }

  if (confirmationNumber !== undefined) {
    return TaxApprovalResultSchema.parse({
      status: "approved",
      confirmationNumber,
      ...(authorityRequestId === undefined ? {} : { authorityRequestId }),
    });
  }

  throw new TaxGatewayError(
    502,
    "INVALID_TAX_AUTHORITY_RESPONSE",
    "The tax authority returned an invalid approval response.",
    true,
  );
}

export class HttpTaxAuthorityClient implements TaxAuthorityClient {
  constructor(
    private readonly config: TaxAuthorityConfig,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
  ) {}

  async exchangeToken(request: OAuthTokenExchangeRequest): Promise<OAuthTokenResult> {
    const form = new URLSearchParams({
      grant_type: request.grantType,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (this.config.scope !== undefined) form.set("scope", this.config.scope);

    if (request.grantType === "authorization_code") {
      form.set("code", request.code);
      form.set("redirect_uri", request.redirectUri);
      if (request.codeVerifier !== undefined) form.set("code_verifier", request.codeVerifier);
    } else if (request.grantType === "refresh_token") {
      form.set("refresh_token", request.refreshToken);
    }

    const response = await fetchWithTimeout(
      this.fetchImplementation,
      this.config.tokenUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      this.timeoutMs,
      "TAX_OAUTH_TIMEOUT",
    );
    if (!response.ok) throw authorityFailure(response, "oauth");

    const raw = await readBoundedJson(response, MAXIMUM_AUTHORITY_RESPONSE_BYTES);
    const parsed = oauthAuthorityResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TaxGatewayError(
        502,
        "INVALID_TAX_AUTHORITY_RESPONSE",
        "The tax authority returned an invalid OAuth response.",
        true,
      );
    }

    const expiresInSeconds = Number(parsed.data.expires_in);
    const normalized = {
      accessToken: parsed.data.access_token,
      tokenType: parsed.data.token_type,
      expiresInSeconds,
      ...(parsed.data.refresh_token === undefined
        ? {}
        : { refreshToken: parsed.data.refresh_token }),
      ...(parsed.data.scope === undefined ? {} : { scope: parsed.data.scope }),
    };
    const result = OAuthTokenResultSchema.safeParse(normalized);
    if (!result.success) {
      throw new TaxGatewayError(
        502,
        "INVALID_TAX_AUTHORITY_RESPONSE",
        "The tax authority returned an invalid OAuth response.",
        true,
      );
    }
    return result.data;
  }

  async requestApproval(request: TaxApprovalRequest): Promise<TaxApprovalResult> {
    const response = await fetchWithTimeout(
      this.fetchImplementation,
      this.config.approvalUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${request.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...request.invoice,
          oauthSessionId: request.oauthSessionId,
        }),
      },
      this.timeoutMs,
      "TAX_APPROVAL_TIMEOUT",
    );
    if (!response.ok) throw authorityFailure(response, "approval");

    const raw = await readBoundedJson(response, MAXIMUM_AUTHORITY_RESPONSE_BYTES);
    return normalizeApprovalResponse(raw, response.status);
  }
}
