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
  getCurrentAccessToken,
  getCurrentAuthUser,
  signOutConfiguredProvider,
  subscribeConfiguredAuthState,
  type ClientAuthUser,
} from "@/lib/firebase/client-auth";
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
    return;
  }
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ClientAuthUser | null>(getCurrentAuthUser());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUserData = useCallback(async () => {
    if (!getCurrentAuthUser()) {
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
    return subscribeConfiguredAuthState(async (nextUser) => {
      try {
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
          await syncAuthSession(null);
          setProfile(null);
          setSubscription(null);
        }
      } catch {
        if (!nextUser) {
          await syncAuthSession(null);
        }
        setProfile(null);
        setSubscription(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const logout = useCallback(async () => {
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
