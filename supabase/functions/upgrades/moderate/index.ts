import {
  getEnv,
  createEdgeFunctionContext,
  handleOptions,
  handleHttpError,
  buildHttpResponse,
  buildSuccessResponse,
  parseJsonBody,
  requireNonEmptyString,
  optionalTrimmedString,
} from "../../../shared-edge-helpers.ts";
import { moderateUpgradeRequestV1 } from "../../../handlers/misc.ts";

const env = getEnv();

async function handleModerateUpgradeRequest(req: Request): Promise<Response> {
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
    const requestId = requireNonEmptyString(body?.requestId, "requestId", 3, 128);
    const status = requireNonEmptyString(body?.status, "status", 4, 32);
    const moderationNote = optionalTrimmedString(body?.moderationNote, 1000);

    const result = await moderateUpgradeRequestV1(
      {
        requestId,
        status,
        moderationNote,
      },
      ctx,
    );

    return buildHttpResponse(200, buildSuccessResponse(result), ctx.corsHeaders);
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    return handleHttpError(error, ctx.corsHeaders);
  }
}

export default handleModerateUpgradeRequest;
export const handler = handleModerateUpgradeRequest;

const moderateUpgradeServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof moderateUpgradeServe === "function") {
  moderateUpgradeServe(handleModerateUpgradeRequest);
}
