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
import { requestUpgradeV1 } from "../../../handlers/misc.ts";

const env = getEnv();
const RATE_LIMIT_KEY_PREFIX = "upgrade:request";
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

async function handleUpgradeRequest(req: Request): Promise<Response> {
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
        error: { code: "invalid-argument", message: "Only POST is allowed" },
      },
      ctx.corsHeaders,
    );
  }

  try {
    const ctx = await createEdgeFunctionContext(req, env);
    if (!ctx.auth?.uid) {
      throw { code: "unauthenticated", httpStatus: 401, message: "Authentication required" };
    }

    const body = await parseJsonBody(req);
    const requestedTier = requireNonEmptyString(body?.requestedTier, "requestedTier", 2, 32);
    const message = requireNonEmptyString(body?.message, "message", 10, 2000);

    await checkRateLimit(
      `${RATE_LIMIT_KEY_PREFIX}:${ctx.auth.uid}`,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS,
      ctx,
    );

    const result = await requestUpgradeV1(
      {
        currentTier: body?.currentTier,
        requestedTier,
        message,
      },
      ctx,
    );

    return buildHttpResponse(201, buildSuccessResponse(result), ctx.corsHeaders);
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    return handleHttpError(error, ctx.corsHeaders);
  }
}

export default handleUpgradeRequest;
export const handler = handleUpgradeRequest;

const upgradeRequestServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof upgradeRequestServe === "function") {
  upgradeRequestServe(handleUpgradeRequest);
}
