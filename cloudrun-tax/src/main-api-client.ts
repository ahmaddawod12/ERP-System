import { z } from "zod";

import type { MainApiConfig } from "./config.js";
import {
  BindTaxApprovalSessionResultSchema,
  ForwardTaxCallbackResultSchema,
  type BindTaxApprovalSessionRequest,
  type BindTaxApprovalSessionResult,
  type ForwardTaxCallbackRequest,
  type ForwardTaxCallbackResult,
} from "./contracts.js";
import { TaxGatewayError } from "./errors.js";
import {
  fetchWithTimeout,
  readBoundedJson,
  readBoundedText,
  type FetchImplementation,
} from "./http-client.js";

const callbackSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: ForwardTaxCallbackResultSchema,
  meta: z.object({ requestId: z.string().trim().min(1).max(128) }).loose(),
}).strict();

const METADATA_IDENTITY_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const TOKEN_CACHE_LIFETIME_MS = 4 * 60 * 1_000;

export interface IdentityTokenProvider {
  getIdentityToken(audience: string): Promise<string>;
}

export interface MainApiCallbackClient {
  bindApprovalSession(request: BindTaxApprovalSessionRequest): Promise<BindTaxApprovalSessionResult>;
  forwardCallback(request: ForwardTaxCallbackRequest): Promise<ForwardTaxCallbackResult>;
}

export class MetadataIdentityTokenProvider implements IdentityTokenProvider {
  private cachedToken: { readonly audience: string; readonly token: string; readonly expiresAt: number } | undefined;
  private inFlight: Promise<string> | undefined;

  constructor(
    private readonly timeoutMs: number,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getIdentityToken(audience: string): Promise<string> {
    if (
      this.cachedToken !== undefined
      && this.cachedToken.audience === audience
      && this.cachedToken.expiresAt > this.now()
    ) {
      return this.cachedToken.token;
    }
    if (this.inFlight !== undefined) return this.inFlight;

    this.inFlight = this.loadToken(audience);
    try {
      const token = await this.inFlight;
      this.cachedToken = {
        audience,
        token,
        expiresAt: this.now() + TOKEN_CACHE_LIFETIME_MS,
      };
      return token;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async loadToken(audience: string): Promise<string> {
    const url = new URL(METADATA_IDENTITY_URL);
    url.searchParams.set("audience", audience);
    url.searchParams.set("format", "full");
    const response = await fetchWithTimeout(
      this.fetchImplementation,
      url,
      {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
      },
      Math.min(this.timeoutMs, 2_000),
      "MAIN_API_IDENTITY_TIMEOUT",
    );
    if (!response.ok) {
      throw new TaxGatewayError(
        502,
        "MAIN_API_IDENTITY_UNAVAILABLE",
        "The protected main-API identity could not be obtained.",
        true,
      );
    }

    const token = (await readBoundedText(response, 16_384)).trim();
    if (!/^[A-Za-z0-9._~-]{32,16384}$/.test(token)) {
      throw new TaxGatewayError(
        502,
        "MAIN_API_IDENTITY_INVALID",
        "The protected main-API identity response was invalid.",
        true,
      );
    }
    return token;
  }
}

function mainApiFailure(response: Response): TaxGatewayError {
  if (response.status === 409) {
    return new TaxGatewayError(
      409,
      "CALLBACK_IDEMPOTENCY_CONFLICT",
      "The callback event ID was already used for different content.",
      false,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new TaxGatewayError(
      502,
      "MAIN_API_AUTHENTICATION_FAILED",
      "The protected main API rejected the regional service identity.",
      false,
    );
  }
  const retryable = response.status === 408
    || response.status === 425
    || response.status === 429
    || response.status >= 500;
  return new TaxGatewayError(
    retryable ? 503 : 422,
    retryable ? "MAIN_API_UNAVAILABLE" : "MAIN_API_CALLBACK_REJECTED",
    retryable
      ? "The protected main API is temporarily unavailable."
      : "The protected main API rejected the callback.",
    retryable,
  );
}

export class HttpMainApiCallbackClient implements MainApiCallbackClient {
  constructor(
    private readonly config: MainApiConfig,
    private readonly identityTokenProvider: IdentityTokenProvider,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch,
  ) {}

  async bindApprovalSession(
    request: BindTaxApprovalSessionRequest,
  ): Promise<BindTaxApprovalSessionResult> {
    const identityToken = await this.identityTokenProvider.getIdentityToken(this.config.audience);
    const response = await fetchWithTimeout(
      this.fetchImplementation,
      this.config.approvalSessionUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${identityToken}`,
          "content-type": "application/json",
          "x-request-id": request.requestId,
        },
        body: JSON.stringify({
          documentId: request.documentId,
          oauthSessionId: request.oauthSessionId,
        }),
      },
      this.timeoutMs,
      "MAIN_API_APPROVAL_SESSION_TIMEOUT",
    );
    if (!response.ok) throw mainApiFailure(response);

    const raw = await readBoundedJson(response, 65_536);
    const parsed = z.object({
      ok: z.literal(true),
      data: BindTaxApprovalSessionResultSchema,
      meta: z.object({ requestId: z.string().trim().min(1).max(128) }).loose(),
    }).strict().safeParse(raw);
    if (!parsed.success) {
      throw new TaxGatewayError(
        502,
        "INVALID_MAIN_API_RESPONSE",
        "The protected main API returned an invalid response.",
        true,
      );
    }
    return parsed.data.data;
  }

  async forwardCallback(request: ForwardTaxCallbackRequest): Promise<ForwardTaxCallbackResult> {
    const identityToken = await this.identityTokenProvider.getIdentityToken(this.config.audience);
    const response = await fetchWithTimeout(
      this.fetchImplementation,
      this.config.callbackUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${identityToken}`,
          "content-type": "application/json",
          "idempotency-key": `tax-callback:${request.eventId}`,
          "x-request-id": request.requestId,
          "x-sj-tax-payload-sha256": request.payloadHash,
        },
        body: JSON.stringify({
          eventId: request.eventId,
          payloadHash: request.payloadHash,
          callback: request.callback,
        }),
      },
      this.timeoutMs,
      "MAIN_API_CALLBACK_TIMEOUT",
    );
    if (!response.ok) throw mainApiFailure(response);

    const raw = await readBoundedJson(response, 65_536);
    const parsed = callbackSuccessEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TaxGatewayError(
        502,
        "INVALID_MAIN_API_RESPONSE",
        "The protected main API returned an invalid response.",
        true,
      );
    }
    return parsed.data.data;
  }
}
