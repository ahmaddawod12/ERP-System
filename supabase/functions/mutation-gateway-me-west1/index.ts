import { 
  getEnv, 
  createEdgeFunctionContext, 
  handleOptions, 
  handleHttpError,
  buildHttpResponse, 
  buildSuccessResponse, 
  parseJsonBody, 
  requireNonEmptyString
} from "../../shared-edge-helpers.ts";
import * as taxHandlers from "../../handlers/tax.ts";

const env = getEnv();

/**
 * Mutation Gateway - Tax Authority Region (me-west1)
 * 
 * Routes tax-specific mutation operations through a single POST endpoint.
 * Limited to tax domain operations for compliance with regional requirements.
 * 
 * Contract: PHASE-0-CONTRACTS.md
 * Phase: 3 (Implementation)
 * Region: me-west1 (Middle East West - Israel)
 * 
 * Supported operations:
 * - Tax: getInvoiceApproval
 */

type TaxHandler = (payload: any, ctx: any) => Promise<any>;

// Placeholder - will be populated in Phase 2
const TAX_OPERATIONS: Record<string, TaxHandler> = {
  getInvoiceApproval: taxHandlers.getInvoiceApproval,
};

// ── Main Handler ────────────────────────────────────────────────────────────
async function handleMutationMeWest1Request(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    const ctx = await createEdgeFunctionContext(req, env);
    return handleOptions(ctx.corsHeaders);
  }

  if (req.method !== "POST") {
    const ctx = await createEdgeFunctionContext(req, env);
    return buildHttpResponse(
      405,
      {
        ok: false,
        error: {
          code: "invalid-argument",
          message: "Only POST is allowed"
        }
      },
      ctx.corsHeaders
    );
  }

  try {
    const ctx = await createEdgeFunctionContext(req, env);

    // Parse request body
    const body = await parseJsonBody(req);
    const operation = requireNonEmptyString(body?.operation || "", "operation", 1, 100);

    ctx.logger.info("Tax mutation gateway request received", {
      operation,
      uid: ctx.auth?.uid,
      region: "me-west1",
      correlationId: ctx.correlationId
    });

    // Find handler for tax operation
    const handler = TAX_OPERATIONS[operation];
    if (!handler) {
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: `Unsupported tax operation: ${operation}. This endpoint only handles tax operations.`
      };
    }

    // Require authentication
    if (!ctx.auth) {
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Authentication required"
      };
    }

    // Execute operation
    const payload = body?.payload || {};
    const result = await handler(payload, ctx);

    ctx.logger.info("Tax mutation gateway request succeeded", {
      operation,
      uid: ctx.auth?.uid,
      correlationId: ctx.correlationId
    });

    return buildHttpResponse(
      200,
      buildSuccessResponse(result, { operation, region: "me-west1" }),
      ctx.corsHeaders
    );
  } catch (error) {
    let corsHeaders: Record<string, string> = {};
    try {
      const errCtx = await createEdgeFunctionContext(req, env);
      corsHeaders = errCtx.corsHeaders;
      errCtx.logger.error("Tax mutation gateway request failed", {
        error: error?.message || String(error),
        region: "me-west1",
        correlationId: errCtx.correlationId,
      });
    } catch {
      // createEdgeFunctionContext itself failed; proceed with empty corsHeaders
    }
    return handleHttpError(error, corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleMutationMeWest1Request;

export const handler = handleMutationMeWest1Request;

const meWestServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof meWestServe === "function") {
  meWestServe(handleMutationMeWest1Request);
}
