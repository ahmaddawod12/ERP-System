import { createPublicKey, createVerify } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

function decodeJwtSegment(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
}

function verifySelfSignedServiceAccountJwt(idToken, expectedAudience, options) {
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
    console.warn('Service-account JWT verification failed:', error?.message || error);
    return false;
  }
}

export function createPubSubVerifier(options: {
  cloudRunServiceUrl: string;
  pubsubVerificationToken: string;
  allowedServiceAccounts: string[];
  edgeServiceAccountEmail: string;
  edgeServiceAccountPrivateKey: string;
}) {
  return async function verifyPubSubRequest(req, res, next) {
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
            console.warn('Trusted bearer verification failed:', oidcError.message);
          }
        }
      }
    } else if (!expectedAudience) {
      console.warn('CLOUD_RUN_SERVICE_URL is not set; bearer auth is disabled, using shared token fallback only');
    }

    if (expectedAudience && !bearerVerified) {
      return res.status(401).send('Trusted bearer token required');
    }

    if (!options.pubsubVerificationToken) {
      if (!expectedAudience) {
        console.warn('PUBSUB_VERIFICATION_TOKEN is unset and CLOUD_RUN_SERVICE_URL is not configured; allowing request in non-production mode');
      }
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

