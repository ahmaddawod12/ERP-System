import {
  BusinessProfileSchema,
  CompanyBootstrapSchema,
  ViewerProfileSchema,
  ViewerSchema,
  WorkspaceSummarySchema,
  createApiResponseSchema,
  type BusinessProfile,
  type CompanyBootstrap,
  type Viewer,
  type ViewerProfile,
  type WorkspaceSummary,
} from '@smart-job/api-contracts';
import type { ZodType } from 'zod';

import {
  getSupabaseAccessToken,
  restoreSupabaseSession,
} from '../auth/supabase-client';

const REQUEST_TIMEOUT_MS = 12_000;
const tenantControllers = new Map<string, Set<AbortController>>();
const userControllers = new Map<string, Set<AbortController>>();

export const AUTH_IDENTITY_CHANGED_CODE = 'AUTH_IDENTITY_CHANGED' as const;

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function apiBaseUrl(): URL {
  const raw = String(process.env.EXPO_PUBLIC_BACKEND_API_BASE_URL || '').trim();
  if (!raw) {
    throw new ApiClientError(
      'The backend API URL is not configured',
      0,
      'API_NOT_CONFIGURED',
      false,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiClientError(
      'The backend API URL is invalid',
      0,
      'API_URL_INVALID',
      false,
    );
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '10.0.2.2', '::1']);
  if (
    parsed.protocol !== 'https:'
    && !(parsed.protocol === 'http:' && __DEV__ && localHttpHosts.has(parsed.hostname))
  ) {
    throw new ApiClientError(
      'The backend API must use HTTPS outside local development',
      0,
      'API_URL_INSECURE',
      false,
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function apiRequestUrl(path: string): URL {
  if (!/^\/api\/v1(?:\/|$)/.test(path) || path.includes('#')) {
    throw new ApiClientError(
      'The backend API path must be a relative /api/v1 path',
      0,
      'API_PATH_INVALID',
      false,
    );
  }

  const base = apiBaseUrl();
  const basePath = base.pathname.replace(/\/+$/, '');
  const baseHref = base.href.endsWith('/') ? base.href : `${base.href}/`;
  const resolved = new URL(path.slice(1), baseHref);
  const expectedPath = `${basePath}/api/v1`;
  if (
    resolved.origin !== base.origin
    || (resolved.pathname !== expectedPath && !resolved.pathname.startsWith(`${expectedPath}/`))
  ) {
    throw new ApiClientError(
      'The backend API path escaped the configured API origin',
      0,
      'API_PATH_INVALID',
      false,
    );
  }
  return resolved;
}

function tenantKey(uid: string, companyId: number): string {
  return `${uid}:${companyId}`;
}

function normalizedUserId(uid: string): string {
  return uid.trim().toLowerCase();
}

function addController(
  controllersByKey: Map<string, Set<AbortController>>,
  key: string,
  controller: AbortController,
): () => void {
  const controllers = controllersByKey.get(key) ?? new Set<AbortController>();
  controllers.add(controller);
  controllersByKey.set(key, controllers);
  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) {
      controllersByKey.delete(key);
    }
  };
}

function registerTenantController(
  uid: string | undefined,
  companyId: number | undefined,
  controller: AbortController,
): () => void {
  if (!uid || companyId === undefined) {
    if (!uid) {
      return () => undefined;
    }
    return addController(userControllers, normalizedUserId(uid), controller);
  }
  const normalizedUid = normalizedUserId(uid);
  const unregisterUser = addController(userControllers, normalizedUid, controller);
  const unregisterTenant = addController(
    tenantControllers,
    tenantKey(normalizedUid, companyId),
    controller,
  );
  return () => {
    unregisterTenant();
    unregisterUser();
  };
}

export function cancelTenantRequests(uid: string, companyId: number): void {
  const key = tenantKey(normalizedUserId(uid), companyId);
  const controllers = tenantControllers.get(key);
  if (!controllers) {
    return;
  }
  for (const controller of controllers) {
    controller.abort();
  }
  tenantControllers.delete(key);
}

export function cancelUserRequests(uid: string): void {
  const key = normalizedUserId(uid);
  const controllers = userControllers.get(key);
  if (!controllers) {
    return;
  }
  for (const controller of controllers) {
    controller.abort(AUTH_IDENTITY_CHANGED_CODE);
  }
  userControllers.delete(key);
}

function identityChangedError(): ApiClientError {
  return new ApiClientError(
    'The authenticated user changed while preparing the request',
    401,
    AUTH_IDENTITY_CHANGED_CODE,
    false,
  );
}

async function getIdentityBoundAccessToken(expectedUid?: string): Promise<string | null> {
  if (!expectedUid) {
    return getSupabaseAccessToken(true);
  }

  const normalizedExpectedUid = normalizedUserId(expectedUid);
  const beforeRefresh = await restoreSupabaseSession();
  if (normalizedUserId(beforeRefresh?.user.id ?? '') !== normalizedExpectedUid) {
    throw identityChangedError();
  }

  await getSupabaseAccessToken(true);
  const afterRefresh = await restoreSupabaseSession();
  if (
    normalizedUserId(afterRefresh?.user.id ?? '') !== normalizedExpectedUid
    || !afterRefresh?.access_token
  ) {
    throw identityChangedError();
  }
  return afterRefresh.access_token;
}

interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly uid?: string;
  readonly companyId?: number;
}

