import { createContactRequest } from "@/lib/backend/contact-request-client";
import { verifyContactChallenge } from "@/lib/contact/challenge";
import { handleContactRequest } from "@/lib/contact/contact-request-route-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleContactRequest(request, {
    create: createContactRequest,
    verifyChallenge: verifyContactChallenge,
  });
}
