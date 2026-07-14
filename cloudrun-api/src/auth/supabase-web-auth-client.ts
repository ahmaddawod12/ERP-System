import { z } from "zod";

import { AppError } from "../http/errors.js";

const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable().optional(),
  email_confirmed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  confirmed_at: z.iso.datetime({ offset: true }).nullable().optional(),
}).passthrough();

const authSessionSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  refresh_token: z.string().min(1).max(16_384),
  expires_at: z.number().int().positive().optional(),
  expires_in: z.number().int().positive().max(86_400),
  user: authUserSchema.optional(),
}).passthrough();

const authErrorSchema = z.object({
  error_code: z.string().optional(),
  code: z.string().optional(),
}).passthrough();

export interface SupabaseWebAuthUser {
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface SupabaseWebAuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly user: SupabaseWebAuthUser | null;
}

export interface SupabaseWebAuthClient {
  signInWithPassword(email: string, password: string): Promise<SupabaseWebAuthSession>;
  refreshSession(refreshToken: string): Promise<SupabaseWebAuthSession>;
  signOut(accessToken: string): Promise<void>;
}

export interface CreateSupabaseWebAuthClientOptions {
  readonly baseUrl: URL;
  readonly publishableKey: string;
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

async function safeErrorCode(response: Response): Promise<string | null> {
  try {
    const parsed = authErrorSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return (parsed.data.error_code ?? parsed.data.code ?? null)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function mapUser(value: z.infer<typeof authUserSchema>): SupabaseWebAuthUser {
  return {
    userId: value.id.toLowerCase(),
    email: value.email ?? null,
    emailVerified: Boolean(value.email_confirmed_at),
  };
}

export function createSupabaseWebAuthClient(
  options: CreateSupabaseWebAuthClientOptions,
): SupabaseWebAuthClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 12_000) {
    throw new TypeError("Supabase web Auth timeout must be between 100 and 12000 ms");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) {
    throw new TypeError("A Supabase publishable key is required");
  }

  const passwordEndpoint = new URL("auth/v1/token?grant_type=password", options.baseUrl);
  const refreshEndpoint = new URL("auth/v1/token?grant_type=refresh_token", options.baseUrl);
  const signOutEndpoint = new URL("auth/v1/logout?scope=local", options.baseUrl);

  async function postJson(endpoint: URL, body: Record<string, string>): Promise<Response> {
    try {
      return await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          apikey: options.publishableKey,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw unavailable(error);
    }
  }

  async function parseSession(response: Response): Promise<SupabaseWebAuthSession> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw unavailable(error);
    }
    const parsed = authSessionSchema.safeParse(payload);
    if (!parsed.success) throw unavailable(parsed.error);
    const calculatedExpiry = Math.floor(now() / 1_000) + parsed.data.expires_in;
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresAt: parsed.data.expires_at ?? calculatedExpiry,
      user: parsed.data.user === undefined ? null : mapUser(parsed.data.user),
    };
  }

  return {
    async signInWithPassword(email, password) {
      const response = await postJson(passwordEndpoint, { email, password });
      if (!response.ok) {
        const errorCode = await safeErrorCode(response);
        if (response.status === 429) {
          throw appError(
            429,
            "AUTH_RATE_LIMITED",
            "Too many sign-in attempts. Try again later.",
            true,
          );
        }
        if (errorCode === "email_not_confirmed") {
          throw appError(
            403,
            "EMAIL_NOT_VERIFIED",
            "Verify your email address before signing in.",
          );
        }
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw appError(
            401,
            "INVALID_CREDENTIALS",
            "The email address or password is incorrect.",
          );
        }
        throw unavailable(new Error(`Supabase Auth returned ${response.status}`));
      }
      const session = await parseSession(response);
      if (session.user === null) {
        throw unavailable(new Error("Supabase Auth omitted the signed-in user"));
      }
      return session;
    },

    async refreshSession(refreshToken) {
      const response = await postJson(refreshEndpoint, { refresh_token: refreshToken });
      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw appError(
            401,
            "WEB_SESSION_INVALID",
            "The website session is invalid or expired.",
          );
        }
        if (response.status === 429) {
          throw appError(
            503,
            "AUTH_SERVICE_UNAVAILABLE",
            "Authentication services are temporarily unavailable.",
            true,
          );
        }
        throw unavailable(new Error(`Supabase Auth returned ${response.status}`));
      }
      return parseSession(response);
    },

    async signOut(accessToken) {
      let response: Response;
      try {
        response = await fetchImplementation(signOutEndpoint, {
          method: "POST",
          headers: {
            apikey: options.publishableKey,
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw unavailable(error);
      }
      if (!response.ok && response.status !== 401 && response.status !== 403) {
        throw unavailable(new Error(`Supabase Auth returned ${response.status}`));
      }
    },
  };
}
