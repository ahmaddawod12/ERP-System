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
  addInventoryItem,
  addPersonalInventoryItem,
  deleteInventoryItem,
  deletePersonalInventoryItem,
  listCompanyInventory,
  listPersonalInventory,
  updateInventoryItem,
  updatePersonalInventoryItem,
} from "@/lib/services/firestore-service";
import type { InventoryItem } from "@/lib/types";

interface PartFormState {
  name: string;
  sku: string;
  quantity: string;
  lowThreshold: string;
}

const initialForm: PartFormState = {
  name: "",
  sku: "",
  quantity: "0",
  lowThreshold: "0",
};

export default function InventoryPage() {
  const { uid, companyId, role } = useAppContext();
  const { toast } = useAppToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState<PartFormState>(initialForm);
  const [loading, setLoading] = useState(true);

  const isCompanyInventory = Boolean(companyId && (role === "Manager" || role === "Dev"));

  const load = useCallback(async () => {
    setLoading(true);
    if (isCompanyInventory && companyId) {
      setItems(await listCompanyInventory(companyId));
    } else if (uid) {
      setItems(await listPersonalInventory(uid));
    }
    setLoading(false);
  }, [companyId, isCompanyInventory, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const createItem = async () => {
    if (!uid || !form.name) return;
    const payload = {
      name: form.name,
      sku: form.sku,
      quantity: Number(form.quantity || "0"),
      lowThreshold: Number(form.lowThreshold || "0"),
    };
    if (isCompanyInventory && companyId) {
      await addInventoryItem(companyId, payload);
    } else {
      await addPersonalInventoryItem(uid, payload);
    }
    setForm(initialForm);
    await load();
    toast({ title: "Inventory item created", variant: "success" });
  };

  const updateItemQty = async (itemId: string, quantity: number) => {
    if (!uid) return;
    if (isCompanyInventory && companyId) {
      await updateInventoryItem(companyId, itemId, { quantity });
    } else {
      await updatePersonalInventoryItem(uid, itemId, { quantity });
    }
    await load();
  };

  const removeItem = async (itemId: string) => {
    if (!uid) return;
    if (isCompanyInventory && companyId) {
      await deleteInventoryItem(companyId, itemId);
    } else {
      await deletePersonalInventoryItem(uid, itemId);
    }
    await load();
    toast({ title: "Inventory item deleted", variant: "info" });
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
              ? "Manage stock levels for worker assignments."
              : "Track your personal stock and consumables."}
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Input label="Part name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
            <Input label="SKU" value={form.sku} onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))} />
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
          </div>
          <div className="mt-3">
            <Button onClick={() => void createItem()}>Add item</Button>
          </div>
        </Card>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <DataTable
              data={items}
              emptyMessage="No inventory items found."
              columns={[
                {
                  key: "name",
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
                  header: "Quantity",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        defaultValue={row.quantity}
                        onBlur={(event) => void updateItemQty(row.id, Number(event.target.value))}
                        className="h-8 w-20 rounded border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                      {row.quantity <= row.lowThreshold ? <Badge variant="warning">Low</Badge> : <Badge variant="success">OK</Badge>}
                    </div>
                  ),
                },
                {
                  key: "lowThreshold",
                  header: "Low Threshold",
                  render: (row) => row.lowThreshold,
                },
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
