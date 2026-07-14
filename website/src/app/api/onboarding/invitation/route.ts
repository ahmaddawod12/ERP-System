import { redeemWorkspaceInvitation } from "@/lib/backend/invitation-client";
import { handleInvitationRedemption } from "@/lib/onboarding/invitation-redemption-route-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleInvitationRedemption(request, {
    redeem: redeemWorkspaceInvitation,
  });
}
