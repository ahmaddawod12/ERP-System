"use client";

import { AppRouteError } from "@/components/states/app-route-error";

export default function TenantUpgradeError({ reset }: { reset: () => void }) {
  return <AppRouteError title="Upgrade page unavailable" reset={reset} />;
}
