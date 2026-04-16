"use client";

import { getSubscriptionTierForRole } from "@smart-job/contracts";
import { useAuth } from "@/hooks/use-auth";

export function useAppContext() {
  const { user, profile, subscription, loading, refreshUserData } = useAuth();

  const role = profile?.role ?? null;
  const tier = role
    ? (subscription?.tier ?? getSubscriptionTierForRole(role, profile?.accountType))
    : "Basic";

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
