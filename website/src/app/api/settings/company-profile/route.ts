import { updateCompanyProfile } from "@/lib/backend/profile-client";
import { handleCompanyProfileUpdate } from "@/lib/settings/profile-route-core";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  return handleCompanyProfileUpdate(request, { update: updateCompanyProfile });
}
