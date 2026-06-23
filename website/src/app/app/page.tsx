/**
 * N1: Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import AppOverviewClient from "./page-client";

export const metadata = { title: "Dashboard | Smart-Job" };

export default function AppOverviewPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading dashboard…" />}>
      <AppOverviewClient />
    </Suspense>
  );
}
