import type { AuthenticatedApiRequest } from "./request.js";
import type { SupabaseUserClient } from "./supabase-user-client.js";
import { AuthError } from "./errors.js";
import { AppError } from "../http/errors.js";

export async function requireVerifiedMutationIdentity(
  authenticated: AuthenticatedApiRequest,
  supabaseUsers: SupabaseUserClient,
): Promise<void> {
  if (authenticated.scheme === "smart-job-session") return;

  const user = await supabaseUsers.getUser(authenticated.accessToken);
  if (user.userId !== authenticated.userId) {
    throw new AuthError("AUTHORIZATION_INVALID").toAppError();
  }
  if (!user.emailVerified) {
    throw new AppError({
      statusCode: 403,
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Verify your email before changing workspace data.",
    });
  }
}
