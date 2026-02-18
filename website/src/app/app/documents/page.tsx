"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/states/loading-state";
import { EmptyState } from "@/components/states/empty-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { listCertifications } from "@/lib/services/firestore-service";
import type { CertificationRecord } from "@/lib/types";

const documentTypes = ["Work Certification", "Service Completion", "Compliance Checklist"];

export default function DocumentsPage() {
  const { uid, companyId } = useAppContext();
  const { toast } = useAppToast();
  const [records, setRecords] = useState<CertificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState("");

  const companyScopeId = companyId ?? uid;

  const load = useCallback(async () => {
    if (!companyScopeId) return;
    setLoading(true);
    const result = await listCertifications(companyScopeId);
    setRecords(result);
    setLoading(false);
  }, [companyScopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (type: string) => {
    if (!companyScopeId || !uid) return;
    const response = await fetch("/api/documents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid,
        companyId: companyScopeId,
        type,
        jobId: jobId || "manual",
      }),
    });
    const payload = (await response.json()) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      toast({ title: "Document request failed", description: payload.message, variant: "error" });
      return;
    }
    toast({ title: "Document queued", variant: "success" });
    await load();
  };

  return (
    <ProtectedRoute section="documents">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Documents</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Certification history and PDF generation workflow.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1.5 inline-flex text-sm font-medium text-slate-700 dark:text-slate-200">
                Job ID (optional)
              </span>
              <input
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {documentTypes.map((type) => (
                <Button key={type} variant="secondary" onClick={() => void generate(type)}>
                  Generate {type}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        {loading ? <LoadingState /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState title="No documents yet" description="Generate your first document from the actions above." />
        ) : null}

        {!loading && records.length > 0 ? (
          <Card>
            <DataTable
              data={records}
              columns={[
                {
                  key: "type",
                  header: "Type",
                  render: (row) => row.type,
                },
                {
                  key: "job",
                  header: "Job",
                  render: (row) => row.jobId,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <Badge
                      variant={
                        row.status === "generated" ? "success" : row.status === "failed" ? "danger" : "warning"
                      }
                    >
                      {row.status}
                    </Badge>
                  ),
                },
                {
                  key: "createdAt",
                  header: "Created",
                  render: (row) => row.createdAt,
                },
                {
                  key: "download",
                  header: "Download",
                  render: (row) =>
                    row.downloadUrl ? (
                      <Link href={row.downloadUrl} target="_blank" className="text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400">
                        Download
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">Pending</span>
                    ),
                },
              ]}
            />
          </Card>
        ) : null}
      </section>
    </ProtectedRoute>
  );
}
