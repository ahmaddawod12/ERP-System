"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { LoadingState } from "@/components/states/loading-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { getCompanyInventory, pickCompanyParts } from "@/lib/services/firestore-service";
import type { InventoryPart } from "@/lib/types";

export default function InventoryPicksClient() {
  const { uid, companyId } = useAppContext();
  const { toast } = useAppToast();
  const [parts, setParts] = useState<InventoryPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!companyId) {
      setParts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const inv = await getCompanyInventory(companyId);
    // Only show active parts for worker picking
    setParts(inv.parts.filter((p) => p.active !== false));
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitPick = async (part: InventoryPart) => {
    if (!companyId || !uid) return;
    const quantity = Number(quantities[part.id] || "0");
    if (!quantity || quantity <= 0) {
      toast({ title: "Quantity required", variant: "error" });
      return;
    }
    await pickCompanyParts(companyId, uid, [
      { id: part.id, name: part.name, quantity },
    ]);
    toast({ title: "Parts picked", description: `${quantity} × ${part.name} added to your inventory`, variant: "success" });
    setQuantities((prev) => ({ ...prev, [part.id]: "" }));
    await load();
  };

  return (
    <ProtectedRoute section="inventoryPicks">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Inventory Picks</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Pick parts from company inventory to add to your personal stock.
          </p>
        </Card>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <DataTable
              data={parts}
              emptyMessage="No company inventory available."
              columns={[
                {
                  key: "part",
                  header: "Part",
                  render: (row) => (
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-slate-500">ID: {row.id}</p>
                    </div>
                  ),
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
                      <Button size="sm" onClick={() => void submitPick(row)}>
                        Pick
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
