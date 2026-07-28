import {
  createUpgradeRequest,
  moderateUpgradeRequest,
} from "@/lib/backend/upgrade-request-client";
import { handleUpgradeRequestCreate } from "@/lib/upgrade/upgrade-request-route-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleUpgradeRequestCreate(request, {
    create: createUpgradeRequest,
    moderate: moderateUpgradeRequest,
  });
}
