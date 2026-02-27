"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function InventoryPage() {
  const { uid, companyId, role } = useAppContext();
  const { toast } = useAppToast();
  const [parts, setParts] = useState<InventoryPart[]>([]);
  const [form, setForm] = useState<PartFormState>(initialForm);
  const [loading, setLoading] = useState(true);

  const isCompanyInventory = Boolean(companyId && (role === "manager" || role === "dev"));

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
    if (isCompanyInventory && companyId) {
      await addCompanyInventoryPart(companyId, {
        name: form.name,
        active: true,
      });
    } else {
      await addUserInventoryPart(uid, {
        name: form.name,
        quantity: Number(form.quantity || "0"),
        lowThreshold: Number(form.lowThreshold || "0"),
      }, companyId);
    }
    setForm(initialForm);
    await load();
    toast({ title: "Part added", variant: "success" });
  };

  const updateQty = async (partId: number, quantity: number) => {
    if (!uid || !companyId) return;
    if (!isCompanyInventory) {
      await updateUserInventoryPart(uid, partId, { quantity }, companyId);
      await load();
    }
  };

  const removeItem = async (partId: number) => {
    if (!uid || !companyId) return;
    if (isCompanyInventory && companyId) {
      await removeCompanyInventoryPart(companyId, partId);
    } else {
      await removeUserInventoryPart(uid, partId, companyId);
    }
    await load();
    toast({ title: "Part removed", variant: "info" });
  };

  const toggleActive = async (partId: number) => {
    if (!companyId || !isCompanyInventory) return;
    await toggleCompanyInventoryPart(companyId, partId);
    await load();
  };

  return (
    <ProtectedRoute section="inventory">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {isCompanyInventory ? "Company Inventory" : "Personal Inventory"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {isCompanyInventory
              ? "Manage company parts catalog for worker assignments."
              : "Track your personal stock and consumables."}
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
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
          <div className="mt-3">
            <Button onClick={() => void createItem()}>Add part</Button>
          </div>
        </Card>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <DataTable
              data={parts}
              emptyMessage="No inventory parts found."
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
                              className="h-8 w-20 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
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
