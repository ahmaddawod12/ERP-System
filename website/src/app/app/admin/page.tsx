"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, updateDoc, doc } from "firebase/firestore";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { db } from "@/lib/firebase/client";

interface UpgradeRequest {
  id: string;
  uid: string;
  currentTier: string;
  requestedTier: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function AdminPage() {
  const [items, setItems] = useState<UpgradeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(query(collection(db, "upgrade_requests"), orderBy("createdAt", "desc")));
    setItems(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<UpgradeRequest, "id">) })));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const markStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, "upgrade_requests", id), {
      status,
      updatedAt: new Date().toISOString(),
    });
    await load();
  };

  return (
    <ProtectedRoute section="admin">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Admin Panel</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Lightweight admin view for upgrade requests. Extend with support queues and audit logs.
          </p>
        </Card>

        {loading ? (
          <LoadingState />
        ) : (
          <Card>
            <DataTable
              data={items}
              emptyMessage="No upgrade requests yet."
              columns={[
                { key: "uid", header: "UID", render: (row) => row.uid },
                {
                  key: "tiers",
                  header: "Tier change",
                  render: (row) => (
                    <div className="text-sm">
                      <span>{row.currentTier}</span>{" -> "}<span>{row.requestedTier}</span>
                    </div>
                  ),
                },
                {
                  key: "message",
                  header: "Message",
                  render: (row) => <span className="text-sm">{row.message}</span>,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <Badge variant={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"}>
                      {row.status}
                    </Badge>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) => (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void markStatus(row.id, "approved")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void markStatus(row.id, "rejected")}>
                        Reject
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


