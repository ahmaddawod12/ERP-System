/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import InventoryClient from "./page-client";

export const metadata = { title: "Inventory | Smart-Job" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading inventory…" />}>
      <InventoryClient />
    </Suspense>
  );
}
