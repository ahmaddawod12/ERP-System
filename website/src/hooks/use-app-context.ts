"use client";

import { useAuth } from "@/hooks/use-auth";

export function useAppContext() {
  const { user, profile, subscription, loading, refreshUserData } = useAuth();

  const role = profile?.role ?? null;
  // Dev role gets full access (Enterprise tier) even without a subscription record
  const tier = role === "dev" ? "Enterprise" : (subscription?.tier ?? "Basic");

  return {
    user,
    profile,
    subscription,
    loading,
    refreshUserData,
    uid: user?.uid ?? null,
    companyId: profile?.companyId ?? null,
    role,
    tier,
  };
}