export async function requestApi<T>(
  path: string,
  dataSchema: ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const requestUrl = apiRequestUrl(path);
  const controller = new AbortController();
  const unregister = registerTenantController(
    options.uid,
    options.companyId,
    controller,
  );
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const token = await getIdentityBoundAccessToken(options.uid);
    if (!token) {
      throw new ApiClientError('Authentication is required', 401, 'AUTH_REQUIRED', false);
    }
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    });
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    const response = await fetch(requestUrl, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    const parsed = createApiResponseSchema(dataSchema).safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError(
        'The backend returned an invalid response',
        response.status,
        'INVALID_API_RESPONSE',
        response.status >= 500,
      );
    }
    if (!parsed.data.ok) {
      throw new ApiClientError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code,
        parsed.data.error.retryable,
      );
    }
    if (!response.ok) {
      throw new ApiClientError(
        'The backend rejected the request',
        response.status,
        'HTTP_ERROR',
        response.status >= 500,
      );
    }
    return parsed.data.data;
  } catch (error) {
    if (
      controller.signal.aborted
      && controller.signal.reason === AUTH_IDENTITY_CHANGED_CODE
    ) {
      throw identityChangedError();
    }
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ApiClientError(
        'The request timed out or was cancelled',
        0,
        'REQUEST_ABORTED',
        true,
      );
    }
    throw new ApiClientError('Network request failed', 0, 'NETWORK_ERROR', true);
  } finally {
    clearTimeout(timeout);
    unregister();
  }
}

export function fetchViewer(uid: string): Promise<Viewer> {
  return requestApi('/api/v1/me', ViewerSchema, { uid });
}

export function fetchViewerProfile(
  uid: string,
  companyId?: number | null,
): Promise<ViewerProfile> {
  const path = companyId
    ? `/api/v1/me/profile?companyId=${encodeURIComponent(String(companyId))}`
    : '/api/v1/me/profile';
  return requestApi(path, ViewerProfileSchema, {
    uid,
    companyId: companyId ?? undefined,
  });
}

export function fetchWorkspaces(uid: string): Promise<WorkspaceSummary[]> {
  return requestApi('/api/v1/workspaces', WorkspaceSummarySchema.array(), { uid });
}

export function fetchCompanyBootstrap(
  uid: string,
  companyId: number,
): Promise<CompanyBootstrap> {
  return requestApi(
    `/api/v1/companies/${companyId}/bootstrap`,
    CompanyBootstrapSchema,
    { uid, companyId },
  );
}

export function fetchBusinessProfile(
  uid: string,
  companyId: number,
): Promise<BusinessProfile> {
  return requestApi(
    `/api/v1/companies/${companyId}/profile`,
    BusinessProfileSchema,
    { uid, companyId },
  );
}
