import { updateViewerProfile } from "@/lib/backend/profile-client";
import { handleViewerProfileUpdate } from "@/lib/settings/profile-route-core";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  return handleViewerProfileUpdate(request, { update: updateViewerProfile });
}
