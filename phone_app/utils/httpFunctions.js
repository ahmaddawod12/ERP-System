import { app, auth } from '../firebase';

const DEFAULT_REGION = 'us-central1';

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getProjectId() {
  const projectId = app?.options?.projectId;
  if (!projectId) {
    throw new Error('Missing Firebase projectId in app configuration');
  }
  return projectId;
}

function getFunctionsBaseUrl() {
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

function getFunctionUrl(functionName) {
  return `${getFunctionsBaseUrl()}/${functionName}`;
}

export async function callHttpFunction(functionName, body, options = {}) {
  const { requireAuth = true } = options;
  const headers = { 'Content-Type': 'application/json' };

  if (requireAuth) {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated');
    }
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(getFunctionUrl(functionName), {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
  } catch (error) {
    throw new Error('Failed to reach backend function');
  }

  let payload;
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

  return payload.data;
}
