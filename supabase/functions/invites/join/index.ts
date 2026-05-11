import {
  getEnv,
  createEdgeFunctionContext,
  handleOptions,
  handleHttpError,
  buildHttpResponse,
  buildSuccessResponse,
  parseJsonBody,
  requireNonEmptyString,
  checkRateLimit,
} from "../../../shared-edge-helpers.ts";
import { joinCompanyV1 } from "../../../handlers/invites.ts";

const env = getEnv();

/**
 * Join Company Endpoint
 *
 * POST /invites/join
 * Authorization: Bearer {idToken}
 * {
 *   "inviteCode": string,
 *   "displayName"?: string,
 *   "phoneNumber"?: string
 * }
 */
async function handleJoinCompanyRequest(req: Request): Promise<Response> {
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
          message: "Only POST is allowed",
        },
      },
      ctx.corsHeaders,
    );
  }

  try {
    const ctx = await createEdgeFunctionContext(req, env);
    if (!ctx.auth) {
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Authentication required",
      };
    }

    const body = await parseJsonBody(req);
    const inviteCode = requireNonEmptyString(body?.inviteCode || "", "inviteCode", 4, 80);

    await checkRateLimit(`join:${ctx.auth.uid}`, 10, 60_000, ctx);

    const response = await joinCompanyV1(
      {
        inviteCode,
        displayName: body?.displayName,
        phoneNumber: body?.phoneNumber,
      },
      ctx,
    );

    return buildHttpResponse(200, buildSuccessResponse(response), ctx.corsHeaders);
  } catch (error) {
    let corsHeaders: Record<string, string> = {};
    try {
      const errCtx = await createEdgeFunctionContext(req, env);
      corsHeaders = errCtx.corsHeaders;
      errCtx.logger.error("Join company request failed", {
        error: error instanceof Error ? error.message : String(error),
        correlationId: errCtx.correlationId,
      });
    } catch {
      // createEdgeFunctionContext itself failed; proceed with empty corsHeaders
    }
    return handleHttpError(error, corsHeaders);
  }
}

export default handleJoinCompanyRequest;
export const handler = handleJoinCompanyRequest;

const joinInviteServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof joinInviteServe === "function") {
  joinInviteServe(handleJoinCompanyRequest);
}
