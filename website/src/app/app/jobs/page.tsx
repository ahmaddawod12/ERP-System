/**
 * N1: Server component wrapper — exports static metadata and Suspense boundary.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import JobsClient from "./page-client";

export const metadata = { title: "Jobs | Smart-Job" };

export default function JobsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading jobs…" />}>
      <JobsClient />
    </Suspense>
  );
}
