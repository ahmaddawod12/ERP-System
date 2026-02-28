/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import AdminClient from "./page-client";

export const metadata = { title: "Admin | Smart-Job" };

export default function AdminPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading admin…" />}>
      <AdminClient />
    </Suspense>
  );
}
