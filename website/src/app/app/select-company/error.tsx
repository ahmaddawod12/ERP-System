"use client";

import { AppRouteError } from "@/components/states/app-route-error";

export default function WorkspaceSelectionError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppRouteError reset={reset} title="We could not load your workspaces" />;
}
