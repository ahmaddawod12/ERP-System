import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

import { AppError } from "../http/errors.js";
import { AuthError } from "./errors.js";
import type { FirebaseTokenVerifier } from "./firebase-token.js";

export interface FirebaseAuthUser {
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface FirebaseUserClient {
  getUser(accessToken: string): Promise<FirebaseAuthUser>;
}

export interface CreateFirebaseUserClientOptions {
  readonly projectId: string;
  readonly verifier: FirebaseTokenVerifier;
  readonly auth?: Pick<Auth, "getUser">;
}

function firebaseApp(projectId: string): App {
  const existing = getApps().find((candidate) => candidate.name === "smart-job-users");
  return existing ?? initializeApp(
    { credential: applicationDefault(), projectId },
    "smart-job-users",
  );
}

function unavailable(cause: unknown): AppError {
  return new AppError({
    statusCode: 503,
    code: "AUTH_SERVICE_UNAVAILABLE",
    message: "Authentication services are temporarily unavailable.",
    retryable: true,
    cause,
  });
}

export function createFirebaseUserClient(
  options: CreateFirebaseUserClientOptions,
): FirebaseUserClient {
  const auth = options.auth ?? getAuth(firebaseApp(options.projectId));

  return {
    async getUser(accessToken) {
      const identity = await options.verifier.verifyAccessToken(accessToken);
      try {
        const user = await auth.getUser(identity.providerUserId ?? identity.userId);
        if (user.disabled) throw new AuthError("AUTHORIZATION_INVALID");
        return {
          userId: identity.userId,
          email: user.email ?? null,
          emailVerified: user.emailVerified,
        };
      } catch (error) {
        if (error instanceof AuthError) throw error.toAppError();
        const code = typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
        if (code === "auth/user-not-found" || code === "auth/user-disabled") {
          throw new AuthError("AUTHORIZATION_INVALID").toAppError();
        }
        throw unavailable(error);
      }
    },
  };
}
