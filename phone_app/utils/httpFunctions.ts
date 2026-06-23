import { app, getSupabaseAuthTransportToken } from '../firebase';
import type { HttpFunctionOptions } from '../types';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getEdgeBaseUrl(): string {
  const explicitBase = process.env.EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL;
  if (explicitBase) {
    return trimTrailingSlash(explicitBase);
  }

  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL for edge function calls');
  }
  return `${trimTrailingSlash(supabaseUrl)}/functions/v1`;
}

function getEdgePath(functionName: string): string {
  const mapping: Record<string, string> = {
    readModelV1: 'read-model',
    mutationGatewayV1: 'mutation-gateway',
    mutationGatewayMeWest1V1: 'mutation-gateway-me-west1',
    createInviteV1: 'invites-create',
    joinCompanyV1: 'invites-join',
    requestUpgradeV1: 'upgrades-request',
    listUpgradeRequestsV1: 'upgrades-list',
    moderateUpgradeRequestV1: 'upgrades-moderate',
    contactRequestV1: 'contact-request',
  };
  return mapping[functionName] || functionName;
}

function getFunctionUrl(functionName: string): string {
  return `${getEdgeBaseUrl()}/${getEdgePath(functionName)}`;
}

export async function callHttpFunction<T = unknown>(
  functionName: string,
  body?: unknown,
  options: HttpFunctionOptions = {},
): Promise<T> {
  const { requireAuth = true, signal } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (requireAuth) {
    const supabaseToken = await getSupabaseAuthTransportToken(true);
    if (!supabaseToken) {
      throw new Error('User must be authenticated');
    }
    headers.Authorization = `Bearer ${supabaseToken}`;
  }

  let response: Response;
  try {
    response = await fetch(getFunctionUrl(functionName), {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal,
    });
  } catch (error) {
    throw new Error('Failed to reach backend function');
  }

  let payload: { ok: boolean; data?: T; error?: { message: string } };
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('Backend returned invalid JSON');
  }

  if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean') {
    throw new Error('Backend returned an invalid response payload');
  }

  if (!response.ok || payload.ok !== true) {
    throw new Error(payload?.error?.message || 'Function call failed');
  }

  return payload.data as T;
}
