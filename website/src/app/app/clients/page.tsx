/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import ClientsClient from "./page-client";

export const metadata = { title: "Clients | Smart-Job" };

export default function ClientsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading clients…" />}>
      <ClientsClient />
    </Suspense>
  );
}
