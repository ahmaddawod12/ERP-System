"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { LoadingState } from "@/components/states/loading-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { addInventoryPick, listCompanyInventory } from "@/lib/services/firestore-service";
import type { InventoryItem } from "@/lib/types";

export default function InventoryPicksPage() {
  const { uid, companyId } = useAppContext();
  const { toast } = useAppToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const result = await listCompanyInventory(companyId);
    setItems(result);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitPick = async (itemId: string) => {
    if (!companyId || !uid) return;
    const quantity = Number(quantities[itemId] || "0");
    if (!quantity || quantity <= 0) {
      toast({ title: "Quantity required", variant: "error" });
      return;
    }
    await addInventoryPick(companyId, uid, { itemId, quantity });
    toast({ title: "Pick recorded", description: `${quantity} item(s) allocated`, variant: "success" });
    setQuantities((prev) => ({ ...prev, [itemId]: "" }));
    await load();
  };

  return (
    <ProtectedRoute section="inventoryPicks">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Inventory Picks</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Workers can reserve and consume parts from company inventory.
          </p>
        </Card>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <DataTable
              data={items}
              emptyMessage="No company inventory available."
              columns={[
                {
                  key: "part",
                  header: "Part",
                  render: (row) => (
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.sku || "No SKU"}</p>
                    </div>
                  ),
                },
                {
                  key: "quantity",
                  header: "Current Qty",
                  render: (row) => row.quantity,
                },
                {
                  key: "pick",
                  header: "Pick Qty",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={quantities[row.id] ?? ""}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [row.id]: event.target.value,
                          }))
                        }
                        className="h-8 w-20 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                      <Button size="sm" onClick={() => void submitPick(row.id)}>
                        Use
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </section>
    </ProtectedRoute>
  );
}
