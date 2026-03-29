import { app, auth } from '../firebase';
import type { HttpFunctionOptions } from '../types';

const DEFAULT_REGION = 'us-central1';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getProjectId(): string {
  const projectId = (app as { options?: { projectId?: string } })?.options?.projectId;
  if (!projectId) {
    throw new Error('Missing Firebase projectId in app configuration');
  }
  return projectId;
}

function getFunctionsBaseUrl(): string {
  const explicitBase = process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL;
  if (explicitBase) {
    return trimTrailingSlash(explicitBase);
  }

  const region = process.env.EXPO_PUBLIC_FUNCTIONS_REGION || DEFAULT_REGION;
  const projectId = getProjectId();
  const emulatorOrigin = process.env.EXPO_PUBLIC_FUNCTIONS_EMULATOR_ORIGIN;

  if (__DEV__ && emulatorOrigin) {
    return `${trimTrailingSlash(emulatorOrigin)}/${projectId}/${region}`;
  }

  return `https://${region}-${projectId}.cloudfunctions.net`;
}

function getFunctionUrl(functionName: string): string {
  return `${getFunctionsBaseUrl()}/${functionName}`;
}

export async function callHttpFunction<T = unknown>(
  functionName: string,
  body?: unknown,
  options: HttpFunctionOptions = {},
): Promise<T> {
  const { requireAuth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (requireAuth) {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated');
    }
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(getFunctionUrl(functionName), {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
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
