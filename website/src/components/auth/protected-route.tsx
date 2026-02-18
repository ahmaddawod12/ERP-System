"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canAccessSection, type AppSection } from "@/lib/access";
import { useAuth } from "@/hooks/use-auth";
import { LoadingState } from "@/components/states/loading-state";

interface ProtectedRouteProps {
  section: AppSection;
  children: React.ReactNode;
}

export function ProtectedRoute({ section, children }: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, subscription, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!profile) {
      router.replace("/onboarding");
      return;
    }
    const tier = subscription?.tier ?? "Basic";
    if (!canAccessSection(profile.role, tier, section)) {
      router.replace("/app/upgrade");
    }
  }, [loading, pathname, profile, router, section, subscription?.tier, user]);

  if (loading || !user || !profile) {
    return <LoadingState label="Checking access..." />;
  }

  const tier = subscription?.tier ?? "Basic";
  const allowed = canAccessSection(profile.role, tier, section);
  if (!allowed) {
    return <LoadingState label="Redirecting..." />;
  }

  return <>{children}</>;
}

