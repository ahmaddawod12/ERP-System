import { z } from "zod";

import { AppError } from "../http/errors.js";

const firebaseSessionSchema = z.object({
  idToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384),
  expiresIn: z.union([z.string(), z.number()]).transform(Number),
  localId: z.string().min(1).max(128).optional(),
  email: z.email().optional(),
}).passthrough();

const firebaseRefreshSchema = z.object({
  id_token: z.string().min(1).max(16_384),
  refresh_token: z.string().min(1).max(16_384),
  expires_in: z.union([z.string(), z.number()]).transform(Number),
  user_id: z.string().min(1).max(128),
}).passthrough();

const firebaseErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).passthrough().optional(),
}).passthrough();

export interface FirebaseWebAuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface FirebaseWebAuthClient {
  signInWithPassword(email: string, password: string): Promise<FirebaseWebAuthSession>;
  refreshSession(refreshToken: string): Promise<FirebaseWebAuthSession>;
  signOut(_accessToken: string): Promise<void>;
}

export interface CreateFirebaseWebAuthClientOptions {
  readonly apiKey: string;
  readonly authBaseUrl?: URL;
  readonly tokenBaseUrl?: URL;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

function appError(
  statusCode: number,
  code: string,
  message: string,
  retryable = false,
  cause?: unknown,
): AppError {
  return new AppError({ statusCode, code, message, retryable, cause });
}

function unavailable(cause: unknown): AppError {
  return appError(
    503,
    "AUTH_SERVICE_UNAVAILABLE",
    "Authentication services are temporarily unavailable.",
    true,
    cause,
  );
}

async function safeErrorCode(response: Response): Promise<string> {
  try {
    const parsed = firebaseErrorSchema.safeParse(await response.json());
    return parsed.success ? String(parsed.data.error?.message ?? "") : "";
  } catch {
    return "";
  }
}

function mapFailure(status: number, code: string): AppError {
  if (
    status === 400
    && [
      "EMAIL_NOT_FOUND",
      "INVALID_LOGIN_CREDENTIALS",
      "INVALID_PASSWORD",
      "USER_DISABLED",
      "INVALID_REFRESH_TOKEN",
      "TOKEN_EXPIRED",
    ].some((candidate) => code.startsWith(candidate))
  ) {
    return appError(401, "AUTH_CREDENTIALS_INVALID", "Email or password is incorrect.");
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return unavailable(new Error(`Firebase Auth returned ${status}`));
  }
  return appError(400, "AUTH_REQUEST_INVALID", "Authentication request was rejected.");
}

function endpoint(base: URL, path: string, apiKey: string): URL {
  const result = new URL(path, base);
  result.searchParams.set("key", apiKey);
  return result;
}

export function createFirebaseWebAuthClient(
  options: CreateFirebaseWebAuthClientOptions,
): FirebaseWebAuthClient {
  const apiKey = options.apiKey.trim();
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) {
    throw new TypeError("FIREBASE_WEB_API_KEY is invalid");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 12_000) {
    throw new TypeError("Firebase Auth timeout must be between 100 and 12000 ms");
  }
  const authBaseUrl = options.authBaseUrl
    ?? new URL("https://identitytoolkit.googleapis.com/");
  const tokenBaseUrl = options.tokenBaseUrl
    ?? new URL("https://securetoken.googleapis.com/");
  const signInEndpoint = endpoint(
    authBaseUrl,
    "v1/accounts:signInWithPassword",
    apiKey,
  );
  const refreshEndpoint = endpoint(tokenBaseUrl, "v1/token", apiKey);

  async function request(input: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetchImplementation(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw unavailable(error);
    }
  }

  function expiresAt(expiresIn: number): number {
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
      throw unavailable(new Error("Firebase Auth returned an invalid expiry"));
    }
    return Math.floor(now() / 1_000) + expiresIn;
  }

  return {
    async signInWithPassword(email, password) {
      const response = await request(signInEndpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      if (!response.ok) throw mapFailure(response.status, await safeErrorCode(response));
      const parsed = firebaseSessionSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw unavailable(parsed.error);
      return {
        accessToken: parsed.data.idToken,
        refreshToken: parsed.data.refreshToken,
        expiresAt: expiresAt(parsed.data.expiresIn),
      };
    },

    async refreshSession(refreshToken) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const response = await request(refreshEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!response.ok) throw mapFailure(response.status, await safeErrorCode(response));
      const parsed = firebaseRefreshSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw unavailable(parsed.error);
      return {
        accessToken: parsed.data.id_token,
        refreshToken: parsed.data.refresh_token,
        expiresAt: expiresAt(parsed.data.expires_in),
      };
    },

    async signOut() {
      // The opaque Postgres session is the revocation boundary. Firebase has no
      // single-refresh-token server logout; revoking all user tokens here would
      // unexpectedly sign the user out of every device.
    },
  };
}
