/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import WorkersClient from "./page-client";

export const metadata = { title: "Workers | Smart-Job" };

export default function WorkersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading workers…" />}>
      <WorkersClient />
    </Suspense>
  );
}
