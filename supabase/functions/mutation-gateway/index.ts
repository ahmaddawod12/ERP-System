import { 
  getEnv, 
  createEdgeFunctionContext, 
  handleOptions, 
  handleHttpError,
  buildHttpResponse, 
  buildSuccessResponse, 
  parseJsonBody, 
  requireNonEmptyString,
  StructuredLogger
} from "../../shared-edge-helpers.ts";

// Import handlers as they are implemented
import * as authHandlers from "../../handlers/auth.ts";
import * as clientsHandlers from "../../handlers/clients.ts";
import * as documentsHandlers from "../../handlers/documents.ts";
import * as inventoryHandlers from "../../handlers/inventory.ts";
import * as jobsHandlers from "../../handlers/jobs.ts";
import * as miscHandlers from "../../handlers/misc.ts";
import * as profileHandlers from "../../handlers/profile.ts";
import * as supportHandlers from "../../handlers/support.ts";

const env = getEnv();

/**
 * Mutation Gateway - Default Region (us-central1)
 * 
 * Routes all mutation operations through a single POST /api/callable endpoint.
 * Maintains 100% compatibility with Firebase Cloud Functions request/response format.
 * 
 * Contract: PHASE-0-CONTRACTS.md
 * Phase: 3 (Implementation)
 * 
 * Supported operations:
 * - Auth: manageWorker, registerBusinessV1
 * - Jobs: createJobV1, updateJobV1, deleteJobV1, acceptJobV1, createJobFileDownloadUrlV1
 * - Inventory: updateInventoryV1
 * - Clients: addClientV1, deleteClientV1, updateClientV1
 * - Documents: publishPreviewTask, publishGenerateTask, deleteDocumentV1, createDocumentDownloadUrlV1, fetchArchiveMonthV1
 * - Profile: updateProfileV1, updatePushTokenV1, clearPushTokenV1, updateBusinessInfoV1, updateCacheV1
 * - Support: createSupportConversationV1, appendSupportMessageV1, markSupportConversationReadV1, closeSupportConversationV1, listSupportConversationsV1, getSupportConversationThreadV1
 */

// ── Operation Dispatcher (Phase 2: Import handlers) ────────────────────────────
type MutationHandler = (payload: any, ctx: any) => Promise<any>;

// Placeholder - will be populated in Phase 2 when handlers are extracted
const OPERATIONS: Record<string, MutationHandler> = {
  // Auth Domain
  manageWorker: authHandlers.manageWorker,
  registerBusinessV1: authHandlers.registerBusinessV1,

  // Jobs Domain
  createJobV1: jobsHandlers.createJobV1,
  updateJobV1: jobsHandlers.updateJobV1,
  deleteJobV1: jobsHandlers.deleteJobV1,
  acceptJobV1: jobsHandlers.acceptJobV1,
  createJobFileDownloadUrlV1: jobsHandlers.createJobFileDownloadUrlV1,

  // Inventory Domain
  updateInventoryV1: inventoryHandlers.updateInventoryV1,

  // Clients Domain
  addClientV1: clientsHandlers.addClientV1,
  deleteClientV1: clientsHandlers.deleteClientV1,
  updateClientV1: clientsHandlers.updateClientV1,

  // Documents Domain
  publishPreviewTask: documentsHandlers.publishPreviewTask,
  publishGenerateTask: documentsHandlers.publishGenerateTask,
  deleteDocumentV1: documentsHandlers.deleteDocumentV1,
  createDocumentDownloadUrlV1: documentsHandlers.createDocumentDownloadUrlV1,
  fetchArchiveMonthV1: documentsHandlers.fetchArchiveMonthV1,

  // Profile Domain
  updateProfileV1: profileHandlers.updateProfileV1,
  updatePushTokenV1: profileHandlers.updatePushTokenV1,
  clearPushTokenV1: profileHandlers.clearPushTokenV1,
  updateBusinessInfoV1: profileHandlers.updateBusinessInfoV1,
  updateCacheV1: profileHandlers.updateCacheV1,

  // Support Domain
  createSupportConversationV1: supportHandlers.createSupportConversationV1,
  appendSupportMessageV1: supportHandlers.appendSupportMessageV1,
  markSupportConversationReadV1: supportHandlers.markSupportConversationReadV1,
  closeSupportConversationV1: supportHandlers.closeSupportConversationV1,
  listSupportConversationsV1: supportHandlers.listSupportConversationsV1,
  getSupportConversationThreadV1: supportHandlers.getSupportConversationThreadV1,

  // Misc Domain
  requestUpgradeV1: miscHandlers.requestUpgradeV1,
  listUpgradeRequestsV1: miscHandlers.listUpgradeRequestsV1,
  moderateUpgradeRequestV1: miscHandlers.moderateUpgradeRequestV1,
};

// ── Main Handler ────────────────────────────────────────────────────────────
async function handleMutationRequest(req: Request): Promise<Response> {
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

    ctx.logger.info("Mutation gateway request received", {
      operation,
      uid: ctx.auth?.uid,
      correlationId: ctx.correlationId
    });

    // Find handler for operation
    const handler = OPERATIONS[operation];
    if (!handler) {
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: `Unsupported mutation operation: ${operation}`
      };
    }

    // Require authentication for most operations
    // (Some operations like registerBusinessV1 may not require auth - handled per-handler)
    if (!ctx.auth && operation !== "registerBusinessV1") {
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Authentication required for this operation"
      };
    }

    // Execute operation
    const payload = body?.payload || {};
    const result = await handler(payload, ctx);

    ctx.logger.info("Mutation gateway request succeeded", {
      operation,
      uid: ctx.auth?.uid,
      correlationId: ctx.correlationId
    });

    return buildHttpResponse(
      200,
      buildSuccessResponse(result, { operation }),
      ctx.corsHeaders
    );
  } catch (error) {
    const ctx = await createEdgeFunctionContext(req, env);
    ctx.logger.error("Mutation gateway request failed", {
      error: error?.message || String(error),
      correlationId: ctx.correlationId
    });
    return handleHttpError(error, ctx.corsHeaders);
  }
}

// ── Export as Deno/Supabase Edge Function ───────────────────────────────────
export default handleMutationRequest;

// Alternative export for serving as HTTP handler
export const handler = handleMutationRequest;

const mutationGatewayServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof mutationGatewayServe === "function") {
  mutationGatewayServe(handleMutationRequest);
}
