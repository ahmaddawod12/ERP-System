"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";
import {
  getCurrentAuthUserSnapshot,
  getCurrentAccessToken,
  getCurrentAuthUser,
  hasClientAuthSession,
  isLogoutInProgress,
  isSessionTokenSynced,
  markSessionTokenSynced,
  signOutConfiguredProvider,
  subscribeConfiguredAuthState,
  type ClientAuthUser,
} from "@/lib/firebase/client-auth";
import {
  clearSessionIfStillUnauthenticated,
  resolveUnauthenticatedSession,
} from "@/lib/auth/client-session-reconciliation";
import type { UserProfile, UserSubscription } from "@/lib/types";

interface AuthContextValue {
  user: ClientAuthUser | null;
  profile: UserProfile | null;
  subscription: UserSubscription | null;
  loading: boolean;
  refreshUserData: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const APP_ROLES = new Set(["manager", "worker", "user", "basic", "dev"]);

function normalizeRoleValue(role: unknown): UserProfile["role"] {
  const raw = String(role ?? "").trim().toLowerCase();
  return APP_ROLES.has(raw) ? (raw as UserProfile["role"]) : "basic";
}

function normalizeProfile(profile: UserProfile | null): UserProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    role: normalizeRoleValue(profile.role),
  };
}

async function loadUserProfile() {
  const response = await fetch("/api/read-model", {
    method: "POST",
    headers: await buildAuthedJsonHeaders(),
    body: JSON.stringify({ kind: "bootstrap", includeCollections: false }),
    credentials: "include",
  });

  const payload = (await response.json()) as {
    ok: boolean;
    data?: { profile: UserProfile | null; subscription: UserSubscription | null };
  };

  if (!response.ok || !payload.ok || !payload.data) {
    return { profile: null, subscription: null };
  }

  return {
    profile: normalizeProfile(payload.data.profile),
    subscription: payload.data.subscription ?? null,
  };
}

async function syncAuthSession(token: string | null) {
  if (!token) {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" }).catch(() => {});
    markSessionTokenSynced(null);
    return;
  }
  if (isSessionTokenSynced(token)) {
    return;
  }
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  }).catch(() => null);
  if (!response?.ok) {
    throw new Error("Failed to sync authenticated session");
  }
  markSessionTokenSynced(token);
}

async function loadSessionUser(): Promise<ClientAuthUser | null> {
  if (isLogoutInProgress()) {
    return null;
  }
  const response = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    session?: { uid?: unknown; email?: unknown };
  } | null;
  if (!response.ok || !payload?.ok || !payload.session?.uid) {
    return null;
  }
  return {
    uid: String(payload.session.uid),
    email: typeof payload.session.email === "string" ? payload.session.email : null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ClientAuthUser | null>(getCurrentAuthUser());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUserData = useCallback(async () => {
    if (!getCurrentAuthUserSnapshot()) {
      setProfile(null);
      setSubscription(null);
      return;
    }
    try {
      const result = await loadUserProfile();
      setProfile(result.profile);
      setSubscription(result.subscription);
    } catch {
      setProfile(null);
      setSubscription(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (isLogoutInProgress()) {
        setLoading(false);
        return;
      }
      if (hasClientAuthSession()) {
        return;
      }
      const sessionUser = await loadSessionUser().catch(() => null);
      if (!sessionUser) {
        setLoading(false);
        return;
      }
      setUser(sessionUser);
      try {
        const result = await loadUserProfile();
        setProfile(result.profile);
        setSubscription(result.subscription);
      } catch {
        setProfile(null);
        setSubscription(null);
      } finally {
        setLoading(false);
      }
    })();

    return subscribeConfiguredAuthState(async (nextUser) => {
      try {
        // An earlier unauthenticated callback can finish after sign-in has
        // established the in-memory transport. Do not let it publish a stale
        // signed-out state over the new session.
        if (!nextUser && hasClientAuthSession()) {
          return;
        }
        setLoading(true);
        setUser(nextUser);
        if (nextUser) {
          const token = await getCurrentAccessToken(true);
          await syncAuthSession(token);
          try {
            const result = await loadUserProfile();
            setProfile(result.profile);
            setSubscription(result.subscription);
          } catch {
            setProfile(null);
            setSubscription(null);
          }
        } else {
          const resolution = await resolveUnauthenticatedSession({
            loadSessionUser: () => loadSessionUser().catch(() => null),
            hasClientAuthSession,
            isLogoutInProgress,
          });
          if (resolution.kind === "superseded") {
            return;
          }
          if (resolution.kind === "restored") {
            setUser(resolution.sessionUser);
            try {
              const result = await loadUserProfile();
              setProfile(result.profile);
              setSubscription(result.subscription);
            } catch {
              setProfile(null);
              setSubscription(null);
            }
            return;
          }
          const cleared = await clearSessionIfStillUnauthenticated({
            clearSession: () => syncAuthSession(null),
            hasClientAuthSession,
            isLogoutInProgress,
          });
          if (!cleared) {
            return;
          }
          setProfile(null);
          setSubscription(null);
        }
      } catch {
        if (!nextUser) {
          await clearSessionIfStillUnauthenticated({
            clearSession: () => syncAuthSession(null),
            hasClientAuthSession,
            isLogoutInProgress,
          });
        }
        setProfile(null);
        setSubscription(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    setUser(null);
    setProfile(null);
    setSubscription(null);
    await syncAuthSession(null);
    await signOutConfiguredProvider();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      subscription,
      loading,
      refreshUserData,
      logout,
    }),
    [user, profile, subscription, loading, refreshUserData, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return ctx;
}
