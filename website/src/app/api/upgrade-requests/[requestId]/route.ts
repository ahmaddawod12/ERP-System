import {
  createUpgradeRequest,
  moderateUpgradeRequest,
} from "@/lib/backend/upgrade-request-client";
import { handleUpgradeRequestModeration } from "@/lib/upgrade/upgrade-request-route-core";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  return handleUpgradeRequestModeration(request, requestId, {
    create: createUpgradeRequest,
    moderate: moderateUpgradeRequest,
  });
}
