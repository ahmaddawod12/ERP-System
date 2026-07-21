import { SignJWT, jwtVerify } from "jose";

import {
  isVerifiedLocalPlatformRuntime,
  type LocalPlatformEnvironment,
} from "../local-platform.ts";

export const CONTACT_RECAPTCHA_ACTION = "contact_request";
const LOCAL_PROOF_TTL_SECONDS = 300;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MINIMUM_SCORE = 0.7;
const DEFAULT_TIMEOUT_MS = 8_000;
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

type FetchLike = typeof fetch;

type RecaptchaEnvironment = LocalPlatformEnvironment;

interface RecaptchaConfig {
  readonly projectId: string;
  readonly siteKey: string;
  readonly hostname: string;
  readonly minimumScore: number;
  readonly timeoutMs: number;
}

export type ContactChallenge =
  | {
      readonly provider: "recaptcha-enterprise";
      readonly action: typeof CONTACT_RECAPTCHA_ACTION;
      readonly siteKey: string;
    }
  | {
      readonly provider: "local-proof";
      readonly action: typeof CONTACT_RECAPTCHA_ACTION;
      readonly token: string;
    };

export class ContactChallengeUnavailableError extends Error {
  constructor(message = "Contact verification is temporarily unavailable") {
    super(message);
    this.name = "ContactChallengeUnavailableError";
  }
}

function boundedInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 12_000) {
    throw new Error("RECAPTCHA_ENTERPRISE_TIMEOUT_MS must be from 1000 to 12000");
  }
  return parsed;
}

function localSecret(env: RecaptchaEnvironment): Uint8Array {
  const raw = String(env.CONTACT_CHALLENGE_SECRET || env.WEBSITE_SESSION_SECRET || "");
  if (raw.length < 32) throw new Error("A 32-character website secret is required for local contact proofs");
  return new TextEncoder().encode(raw);
}

function readRecaptchaConfig(env: RecaptchaEnvironment): RecaptchaConfig {
  const projectId = String(env.RECAPTCHA_ENTERPRISE_PROJECT_ID || "").trim();
  const siteKey = String(env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY || "").trim();
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("RECAPTCHA_ENTERPRISE_PROJECT_ID is not configured");
  }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(siteKey)) {
    throw new Error("NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY is not configured");
  }
  const origin = new URL(String(env.WEBSITE_ORIGIN || ""));
  const minimumScore = Number(env.RECAPTCHA_ENTERPRISE_MIN_SCORE || DEFAULT_MINIMUM_SCORE);
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error("RECAPTCHA_ENTERPRISE_MIN_SCORE must be from 0 to 1");
  }
  return {
    projectId,
    siteKey,
    hostname: origin.hostname.toLowerCase(),
    minimumScore,
    timeoutMs: boundedInteger(env.RECAPTCHA_ENTERPRISE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new ContactChallengeUnavailableError();
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ContactChallengeUnavailableError();
    }
    chunks.push(part.value);
  }
  if (bytes === 0) return null;
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new ContactChallengeUnavailableError();
  }
}

async function metadataAccessToken(fetchImpl: FetchLike, timeoutMs: number): Promise<string> {
  const response = await fetchImpl(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readBoundedJson(response) as { access_token?: unknown } | null;
  const token = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
  if (!response.ok || !token) throw new ContactChallengeUnavailableError();
  return token;
}

async function createLocalProof(env: RecaptchaEnvironment): Promise<string> {
  return new SignJWT({ purpose: "contact-local", action: CONTACT_RECAPTCHA_ACTION })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_PROOF_TTL_SECONDS} sec`)
    .sign(localSecret(env));
}

async function verifyLocalProof(
  token: string,
  action: string,
  env: RecaptchaEnvironment,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, localSecret(env), { algorithms: ["HS256"] });
    return payload.purpose === "contact-local"
      && payload.action === CONTACT_RECAPTCHA_ACTION
      && action === CONTACT_RECAPTCHA_ACTION;
  } catch {
    return false;
  }
}

export async function createContactChallenge(
  env: RecaptchaEnvironment = process.env,
): Promise<ContactChallenge> {
  if (isVerifiedLocalPlatformRuntime(env)) {
    return {
      provider: "local-proof",
      action: CONTACT_RECAPTCHA_ACTION,
      token: await createLocalProof(env),
    };
  }
  const config = readRecaptchaConfig(env);
  return {
    provider: "recaptcha-enterprise",
    action: CONTACT_RECAPTCHA_ACTION,
    siteKey: config.siteKey,
  };
}

export async function verifyContactChallenge(
  token: string,
  action: string,
  options: {
    readonly env?: RecaptchaEnvironment;
    readonly fetchImpl?: FetchLike;
    readonly accessToken?: () => Promise<string>;
  } = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  if (isVerifiedLocalPlatformRuntime(env)) return verifyLocalProof(token, action, env);
  if (action !== CONTACT_RECAPTCHA_ACTION || token.length < 20 || token.length > 8192) return false;
  const config = readRecaptchaConfig(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const accessToken = await (options.accessToken
      ? options.accessToken()
      : metadataAccessToken(fetchImpl, config.timeoutMs));
    const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/assessments`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event: { token, siteKey: config.siteKey, expectedAction: CONTACT_RECAPTCHA_ACTION },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const payload = await readBoundedJson(response) as {
      tokenProperties?: { valid?: unknown; action?: unknown; hostname?: unknown };
      riskAnalysis?: { score?: unknown };
    } | null;
    if (!response.ok || !payload) throw new ContactChallengeUnavailableError();
    const score = Number(payload.riskAnalysis?.score);
    return payload.tokenProperties?.valid === true
      && payload.tokenProperties.action === CONTACT_RECAPTCHA_ACTION
      && String(payload.tokenProperties.hostname || "").toLowerCase() === config.hostname
      && Number.isFinite(score)
      && score >= config.minimumScore;
  } catch (error) {
    if (error instanceof ContactChallengeUnavailableError) throw error;
    throw new ContactChallengeUnavailableError();
  }
}
