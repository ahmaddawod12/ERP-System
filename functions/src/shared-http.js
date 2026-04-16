const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

function isFunctionsEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true' ||
    !!process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NODE_ENV === 'test' ||
    String(process.env.npm_lifecycle_event || '').startsWith('test');
}

const configuredCorsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

const CORS_ALLOWED_ORIGINS = configuredCorsOrigins.length > 0
  ? configuredCorsOrigins
  : (
    isFunctionsEmulator()
      ? ['http://localhost:3000', 'http://127.0.0.1:3000']
      : (() => {
          logger.warn('CORS_ALLOWED_ORIGINS is empty in production — HTTP endpoints will reject cross-origin requests');
          return [];
        })()
  );

function parseBearerToken(value) {
  const header = String(value || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

async function resolveHttpAuth(req) {
  const token = parseBearerToken(req.get('authorization') || req.headers?.authorization || '');
  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        token: decoded,
        source: 'token',
      };
    } catch (error) {
      if (error.code === 'auth/id-token-revoked') {
        throw new HttpsError('unauthenticated', 'Token has been revoked. Please sign in again.');
      }
      throw new HttpsError('unauthenticated', 'Invalid or expired auth token');
    }
  }

  throw new HttpsError('unauthenticated', 'Missing Authorization bearer token');
}

function sendHttpOk(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function sendHttpError(res, status, code, message, details = undefined) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    payload.error.details = details;
  }
  res.status(status).json(payload);
}

function parseJsonBody(req) {
  if (!req.body) {
    throw new HttpsError('invalid-argument', 'Request body is required');
  }
  return req.body;
}

function httpStatusFromHttpsErrorCode(code) {
  if (code === 'invalid-argument') return 400;
  if (code === 'unauthenticated') return 401;
  if (code === 'permission-denied') return 403;
  if (code === 'not-found') return 404;
  if (code === 'already-exists') return 409;
  if (code === 'failed-precondition') return 412;
  if (code === 'resource-exhausted') return 429;
  if (code === 'unavailable') return 503;
  return 500;
}

function sendCaughtHttpError(res, error) {
  if (error instanceof HttpsError) {
    return sendHttpError(
      res,
      httpStatusFromHttpsErrorCode(error.code),
      error.code,
      error.message,
      error.details
    );
  }

  logger.error('Unhandled HTTP function error', {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });

  return sendHttpError(res, 500, 'internal', 'Unexpected server error');
}

function requireNonEmptyString(value, fieldName, min = 1, max = 2000) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new HttpsError('invalid-argument', `${fieldName} is required`);
  }
  if (trimmed.length < min) {
    throw new HttpsError('invalid-argument', `${fieldName} is too short`);
  }
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', `${fieldName} is too long`);
  }
  return trimmed;
}

function optionalTrimmedString(value, max = 2000) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', 'Field is too long');
  }
  return trimmed;
}

function getClientIp(req) {
  const platformIp = String(req.ip || '').trim();
  if (platformIp) return platformIp;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .pop();
  return forwarded || 'unknown';
}

module.exports = {
  CORS_ALLOWED_ORIGINS,
  isFunctionsEmulator,
  parseBearerToken,
  resolveHttpAuth,
  sendHttpOk,
  sendHttpError,
  parseJsonBody,
  httpStatusFromHttpsErrorCode,
  sendCaughtHttpError,
  requireNonEmptyString,
  optionalTrimmedString,
  getClientIp,
};
