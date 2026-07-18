import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

import type { EmailWorkerConfig } from "./config.js";

function sameToken(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createPubSubAuthorizer(config: EmailWorkerConfig["pubsub"]) {
  const oauth = new OAuth2Client();
  return async (authorization: string | undefined, sharedToken: string | undefined): Promise<boolean> => {
    if (config.audience) {
      if (!authorization?.startsWith("Bearer ")) return false;
      try {
        const ticket = await oauth.verifyIdToken({
          idToken: authorization.slice("Bearer ".length).trim(),
          audience: config.audience,
        });
        const payload = ticket.getPayload();
        const issuer = String(payload?.iss ?? "");
        const email = String(payload?.email ?? "").toLowerCase();
        if ((issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com")
            || payload?.email_verified !== true
            || !config.allowedServiceAccounts.includes(email)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    if (config.sharedToken && !sameToken(sharedToken ?? "", config.sharedToken)) return false;
    return Boolean(config.audience || config.sharedToken);
  };
}
