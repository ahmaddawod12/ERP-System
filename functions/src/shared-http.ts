import { HttpsError } from 'firebase-functions/v2/https';
import admin from 'firebase-admin';
import logger from 'firebase-functions/logger';

type RequestLike = {
  body?: unknown;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  get(name: string): string | undefined;
};

type ResponseLike = {
  status(code: number): ResponseLike;
  json(payload: unknown): void;
};

type AuthResult = {
  uid: string;
  token: unknown;
  source: 'token';
};

type HttpErrorPayload = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function isFunctionsEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' ||
    !!process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NODE_ENV === 'test' ||
    String(process.env.npm_lifecycle_event || '').startsWith('test');
}

const configuredCorsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

export const CORS_ALLOWED_ORIGINS = configuredCorsOrigins.length > 0
  ? configuredCorsOrigins
  : (
    isFunctionsEmulator()
      ? ['http://localhost:3000', 'http://127.0.0.1:3000']
      : (() => {
          logger.warn('CORS_ALLOWED_ORIGINS is empty in production — HTTP endpoints will reject cross-origin requests');
          return [];
        })()
  );

export function parseBearerToken(value: unknown): string {
  const header = String(value || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

export async function resolveHttpAuth(req: RequestLike): Promise<AuthResult> {
  const authorizationHeader = req.get('authorization') || req.headers?.authorization || '';
  const token = parseBearerToken(Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader);
  if (token) {
    try {
      const decoded = await admin.auth().verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        token: decoded,
        source: 'token',
      };
    } catch (error: any) {
      if (error.code === 'auth/id-token-revoked') {
        throw new HttpsError('unauthenticated', 'Token has been revoked. Please sign in again.');
      }
      throw new HttpsError('unauthenticated', 'Invalid or expired auth token');
    }
  }

  throw new HttpsError('unauthenticated', 'Missing Authorization bearer token');
}

export function sendHttpOk(res: ResponseLike, data: unknown, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function sendHttpError(
  res: ResponseLike,
  status: number,
  code: string,
  message: string,
  details: unknown = undefined,
): void {
  const payload: HttpErrorPayload = {
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

export function parseJsonBody(req: RequestLike): unknown {
  if (!req.body) {
    throw new HttpsError('invalid-argument', 'Request body is required');
  }
  return req.body;
}

export function httpStatusFromHttpsErrorCode(code: string): number {
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

export function sendCaughtHttpError(res: ResponseLike, error: unknown): void {
  if (error instanceof HttpsError) {
    sendHttpError(
      res,
      httpStatusFromHttpsErrorCode(error.code),
      error.code,
      error.message,
      error.details,
    );
    return;
  }

  logger.error('Unhandled HTTP function error', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack || null : null,
  });

  sendHttpError(res, 500, 'internal', 'Unexpected server error');
}

export function requireNonEmptyString(value: unknown, fieldName: string, min = 1, max = 2000): string {
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

export function optionalTrimmedString(value: unknown, max = 2000): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > max) {
    throw new HttpsError('invalid-argument', 'Field is too long');
  }
  return trimmed;
}

export function getClientIp(req: RequestLike): string {
  const platformIp = String(req.ip || '').trim();
  if (platformIp) return platformIp;
  const forwardedHeader = req.headers?.['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : String(forwardedHeader || '');
  const forwarded = forwardedValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .pop();
  return forwarded || 'unknown';
}