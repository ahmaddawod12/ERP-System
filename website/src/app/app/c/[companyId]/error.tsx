"use client";

import { AppRouteError } from "@/components/states/app-route-error";

export default function CompanyOverviewError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppRouteError reset={reset} />;
}
