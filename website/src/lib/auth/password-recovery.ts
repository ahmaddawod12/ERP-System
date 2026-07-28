import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isVerifiedLocalPlatformRuntime } from "../local-platform.ts";

export const PRODUCTION_RECOVERY_COOKIE = "__Host-sj_recovery";
export const DEVELOPMENT_RECOVERY_COOKIE = "sj_recovery";
export const RECOVERY_CSRF_COOKIE = "sj_recovery_csrf";
export const RECOVERY_MAX_AGE_SECONDS = 10 * 60;

interface RecoveryCredential {
  readonly actionCode: string;
  readonly expiresAt: number;
}

const TOKEN_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function recoveryKey(secret: string): Buffer {
  const normalized = secret.trim();
  if (normalized.length < 32) {
    throw new Error("WEBSITE_SESSION_SECRET must contain at least 32 characters");
  }
  return createHash("sha256")
    .update("smart-job:password-recovery:v1\0", "utf8")
    .update(normalized, "utf8")
    .digest();
}

function parsePart(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The recovery credential is invalid");
  }
  return Buffer.from(value, "base64url");
}

export function recoveryCookieName(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  verifiedLocalPlatform = isVerifiedLocalPlatformRuntime(),
): string {
  return nodeEnv === "production" && !verifiedLocalPlatform
    ? PRODUCTION_RECOVERY_COOKIE
    : DEVELOPMENT_RECOVERY_COOKIE;
}

export function createRecoveryCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isRecoveryCsrfToken(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

export function recoveryCsrfMatches(left: string | null, right: string | null): boolean {
  if (!isRecoveryCsrfToken(left) || !isRecoveryCsrfToken(right)) {
    return false;
  }
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function sealRecoveryCredential(
  credential: RecoveryCredential,
  secret: string,
  nowMs = Date.now(),
): string {
  const actionCode = credential.actionCode.trim();
  const maximumExpiry = nowMs + (RECOVERY_MAX_AGE_SECONDS * 1_000);
  if (
    !actionCode
    || actionCode.length > 4_096
    || !Number.isSafeInteger(credential.expiresAt)
    || credential.expiresAt <= nowMs
  ) {
    throw new Error("Firebase returned an invalid recovery credential");
  }
  const payload = Buffer.from(JSON.stringify({
    actionCode,
    expiresAt: Math.min(credential.expiresAt, maximumExpiry),
  }), "utf8");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", recoveryKey(secret), iv);
  cipher.setAAD(Buffer.from(TOKEN_VERSION, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function openRecoveryCredential(
  value: string,
  secret: string,
  nowMs = Date.now(),
): RecoveryCredential {
  try {
    const [version, ivPart, ciphertextPart, tagPart, extra] = value.split(".");
    if (
      version !== TOKEN_VERSION
      || !ivPart
      || !ciphertextPart
      || !tagPart
      || extra !== undefined
    ) {
      throw new Error("invalid token shape");
    }
    const iv = parsePart(ivPart);
    const ciphertext = parsePart(ciphertextPart);
    const tag = parsePart(tagPart);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
      throw new Error("invalid token size");
    }
    const decipher = createDecipheriv("aes-256-gcm", recoveryKey(secret), iv);
    decipher.setAAD(Buffer.from(TOKEN_VERSION, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<RecoveryCredential>;
    const actionCode = typeof parsed.actionCode === "string"
      ? parsed.actionCode.trim()
      : "";
    const expiresAt = Number(parsed.expiresAt);
    if (
      !actionCode
      || actionCode.length > 4_096
      || !Number.isSafeInteger(expiresAt)
      || expiresAt <= nowMs
      || expiresAt > nowMs + (RECOVERY_MAX_AGE_SECONDS * 1_000)
    ) {
      throw new Error("invalid token payload");
    }
    return { actionCode, expiresAt };
  } catch {
    throw new Error("The password recovery link is invalid or expired");
  }
}
