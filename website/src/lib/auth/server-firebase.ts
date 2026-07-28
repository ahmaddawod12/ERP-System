/**
 * Server-only Firebase Authentication REST helpers.
 *
 * Firebase credentials remain outside browser JavaScript. The website BFF
 * uses the project's Web API key only for Identity Toolkit operations.
 */
const MAX_AUTH_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_AUTH_TIMEOUT_MS = 8_000;

type FirebaseAuthResponse = {
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
  email?: string;
  requestType?: string;
  error?: { message?: string };
};

function config() {
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || "").trim();
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) {
    throw new Error("Firebase Authentication is not configured");
  }
  const configuredTimeout = Number(
    process.env.FIREBASE_AUTH_TIMEOUT_MS || DEFAULT_AUTH_TIMEOUT_MS,
  );
  const timeoutMs = Number.isSafeInteger(configuredTimeout)
    ? Math.min(12_000, Math.max(1_000, configuredTimeout))
    : DEFAULT_AUTH_TIMEOUT_MS;
  const emulatorHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "").trim();
  const baseUrl = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com`
    : "https://identitytoolkit.googleapis.com";
  return { apiKey, timeoutMs, baseUrl };
}

async function boundedJson(response: Response): Promise<FirebaseAuthResponse> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_AUTH_RESPONSE_BYTES) {
    throw new Error("Authentication response exceeded the safe size limit");
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_AUTH_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Authentication response exceeded the safe size limit");
    }
    chunks.push(part.value);
  }
  if (total === 0) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as FirebaseAuthResponse;
  } catch {
    return {};
  }
}

async function post(path: string, body: Record<string, unknown>): Promise<FirebaseAuthResponse> {
  const { apiKey, timeoutMs, baseUrl } = config();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Firebase Auth request timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    const response = await fetch(`${baseUrl}/v1/${path}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await boundedJson(response);
    if (!response.ok) {
      throw new Error(String(payload.error?.message || "Authentication request failed"));
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function serverSignUp(
  email: string,
  password: string,
  continueUrl: string,
): Promise<void> {
  const created = await post("accounts:signUp", {
    email,
    password,
    returnSecureToken: true,
  });
  if (!created.idToken) throw new Error("Firebase did not create an authenticated account");
  await post("accounts:sendOobCode", {
    requestType: "VERIFY_EMAIL",
    idToken: created.idToken,
    continueUrl,
  });
}

export async function serverSendPasswordReset(
  email: string,
  continueUrl: string,
): Promise<void> {
  await post("accounts:sendOobCode", {
    requestType: "PASSWORD_RESET",
    email,
    continueUrl,
  });
}

export async function serverConfirmEmail(actionCode: string): Promise<void> {
  await post("accounts:update", { oobCode: actionCode });
}

export async function serverVerifyPasswordResetCode(actionCode: string): Promise<void> {
  const result = await post("accounts:resetPassword", { oobCode: actionCode });
  if (result.requestType !== "PASSWORD_RESET") {
    throw new Error("The password reset code is invalid");
  }
}

export async function serverResetPassword(
  actionCode: string,
  password: string,
): Promise<void> {
  await post("accounts:resetPassword", {
    oobCode: actionCode,
    newPassword: password,
  });
}
