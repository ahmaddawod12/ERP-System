import { 
  getEnv, 
  createEdgeFunctionContext, 
  handleOptions, 
  handleHttpError,
  buildHttpResponse, 
  buildSuccessResponse, 
  parseJsonBody, 
  validateCompanyId,
  requireNonEmptyString,
  optionalTrimmedString,
  validateEmail,
  assertCompanyAccess,
  checkRateLimit
} from "../../../shared-edge-helpers.ts";
import { createInviteV1 } from "../../../handlers/invites.ts";

const env = getEnv();

/**
 * Create Invite Endpoint
 * 
 * Creates an invite code for joining a company.
 * Only managers can create invites.
 * Rate limited: 10 per 60 seconds per user.
 * 
 * Contract: PHASE-0-CONTRACTS.md
 * Phase: 3 (Implementation)
 * 
 * Request:
 * POST /invites/create
 * Authorization: Bearer {idToken}
 * {
 *   "companyId": string,
 *   "targetRole": "manager" | "worker" | "user" | "basic",
 *   "targetEmail"?: string,
 *   "expiresInDays"?: number
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "data": {
 *     "inviteId": string,
 *     "code": string,
 *     "targetRole": string,
 *     "status": "active" | "used" | "expired" | "revoked",
 *     "expiresAt": ISO-8601,
 *     "createdAt": ISO-8601
 *   }
 * }
 */

const RATE_LIMIT_KEY_PREFIX = "invite:create";
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_EXPIRES_IN_DAYS = 30;

// ── Main Handler ────────────────────────────────────────────────────────────
async function handleCreateInviteRequest(req: Request): Promise<Response> {
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

    // Require authentication
    if (!ctx.auth) {
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Authentication required"
      };
    }

    // Parse request
    const body = await parseJsonBody(req);
    const companyId = validateCompanyId(body?.companyId || "");
    const targetRole = requireNonEmptyString(body?.targetRole || "", "targetRole", 1, 50);
    const targetEmail = optionalTrimmedString(body?.targetEmail, 254);
    const expiresInDays = Math.max(1, Math.min(365, Number(body?.expiresInDays) || DEFAULT_EXPIRES_IN_DAYS));

    ctx.logger.info("Create invite request", {
      uid: ctx.auth.uid,
      companyId,
      targetRole,
      targetEmail: targetEmail ? `${targetEmail[0]}***@***` : undefined,
      correlationId: ctx.correlationId
    });

    // Verify company access (managers only)
    await assertCompanyAccess(ctx.auth.uid, companyId, ["manager", "dev"], ctx);

    // Check rate limit
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${ctx.auth.uid}`;
    await checkRateLimit(rateLimitKey, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS, ctx);

    // Validate target email if provided
    if (targetEmail) {
      validateEmail(targetEmail);
    }

    const inviteResponse = await createInviteV1(
      {
        companyId,
        targetRole,
        targetEmail,
        expiresInDays,
      },
      ctx
    );

    ctx.logger.info("Create invite succeeded", {
      uid: ctx.auth.uid,
      companyId,
      correlationId: ctx.correlationId
    });

    return buildHttpResponse(
      200,
      buildSuccessResponse(inviteResponse),
      ctx.corsHeaders
    );
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    ctx.logger.error("Create invite request failed", {
      error: error instanceof Error ? error.message : String(error),
      correlationId: ctx.correlationId
    });
    return handleHttpError(error, ctx.corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleCreateInviteRequest;

export const handler = handleCreateInviteRequest;

const createInviteServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof createInviteServe === "function") {
  createInviteServe(handleCreateInviteRequest);
}
