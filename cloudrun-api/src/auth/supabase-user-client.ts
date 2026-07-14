import { z } from "zod";

import { AppError } from "../http/errors.js";
import { AuthError } from "./errors.js";

const authUserResponseSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable().optional(),
  email_confirmed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  confirmed_at: z.iso.datetime({ offset: true }).nullable().optional(),
}).passthrough();

export interface SupabaseAuthUser {
  readonly userId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

export interface SupabaseUserClient {
  getUser(accessToken: string): Promise<SupabaseAuthUser>;
}

export interface CreateSupabaseUserClientOptions {
  readonly baseUrl: URL;
  readonly publishableKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
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

export function createSupabaseUserClient(
  options: CreateSupabaseUserClientOptions,
): SupabaseUserClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 12_000) {
    throw new TypeError("Supabase user lookup timeout must be between 100 and 12000 ms");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) {
    throw new TypeError("A Supabase publishable key is required");
  }

  const endpoint = new URL("auth/v1/user", options.baseUrl);

  return {
    async getUser(accessToken: string): Promise<SupabaseAuthUser> {
      let response: Response;
      try {
        response = await fetchImplementation(endpoint, {
          method: "GET",
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

      if (response.status === 401 || response.status === 403) {
        throw new AuthError("AUTHORIZATION_INVALID").toAppError();
      }
      if (response.status === 408 || response.status === 425 || response.status === 429) {
        throw unavailable(new Error(`Supabase Auth returned ${response.status}`));
      }
      if (!response.ok) {
        throw unavailable(new Error(`Supabase Auth returned ${response.status}`));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw unavailable(error);
      }

      const parsed = authUserResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw unavailable(parsed.error);
      }

      return {
        userId: parsed.data.id.toLowerCase(),
        email: parsed.data.email ?? null,
        emailVerified: Boolean(parsed.data.email_confirmed_at),
      };
    },
  };
}
