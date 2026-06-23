import { getSupabaseUserByUid, verifyAccessToken } from "@/lib/auth/access-token";
import {
  handleCreateSession,
  handleDeleteSession,
  handleReadSession,
} from "@/lib/auth/session-route";

export async function POST(request: Request) {
  return handleCreateSession(request, {
    verifyAccessToken,
  });
}

export async function GET(request: Request) {
  return handleReadSession(request, {
    getUserByUid: getSupabaseUserByUid,
  });
}

export async function DELETE() {
  return handleDeleteSession();
}
