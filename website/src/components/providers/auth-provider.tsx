"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import type { UserProfile, UserSubscription } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
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
  return APP_ROLES.has(raw) ? (raw as UserProfile["role"]) : "user";
}

function normalizeProfile(profile: UserProfile | null): UserProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    role: normalizeRoleValue(profile.role),
  };
}

async function loadUserProfile(uid: string) {
  const profileRef = doc(db, "users", uid, "data", "profile");
  const profileSnap = await getDoc(profileRef);
  const profile = profileSnap.exists()
    ? normalizeProfile(profileSnap.data() as UserProfile)
    : null;
  if (!profile) {
    return { profile: null, subscription: null };
  }

  const companyIdForSubscription = profile.companyId ?? uid;
  const subscriptionRef = doc(db, "companies", companyIdForSubscription, "business_data", "subscription");
  const subscriptionSnap = await getDoc(subscriptionRef);

  return {
    profile,
    subscription: subscriptionSnap.exists()
      ? (subscriptionSnap.data() as UserSubscription)
      : null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUserData = useCallback(async () => {
    if (!auth.currentUser) {
      setProfile(null);
      setSubscription(null);
      return;
    }
    try {
      const result = await loadUserProfile(auth.currentUser.uid);
      setProfile(result.profile);
      setSubscription(result.subscription);
    } catch {
      setProfile(null);
      setSubscription(null);
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      try {
        setLoading(true);
        setUser(nextUser);
        if (nextUser) {
          const result = await loadUserProfile(nextUser.uid);
          setProfile(result.profile);
          setSubscription(result.subscription);
        } else {
          setProfile(null);
          setSubscription(null);
        }
      } catch {
        setProfile(null);
        setSubscription(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
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
