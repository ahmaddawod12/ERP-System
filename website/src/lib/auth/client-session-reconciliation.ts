export type UnauthenticatedSessionResolution<T> =
  | { kind: "superseded" }
  | { kind: "restored"; sessionUser: T }
  | { kind: "clear" };

interface ResolveUnauthenticatedSessionOptions<T> {
  loadSessionUser: () => Promise<T | null>;
  hasClientAuthSession: () => boolean;
  isLogoutInProgress: () => boolean;
}

interface ClearUnauthenticatedSessionOptions {
  clearSession: () => Promise<void>;
  hasClientAuthSession: () => boolean;
  isLogoutInProgress: () => boolean;
}

/**
 * Resolves a provider callback that reported no client-side user.
 *
 * The second transport check is intentional: a sign-in can establish its
 * in-memory transport and server cookie while the existing-session request is
 * still in flight. That newer sign-in must win over the stale callback.
 */
export async function resolveUnauthenticatedSession<T>({
  loadSessionUser,
  hasClientAuthSession,
  isLogoutInProgress,
}: ResolveUnauthenticatedSessionOptions<T>): Promise<UnauthenticatedSessionResolution<T>> {
  if (hasClientAuthSession() || isLogoutInProgress()) {
    return { kind: "superseded" };
  }

  const sessionUser = await loadSessionUser();

  if (hasClientAuthSession() || isLogoutInProgress()) {
    return { kind: "superseded" };
  }

  return sessionUser
    ? { kind: "restored", sessionUser }
    : { kind: "clear" };
}

/**
 * Performs the destructive half of signed-out reconciliation only if the
 * callback is still current at the point of deletion.
 */
export async function clearSessionIfStillUnauthenticated({
  clearSession,
  hasClientAuthSession,
  isLogoutInProgress,
}: ClearUnauthenticatedSessionOptions): Promise<boolean> {
  if (hasClientAuthSession() || isLogoutInProgress()) {
    return false;
  }

  await clearSession();
  return true;
}
