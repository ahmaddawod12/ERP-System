import { z } from "zod";

import type { TaxSubmissionRuntimeConfig } from "../runtime-config.js";

const gatewayResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(["approved", "pending"]),
    confirmationNumber: z.string().trim().min(1).max(128).optional(),
    authorityRequestId: z.string().trim().min(1).max(256).optional(),
  }).strict(),
}).passthrough();

export type TaxGatewayApprovalResult = {
  readonly status: "approved" | "submitted";
  readonly confirmationNumber?: string;
  readonly authorityRequestId?: string;
};

export interface TaxGatewayClient {
  requestApproval(input: {
    readonly documentId: string;
    readonly correlationId: string;
    readonly invoice: Readonly<Record<string, unknown>>;
  }): Promise<TaxGatewayApprovalResult>;
}

export class TaxGatewayPreSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaxGatewayPreSendError";
  }
}

export class TaxGatewayAmbiguousError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaxGatewayAmbiguousError";
  }
}

async function boundedResponse(response: Response, maxBytes: number): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new TaxGatewayAmbiguousError("Tax gateway response exceeded its limit");
  return bytes.toString("utf8");
}

async function metadataIdentityToken(
  audience: string,
  fetchImplementation: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const endpoint = new URL(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
    );
    endpoint.searchParams.set("audience", audience);
    endpoint.searchParams.set("format", "full");
    const response = await fetchImplementation(endpoint, {
      headers: { "metadata-flavor": "Google" },
      signal: controller.signal,
    });
    const token = (await boundedResponse(response, 16 * 1024)).trim();
    if (!response.ok || token.split(".").length !== 3) {
      throw new Error(`metadata identity endpoint returned HTTP ${response.status}`);
    }
    return token;
  } catch (error) {
    throw new TaxGatewayPreSendError("Unable to acquire a tax-gateway identity token", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export function createTaxGatewayClient(
  config: NonNullable<TaxSubmissionRuntimeConfig["gateway"]>,
  options: {
    readonly fetchImplementation?: typeof fetch;
    readonly getIdentityToken?: () => Promise<string>;
  } = {},
): TaxGatewayClient {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const getIdentityToken = options.getIdentityToken
    ?? (() => metadataIdentityToken(config.audience, fetchImplementation));

  return {
    async requestApproval(input) {
      const identityToken = await getIdentityToken().catch((error: unknown) => {
        if (error instanceof TaxGatewayPreSendError) throw error;
        throw new TaxGatewayPreSendError("Unable to acquire a tax-gateway identity token", { cause: error });
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(config.url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${identityToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            oauthSessionId: input.correlationId,
            documentId: input.documentId,
            invoice: input.invoice,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new TaxGatewayAmbiguousError("Tax gateway request ended without a definitive response", { cause: error });
      } finally {
        clearTimeout(timeout);
      }

      const body = await boundedResponse(response, 256 * 1024);
      if (!response.ok) {
        // The gateway may have reached the authority before producing an error.
        // Reconciliation is safer than an automatic duplicate submission.
        throw new TaxGatewayAmbiguousError(`Tax gateway returned HTTP ${response.status}`);
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch (error) {
        throw new TaxGatewayAmbiguousError("Tax gateway returned invalid JSON", { cause: error });
      }
      const result = gatewayResponseSchema.parse(decoded).data;
      return {
        status: result.status === "pending" ? "submitted" : "approved",
        ...(result.confirmationNumber === undefined ? {} : { confirmationNumber: result.confirmationNumber }),
        ...(result.authorityRequestId === undefined ? {} : { authorityRequestId: result.authorityRequestId }),
      };
    },
  };
}
