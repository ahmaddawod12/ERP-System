/**
 * N1: Server component wrapper.
 * Client logic lives in page-client.tsx.
 */
import { Suspense } from "react";
import { LoadingState } from "@/components/states/loading-state";
import InventoryPicksClient from "./page-client";

export const metadata = { title: "Inventory Picks | Smart-Job" };

export default function InventoryPicksPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading picks…" />}>
      <InventoryPicksClient />
    </Suspense>
  );
}
