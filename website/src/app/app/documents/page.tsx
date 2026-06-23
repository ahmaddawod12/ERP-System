/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import DocumentsClient from "./page-client";

export const metadata = { title: "Documents | Smart-Job" };

export default function DocumentsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading documents…" />}>
      <DocumentsClient />
    </Suspense>
  );
}
