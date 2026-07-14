import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  WebSessionCsrfTokenSchema,
  WebSessionTokenSchema,
  type WebSessionCsrfToken,
  type WebSessionToken,
} from "@smart-job/api-contracts";
import { z } from "zod";

import { AppError } from "../http/errors.js";

const credentialsSchema = z.object({
  accessToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384),
}).strict();

export interface WebSessionCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface WebSessionEncryptionBinding {
  readonly id: string;
  readonly userId: string;
  readonly supabaseSessionId: string;
  readonly absoluteExpiresAt: Date;
}

export interface EncryptedWebSessionCredentials {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly keyVersion: string;
}

export interface WebSessionCrypto {
  readonly keyVersion: string;
  generateSessionToken(): WebSessionToken;
  generateCsrfToken(): WebSessionCsrfToken;
  hashToken(token: string): Buffer;
  hashesEqual(left: Buffer, right: Buffer): boolean;
  encrypt(
    binding: WebSessionEncryptionBinding,
    credentials: WebSessionCredentials,
  ): EncryptedWebSessionCredentials;
  decrypt(
    binding: WebSessionEncryptionBinding,
    encrypted: EncryptedWebSessionCredentials,
  ): WebSessionCredentials;
}

export interface CreateWebSessionCryptoOptions {
  readonly key: Buffer;
  readonly keyVersion: string;
  readonly randomBytes?: (size: number) => Buffer;
}

function aad(binding: WebSessionEncryptionBinding, keyVersion: string): Buffer {
  return Buffer.from([
    "smart-job:web-session:aes-256-gcm:v1",
    binding.id.toLowerCase(),
    binding.userId.toLowerCase(),
    binding.supabaseSessionId.toLowerCase(),
    binding.absoluteExpiresAt.toISOString(),
    keyVersion,
  ].join("\n"), "utf8");
}

function unavailable(code: string, cause?: unknown): AppError {
  return new AppError({
    statusCode: 503,
    code,
    message: "The website session cannot be processed right now.",
    retryable: true,
    cause,
  });
}

export function createWebSessionCrypto(
  options: CreateWebSessionCryptoOptions,
): WebSessionCrypto {
  if (options.key.length !== 32) {
    throw new TypeError("The web-session AES-256-GCM key must contain exactly 32 bytes");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.keyVersion)) {
    throw new TypeError("The web-session encryption key version is invalid");
  }
  const key = Buffer.from(options.key);
  const generateBytes = options.randomBytes ?? randomBytes;

  return {
    keyVersion: options.keyVersion,
    generateSessionToken() {
      return WebSessionTokenSchema.parse(generateBytes(32).toString("base64url"));
    },
    generateCsrfToken() {
      return WebSessionCsrfTokenSchema.parse(generateBytes(32).toString("base64url"));
    },
    hashToken(token) {
      return createHash("sha256").update(token, "utf8").digest();
    },
    hashesEqual(left, right) {
      return left.length === right.length && timingSafeEqual(left, right);
    },
    encrypt(binding, credentials) {
      const parsed = credentialsSchema.parse(credentials);
      const iv = generateBytes(12);
      if (iv.length !== 12) throw new TypeError("The random IV source returned an invalid length");
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(binding, options.keyVersion));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(parsed), "utf8"),
        cipher.final(),
      ]);
      return {
        ciphertext,
        iv,
        authTag: cipher.getAuthTag(),
        keyVersion: options.keyVersion,
      };
    },
    decrypt(binding, encrypted) {
      if (encrypted.keyVersion !== options.keyVersion) {
        throw unavailable("WEB_SESSION_KEY_UNAVAILABLE");
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
        decipher.setAAD(aad(binding, encrypted.keyVersion));
        decipher.setAuthTag(encrypted.authTag);
        const plaintext = Buffer.concat([
          decipher.update(encrypted.ciphertext),
          decipher.final(),
        ]).toString("utf8");
        return credentialsSchema.parse(JSON.parse(plaintext) as unknown);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw unavailable("WEB_SESSION_DECRYPTION_FAILED", error);
      }
    },
  };
}
