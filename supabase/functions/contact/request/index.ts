import { 
  getEnv, 
  createEdgeFunctionContext, 
  handleOptions, 
  handleHttpError,
  buildHttpResponse, 
  buildSuccessResponse, 
  parseJsonBody, 
  requireNonEmptyString,
  validateEmail,
  checkRateLimit
} from "../../../shared-edge-helpers.ts";
import { contactRequestV1 } from "../../../handlers/misc.ts";

const env = getEnv();

/**
 * Contact Request Endpoint
 * 
 * Unauthenticated contact form submission from landing page or in-app.
 * Rate limited: 5 per 60 seconds per IP.
 * Triggers email notification (via Pub/Sub).
 * 
 * Contract: PHASE-0-CONTRACTS.md
 * Phase: 3 (Implementation)
 * 
 * Request:
 * POST /contact/request
 * Content-Type: application/json
 * {
 *   "name": string,
 *   "email": string,
 *   "phone"?: string,
 *   "subject": string,
 *   "message": string,
 *   "fromApp"?: boolean
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "data": {
 *     "requestId": string,
 *     "status": "received",
 *     "confirmationEmail"?: string,
 *     "createdAt": ISO-8601
 *   }
 * }
 */

const RATE_LIMIT_KEY_PREFIX = "contact:request";
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(req: Request): string {
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp.trim();

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

// ── Main Handler ────────────────────────────────────────────────────────────
async function handleContactRequestRequest(req: Request): Promise<Response> {
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

    // Parse request (no auth required)
    const body = await parseJsonBody(req);
    const name = requireNonEmptyString(body?.name || "", "name", 1, 500);
    const email = validateEmail(body?.email || "");
    const phone = body?.phone ? requireNonEmptyString(body.phone, "phone", 1, 20) : undefined;
    const subject = requireNonEmptyString(body?.subject || "", "subject", 1, 500);
    const message = requireNonEmptyString(body?.message || "", "message", 1, 10000);
    const fromApp = body?.fromApp === true;

    const clientIp = getClientIp(req);

    ctx.logger.info("Contact request received", {
      email: email[0] + "***@***",
      name,
      subject,
      fromApp,
      clientIp,
      correlationId: ctx.correlationId
    });

    // Check rate limit by IP
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${clientIp}:${email.toLowerCase()}`;
    await checkRateLimit(rateLimitKey, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS, ctx);

    const result = await contactRequestV1(
      {
        name,
        email,
        company: body?.company || body?.subject || "General",
        message,
      },
      ctx,
    );

    const response = {
      requestId: result.requestId,
      status: "received",
      confirmationEmail: email,
      createdAt: new Date().toISOString(),
    };

    ctx.logger.info("Contact request recorded", {
      requestId: result.requestId,
      email: email[0] + "***@***",
      correlationId: ctx.correlationId
    });

    return buildHttpResponse(
      200,
      buildSuccessResponse(response),
      ctx.corsHeaders
    );
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error("Contact request failed", {
      error: errorMessage,
      correlationId: ctx.correlationId
    });
    return handleHttpError(error, ctx.corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleContactRequestRequest;

export const handler = handleContactRequestRequest;

const contactRequestServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof contactRequestServe === "function") {
  contactRequestServe(handleContactRequestRequest);
}
