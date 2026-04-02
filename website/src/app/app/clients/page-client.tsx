"use client";

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Building2, ShieldCheck, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { EmptyState } from "@/components/states/empty-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase/client";
import { listClients, resolveCompanyScope, updateClient } from "@/lib/services/firestore-service";
import type { ClientRecord } from "@/lib/types";

interface ClientForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  vatNumber: string;
  notes: string;
}

const initialForm: ClientForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  vatNumber: "",
  notes: "",
};

export default function ClientsClient() {
  const { companyId, role } = useAppContext();
  const { toast } = useAppToast();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [editing, setEditing] = useState<ClientRecord | null>(null);

  const scopeId = resolveCompanyScope(companyId);
  const canMutate = role !== "worker";
  const clientsWithEmail = clients.filter((client) => Boolean(client.email)).length;
  const clientsWithPhone = clients.filter((client) => Boolean(client.phone)).length;

  const load = useCallback(async () => {
    if (!scopeId) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { clients: nextClients } = await listClients(scopeId);
    setClients(nextClients);
    setLoading(false);
  }, [scopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createClient = async () => {
    if (!scopeId || !form.name) return;
    try {
      const addClientFn = httpsCallable(functions, "addClientV1");
      await addClientFn({ companyId: scopeId, ...form });
      setForm(initialForm);
      await load();
      toast({ title: "Client created", variant: "success" });
    } catch (error) {
      toast({
        title: "Client creation failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  const saveEdit = async () => {
    if (!editing || !scopeId) return;
    try {
      await updateClient(scopeId, editing.id, editing);
      setEditing(null);
      await load();
      toast({ title: "Client updated", variant: "success" });
    } catch (error) {
      toast({
        title: "Client update failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  const removeClient = async (clientId: string) => {
    if (!scopeId) return;
    try {
      const deleteClientFn = httpsCallable(functions, "deleteClientV1");
      await deleteClientFn({ companyId: scopeId, clientId });
      await load();
      toast({ title: "Client deleted", variant: "info" });
    } catch (error) {
      toast({
        title: "Client delete failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  return (
    <ProtectedRoute section="clients">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Clients
              </p>
              <h1 className="dashboard-title mt-5">Client records</h1>
              <p className="dashboard-copy mt-4">
                Client records with auto-increment numeric IDs and company-scoped data.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Total clients</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{clients.length}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">With email</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{clientsWithEmail}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">With phone</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{clientsWithPhone}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Add or capture a client</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Store contact details once so jobs and documents can reuse the same client context.
                </p>
              </div>
            </div>

            {canMutate ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <Input label="Name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
                <Input
                  label="Email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                />
                <Input
                  label="Phone"
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
                <Input
                  label="Address"
                  value={form.address}
                  onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                />
                <Input
                  label="City"
                  value={form.city}
                  onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                />
                <Input
                  label="VAT Number"
                  value={form.vatNumber}
                  onChange={(event) => setForm((prev) => ({ ...prev, vatNumber: event.target.value }))}
                />
                <label className="md:col-span-2">
                  <span className="mb-1.5 inline-flex text-sm font-medium text-slate-700 dark:text-slate-200">Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                    rows={3}
                    className="dashboard-field min-h-24 resize-none"
                  />
                </label>
                <div>
                  <Button onClick={() => void createClient()}>Add client</Button>
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 text-slate-500 dark:text-slate-400">
                worker role has read-only access to clients.
              </p>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Mutation model</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Client records are company-scoped and protected by backend mutation flows.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Create and delete operations go through callable functions rather than direct client writes.
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <div className="flex flex-wrap gap-2">
                  <Badge>{canMutate ? "Editable" : "Read only"}</Badge>
                  <Badge variant="info">Scoped by companyId</Badge>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {loading ? <LoadingState /> : null}
        {!loading && clients.length === 0 ? (
          <EmptyState
            title="No client records yet"
            description="Add the first client so jobs, documents, and follow-up work can reuse structured customer details."
          />
        ) : null}

        {!loading && clients.length > 0 ? (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Client directory</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Reusable customer records for jobs, documents, and follow-up.
                </p>
              </div>
              <Badge variant="info">{clients.length} records</Badge>
            </div>
            <DataTable
              data={clients}
              columns={[
                { key: "id", header: "Client #", render: (row) => row.numericId ?? row.id },
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.email || "No email"}</p>
                    </div>
                  ),
                },
                {
                  key: "contact",
                  header: "Contact",
                  render: (row) => (
                    <div className="text-sm">
                      <p>{row.phone || "No phone"}</p>
                      <p className="text-xs text-slate-500">{row.address || "No address"}</p>
                      {row.city && <p className="text-xs text-slate-500">{row.city}</p>}
                    </div>
                  ),
                },
                {
                  key: "vatNumber",
                  header: "VAT #",
                  render: (row) => row.vatNumber || "—",
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) =>
                    canMutate ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void removeClient(row.id)}>
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Read only</span>
                    ),
                },
              ]}
            />
          </Card>
        ) : null}

        <Modal open={Boolean(editing)} title="Edit client" onClose={() => setEditing(null)}>
          {editing ? (
            <div className="grid gap-3">
              <Input
                label="Name"
                value={editing.name}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
              />
              <Input
                label="Email"
                value={editing.email ?? ""}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
              />
              <Input
                label="Phone"
                value={editing.phone ?? ""}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, phone: event.target.value } : prev))}
              />
              <Input
                label="Address"
                value={editing.address ?? ""}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, address: event.target.value } : prev))}
              />
              <Input
                label="City"
                value={editing.city ?? ""}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, city: event.target.value } : prev))}
              />
              <Input
                label="VAT Number"
                value={editing.vatNumber ?? ""}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, vatNumber: event.target.value } : prev))}
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Notes</span>
                <textarea
                  value={editing.notes ?? ""}
                  onChange={(event) => setEditing((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                  rows={3}
                  className="dashboard-field min-h-28 resize-none"
                />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void saveEdit()}>Save changes</Button>
              </div>
            </div>
          ) : null}
        </Modal>
      </section>
    </ProtectedRoute>
  );
}
