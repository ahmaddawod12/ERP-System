import { registerBusinessWorkspace } from "@/lib/backend/business-registration-client";
import { handleBusinessRegistration } from "@/lib/onboarding/business-registration-route-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleBusinessRegistration(request, {
    register: registerBusinessWorkspace,
  });
}
