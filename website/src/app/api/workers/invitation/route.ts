import { createWorkspaceInvitation } from "@/lib/backend/invitation-client";
import { handleInvitationCreate } from "@/lib/workers/invitation-create-route-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleInvitationCreate(request, {
    create: createWorkspaceInvitation,
  });
}
