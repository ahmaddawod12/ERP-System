import {
  getEnv,
  createEdgeFunctionContext,
  handleOptions,
  handleHttpError,
  buildHttpResponse,
  buildSuccessResponse,
  parseJsonBody,
} from "../../../shared-edge-helpers.ts";
import { listUpgradeRequestsV1 } from "../../../handlers/misc.ts";

const env = getEnv();

async function handleListUpgradeRequests(req: Request): Promise<Response> {
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
    const result = await listUpgradeRequestsV1(
      {
        limit: body?.limit,
      },
      ctx,
    );

    return buildHttpResponse(200, buildSuccessResponse(result), ctx.corsHeaders);
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    return handleHttpError(error, ctx.corsHeaders);
  }
}

export default handleListUpgradeRequests;
export const handler = handleListUpgradeRequests;

const listUpgradeServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof listUpgradeServe === "function") {
  listUpgradeServe(handleListUpgradeRequests);
}
