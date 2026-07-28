import {
  AssumeRoleWithWebIdentityCommand,
  STSClient,
  type Credentials,
} from "@aws-sdk/client-sts";

import type { EmailWorkerConfig } from "./config.js";

const metadataIdentityUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const refreshSkewMs = 5 * 60 * 1000;

type FederatedConfig = NonNullable<EmailWorkerConfig["ses"]["federation"]>;
type TemporaryCredentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  readonly expiration: Date;
};

type FederationDependencies = {
  readonly now?: () => number;
  readonly fetchIdentityToken?: (audience: string) => Promise<string>;
  readonly assumeRole?: (
    roleArn: string,
    token: string,
    sessionName: string,
  ) => Promise<Credentials | undefined>;
};

function decodeTokenClaims(token: string): Record<string, unknown> {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[1]) throw new Error("Google identity token is malformed");
  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Google identity token claims are malformed");
  }
}

function validateToken(token: string, config: FederatedConfig, now: number): void {
  const claims = decodeTokenClaims(token);
  if (claims.iss !== "https://accounts.google.com") {
    throw new Error("Google identity token issuer is invalid");
  }
  if (claims.aud !== config.audience) {
    throw new Error("Google identity token audience is invalid");
  }
  if (claims.sub !== config.subject || claims.azp !== config.subject) {
    throw new Error("Google identity token subject is invalid");
  }
  const expiresAt = Number(claims.exp) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    throw new Error("Google identity token is expired or too close to expiry");
  }
}

async function fetchIdentityToken(audience: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref();
  try {
    const url = new URL(metadataIdentityUrl);
    url.searchParams.set("audience", audience);
    url.searchParams.set("format", "standard");
    const response = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google metadata identity endpoint returned ${response.status}`);
    const token = (await response.text()).trim();
    if (token.length < 100 || token.length > 20_000) {
      throw new Error("Google metadata identity endpoint returned an invalid token length");
    }
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCredentials(value: Credentials | undefined): TemporaryCredentials {
  if (
    !value?.AccessKeyId
    || !value.SecretAccessKey
    || !value.SessionToken
    || !(value.Expiration instanceof Date)
    || !Number.isFinite(value.Expiration.getTime())
  ) {
    throw new Error("AWS STS returned incomplete temporary credentials");
  }
  return {
    accessKeyId: value.AccessKeyId,
    secretAccessKey: value.SecretAccessKey,
    sessionToken: value.SessionToken,
    expiration: value.Expiration,
  };
}

export function createFederatedCredentialProvider(
  config: FederatedConfig,
  region: string,
  dependencies: FederationDependencies = {},
) {
  const now = dependencies.now ?? Date.now;
  const tokenFetcher = dependencies.fetchIdentityToken ?? fetchIdentityToken;
  const sts = dependencies.assumeRole
    ? undefined
    : new STSClient({ region });
  const assumeRole = dependencies.assumeRole ?? (async (
    roleArn: string,
    token: string,
    sessionName: string,
  ) => {
    const result = await sts!.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      WebIdentityToken: token,
      DurationSeconds: 3_600,
    }));
    return result.Credentials;
  });
  let cached: TemporaryCredentials | undefined;
  let pending: Promise<TemporaryCredentials> | undefined;

  return async (): Promise<TemporaryCredentials> => {
    const currentTime = now();
    if (cached && cached.expiration.getTime() - refreshSkewMs > currentTime) return cached;
    if (pending) return pending;
    pending = (async () => {
      const token = await tokenFetcher(config.audience);
      validateToken(token, config, now());
      const sessionName = `smart-job-email-${config.subject.slice(-12)}`;
      const credentials = normalizeCredentials(
        await assumeRole(config.roleArn, token, sessionName),
      );
      if (credentials.expiration.getTime() <= now() + refreshSkewMs) {
        throw new Error("AWS STS credentials expire too soon");
      }
      cached = credentials;
      return credentials;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
