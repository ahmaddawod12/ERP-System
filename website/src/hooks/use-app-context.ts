"use client";

import { useAuth } from "@/hooks/use-auth";

export function useAppContext() {
  const { user, profile, subscription, loading, refreshUserData } = useAuth();

  return {
    user,
    profile,
    subscription,
    loading,
    refreshUserData,
    uid: user?.uid ?? null,
    companyId: profile?.companyId ?? null,
    role: profile?.role ?? null,
    tier: subscription?.tier ?? "Basic",
  };
}
