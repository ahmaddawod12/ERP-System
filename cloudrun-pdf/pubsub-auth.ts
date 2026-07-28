import { createPublicKey, createVerify } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

type JwtClaims = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeJwtSegment(segment: string): JwtClaims {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const parsed: unknown = JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('JWT segment must contain a JSON object');
  }
  return parsed as JwtClaims;
}

type PubSubVerifierOptions = {
  cloudRunServiceUrl: string;
  pubsubVerificationToken: string;
  allowedServiceAccounts: string[];
  edgeServiceAccountEmail: string;
  edgeServiceAccountPrivateKey: string;
};

function verifySelfSignedServiceAccountJwt(
  idToken: string,
  expectedAudience: string,
  options: PubSubVerifierOptions,
): boolean {
  if (!options.edgeServiceAccountEmail || !options.edgeServiceAccountPrivateKey || !expectedAudience) {
    return false;
  }

  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    return false;
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJwtSegment(encodedHeader);
    const payload = decodeJwtSegment(encodedPayload);
    if (String(header?.alg || '') !== 'RS256') {
      return false;
    }

    const signer = String(payload?.iss || payload?.sub || '').trim().toLowerCase();
    const audience = String(payload?.aud || '').trim();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Number(payload?.exp || 0);
    const issuedAt = Number(payload?.iat || 0);
    if (!signer || signer !== options.edgeServiceAccountEmail) {
      return false;
    }
    if (audience !== expectedAudience) {
      return false;
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds - 30) {
      return false;
    }
    if (Number.isFinite(issuedAt) && issuedAt > nowSeconds + 30) {
      return false;
    }
    if (options.allowedServiceAccounts.length === 0) {
      console.warn('PUBSUB_ALLOWED_SERVICE_ACCOUNTS is empty — rejecting service-account JWT (fail closed)');
      return false;
    }
    if (!options.allowedServiceAccounts.includes(signer)) {
      console.warn('Service-account JWT rejected by allowlist', { signer });
      return false;
    }

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    const signature = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return verifier.verify(createPublicKey(options.edgeServiceAccountPrivateKey), signature);
  } catch (error) {
    console.warn('Service-account JWT verification failed:', errorMessage(error));
    return false;
  }
}

export function createPubSubVerifier(options: PubSubVerifierOptions) {
  return async function verifyPubSubRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<unknown> {
    const expectedAudience = options.cloudRunServiceUrl;

    let bearerVerified = false;
    const authHeader = req.headers['authorization'] || '';
    if (expectedAudience && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.slice('Bearer '.length).trim();
      if (idToken) {
        try {
          const client = new OAuth2Client();
          const ticket = await client.verifyIdToken({
            idToken,
            audience: expectedAudience,
          });
          const payload = ticket.getPayload();
          const issuer = String(payload?.iss || '');
          const email = String(payload?.email || '').toLowerCase();
          const issuerValid = issuer === 'https://accounts.google.com' || issuer === 'accounts.google.com';
          const emailValid = Boolean(payload?.email_verified) && email.length > 0;
          if (options.allowedServiceAccounts.length === 0) {
            console.warn('PUBSUB_ALLOWED_SERVICE_ACCOUNTS is empty — rejecting OIDC token (fail closed)');
            return res.status(403).send('Service account allowlist not configured');
          }
          const serviceAccountAllowed = options.allowedServiceAccounts.includes(email);

          if (issuerValid && emailValid && serviceAccountAllowed) {
            bearerVerified = true;
          } else {
            console.warn('OIDC JWT rejected by claim validation', {
              issuer,
              email,
              hasAllowlist: options.allowedServiceAccounts.length > 0,
            });
          }
        } catch (oidcError) {
          const selfSignedVerified = verifySelfSignedServiceAccountJwt(idToken, expectedAudience, options);
          if (selfSignedVerified) {
            bearerVerified = true;
          } else {
            console.warn('Trusted bearer verification failed:', errorMessage(oidcError));
          }
        }
      }
    } else if (!expectedAudience) {
      console.warn('CLOUD_RUN_SERVICE_URL is not set; bearer auth is disabled, using shared token fallback only');
    }

    if (expectedAudience && !bearerVerified) {
      return res.status(401).send('Trusted bearer token required');
    }

    // Fail closed: at least one authentication method must be configured.
    if (!expectedAudience && !options.pubsubVerificationToken) {
      console.error('Pub/Sub verifier is not configured: set CLOUD_RUN_SERVICE_URL or PUBSUB_VERIFICATION_TOKEN');
      return res.status(403).send('Pub/Sub authentication not configured');
    }

    if (!options.pubsubVerificationToken) {
      // Bearer verification already succeeded above; shared token layer is not configured.
      return next();
    }

    const token = String(req.headers['x-pubsub-token'] || '').trim();
    if (token !== options.pubsubVerificationToken) {
      console.warn('Rejected unauthenticated Pub/Sub request', {
        hasHeader: !!req.headers['x-pubsub-token'],
        hasOidc: !!authHeader,
        ip: req.ip,
      });
      return res.status(401).send('Unauthorized');
    }

    return next();
  };
}
