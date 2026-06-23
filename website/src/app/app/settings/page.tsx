/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import SettingsClient from "./page-client";

export const metadata = { title: "Settings | Smart-Job" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading settings…" />}>
      <SettingsClient />
    </Suspense>
  );
}
