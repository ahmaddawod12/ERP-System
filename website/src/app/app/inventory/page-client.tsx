"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, ShieldCheck, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import {
  addCompanyInventoryPart,
  addUserInventoryPart,
  getCompanyInventory,
  getUserInventory,
  removeCompanyInventoryPart,
  removeUserInventoryPart,
  toggleCompanyInventoryPart,
  updateUserInventoryPart,
} from "@/lib/services/firestore-service";
import type { InventoryPart } from "@/lib/types";

interface PartFormState {
  name: string;
  quantity: string;
  lowThreshold: string;
}

const initialForm: PartFormState = {
  name: "",
  quantity: "0",
  lowThreshold: "0",
};

export default function InventoryClient() {
  const { uid, companyId, role } = useAppContext();
  const { toast } = useAppToast();
  const [parts, setParts] = useState<InventoryPart[]>([]);
  const [form, setForm] = useState<PartFormState>(initialForm);
  const [loading, setLoading] = useState(true);

  const isCompanyInventory = Boolean(companyId && (role === "manager" || role === "dev"));
  const lowStockCount = parts.filter(
    (part) => !isCompanyInventory && (part.quantity ?? 0) <= (part.lowThreshold ?? 0),
  ).length;
  const inactiveCount = parts.filter((part) => isCompanyInventory && part.active === false).length;

  const load = useCallback(async () => {
    setLoading(true);
    if (isCompanyInventory && companyId) {
      const inv = await getCompanyInventory(companyId);
      setParts(inv.parts);
    } else if (uid) {
      const inv = await getUserInventory(uid);
      setParts(inv.parts);
    }
    setLoading(false);
  }, [companyId, isCompanyInventory, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const createItem = async () => {
    if (!uid || !companyId || !form.name) return;
    const quantity = Number(form.quantity || "0");
    const lowThreshold = Number(form.lowThreshold || "0");
    if (!isCompanyInventory && (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(lowThreshold) || lowThreshold < 0)) {
      toast({ title: "Invalid inventory values", description: "Quantity and low threshold must be non-negative numbers.", variant: "error" });
      return;
    }
    try {
      if (isCompanyInventory && companyId) {
        await addCompanyInventoryPart(companyId, {
          name: form.name,
          active: true,
        });
      } else {
        await addUserInventoryPart(uid, {
          name: form.name,
          quantity,
          lowThreshold,
        }, companyId);
      }
      setForm(initialForm);
      await load();
      toast({ title: "Part added", variant: "success" });
    } catch (error) {
      toast({
        title: "Inventory update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  const updateQty = async (partId: number, quantity: number) => {
    if (!uid || !companyId) return;
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast({ title: "Invalid quantity", description: "Quantity must be a non-negative number.", variant: "error" });
      return;
    }
    if (!isCompanyInventory) {
      try {
        await updateUserInventoryPart(uid, partId, { quantity }, companyId);
        await load();
      } catch (error) {
        toast({
          title: "Inventory update failed",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "error",
        });
      }
    }
  };

  const removeItem = async (partId: number) => {
    if (!uid || !companyId) return;
    try {
      if (isCompanyInventory && companyId) {
        await removeCompanyInventoryPart(companyId, partId);
      } else {
        await removeUserInventoryPart(uid, partId, companyId);
      }
      await load();
      toast({ title: "Part removed", variant: "info" });
    } catch (error) {
      toast({
        title: "Inventory delete failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  const toggleActive = async (partId: number) => {
    if (!companyId || !isCompanyInventory) return;
    try {
      await toggleCompanyInventoryPart(companyId, partId);
      await load();
    } catch (error) {
      toast({
        title: "Inventory update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <ProtectedRoute section="inventory">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Inventory
              </p>
              <h1 className="dashboard-title mt-5">
                {isCompanyInventory ? "Company Inventory" : "Personal Inventory"}
              </h1>
              <p className="dashboard-copy mt-4">
                {isCompanyInventory
                  ? "Manage company parts catalog for worker assignments."
                  : "Track your personal stock and consumables."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Total parts</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{parts.length}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {isCompanyInventory ? "Inactive" : "Low stock"}
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {isCompanyInventory ? inactiveCount : lowStockCount}
                </p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Mode</p>
                <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {isCompanyInventory ? "Company" : "Personal"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Add a part</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Capture stock once, then manage quantities or catalog status from the same workspace.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Input label="Part name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              {!isCompanyInventory && (
                <>
                  <Input
                    label="Quantity"
                    type="number"
                    value={form.quantity}
                    onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  />
                  <Input
                    label="Low threshold"
                    type="number"
                    value={form.lowThreshold}
                    onChange={(event) => setForm((prev) => ({ ...prev, lowThreshold: event.target.value }))}
                  />
                </>
              )}
            </div>
            <div className="mt-4">
              <Button onClick={() => void createItem()}>Add part</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Inventory mode</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Company inventory behaves like a managed catalog. Personal inventory tracks live stock levels.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                {isCompanyInventory
                  ? "Toggle catalog availability for workers without deleting historical meaning."
                  : "Quantities can be updated inline and low-stock warnings surface immediately."}
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <Badge variant={isCompanyInventory ? "info" : lowStockCount > 0 ? "warning" : "success"}>
                  {isCompanyInventory
                    ? `${inactiveCount} inactive parts`
                    : lowStockCount > 0
                      ? `${lowStockCount} low-stock parts`
                      : "Stock looks healthy"}
                </Badge>
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
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Inventory list</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Inline controls are tuned to the current inventory mode.
                </p>
              </div>
              <Badge variant="info">{parts.length} parts</Badge>
            </div>
            <DataTable
              data={parts}
              emptyMessage={
                isCompanyInventory
                  ? "No company parts yet. Add the first catalog part above to start assigning stock."
                  : "No personal stock yet. Add the first part above to begin tracking quantities."
              }
              columns={[
                {
                  key: "name",
                  header: "Part",
                  render: (row) => (
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-slate-500">ID: {row.id}</p>
                    </div>
                  ),
                },
                ...(isCompanyInventory
                  ? [
                      {
                        key: "active" as const,
                        header: "Status",
                        render: (row: InventoryPart) => (
                          <button
                            type="button"
                            onClick={() => void toggleActive(row.id)}
                            className="cursor-pointer"
                          >
                            <Badge variant={row.active !== false ? "success" : "warning"}>
                              {row.active !== false ? "Active" : "Inactive"}
                            </Badge>
                          </button>
                        ),
                      },
                    ]
                  : [
                      {
                        key: "quantity" as const,
                        header: "Quantity",
                        render: (row: InventoryPart) => (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              defaultValue={row.quantity ?? 0}
                              onBlur={(event) => void updateQty(row.id, Number(event.target.value))}
                              className="dashboard-table-select h-9 w-24"
                            />
                            {(row.quantity ?? 0) <= (row.lowThreshold ?? 0) ? (
                              <Badge variant="warning">Low</Badge>
                            ) : (
                              <Badge variant="success">OK</Badge>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "lowThreshold" as const,
                        header: "Low Threshold",
                        render: (row: InventoryPart) => row.lowThreshold ?? 0,
                      },
                    ]),
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) => (
                    <Button size="sm" variant="danger" onClick={() => void removeItem(row.id)}>
                      Delete
                    </Button>
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
