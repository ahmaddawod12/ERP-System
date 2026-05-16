"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, PackagePlus, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { getCompanyInventory, pickCompanyParts } from "@/lib/services/backend-service";
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
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Inventory picks
              </p>
              <h1 className="dashboard-title mt-5">Pick parts into personal stock</h1>
              <p className="dashboard-copy mt-4">
                Pick parts from company inventory to add to your personal stock.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[18rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Available parts</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{parts.length}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Mode</p>
                <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">Worker pick</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Picking workflow</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Select a company part, enter a quantity, and move it into your personal inventory.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Availability</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Only active company parts appear here for worker picking.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Available company parts</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Pick a quantity per row and move stock into your own inventory.
                </p>
              </div>
              <Badge variant="info">{parts.length} active parts</Badge>
            </div>
            <DataTable
              data={parts}
              emptyMessage="No active company parts are available for picking right now."
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
                        className="dashboard-table-select h-9 w-24"
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
