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

function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  // IPv4
  const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  // IPv6 (including compressed forms)
  const ipv6 = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}$|^(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}$|^(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}$|^[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}$|^::$|^::1$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

function getRemoteAddr(req: Request): string | undefined {
  const connInfo = (req as unknown as { connInfo?: { remoteAddr?: { hostname?: string; port?: number } | string } }).connInfo;
  if (!connInfo?.remoteAddr) return undefined;
  if (typeof connInfo.remoteAddr === "string") return connInfo.remoteAddr;
  return connInfo.remoteAddr.hostname;
}

function getClientIp(req: Request): string {
  // Only trust CF-Connecting-IP when the request came through Cloudflare (cf-ray is present).
  // Direct callers can spoof x-real-ip / x-forwarded-for, so those headers are ignored.
  const cfRay = req.headers.get("cf-ray");
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfRay && cfConnectingIp) {
    const ip = cfConnectingIp.trim();
    if (isValidIp(ip)) return ip;
  }

  const remoteAddr = getRemoteAddr(req);
  if (remoteAddr) {
    const ip = remoteAddr.trim();
    if (isValidIp(ip)) return ip;
  }

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

    const company = body?.company
      ? requireNonEmptyString(body.company, "company", 1, 500)
      : "General";

    const result = await contactRequestV1(
      {
        name,
        email,
        subject,
        company,
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
    let corsHeaders: Record<string, string> = {};
    try {
      const errCtx = await createEdgeFunctionContext(req, env);
      corsHeaders = errCtx.corsHeaders;
      errCtx.logger.error("Contact request failed", {
        error: error instanceof Error ? error.message : String(error),
        correlationId: errCtx.correlationId,
      });
    } catch {
      // createEdgeFunctionContext itself failed; proceed with empty corsHeaders
    }
    return handleHttpError(error, corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleContactRequestRequest;

export const handler = handleContactRequestRequest;

const contactRequestServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof contactRequestServe === "function") {
  contactRequestServe(handleContactRequestRequest);
}
