import { FileText, Filter, ShieldX } from "lucide-react";
import type { Viewer, WorkspaceSummary } from "@smart-job/api-contracts";
import { notFound, redirect } from "next/navigation";
import { DocumentCreateControl } from "@/components/documents/document-create-control";
import { DocumentsFilters } from "@/components/documents/documents-filters";
import { DocumentsList } from "@/components/documents/documents-list";
import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCompanyDocuments } from "@/lib/backend/documents-client";
import { BackendTransportError } from "@/lib/backend/transport-core";
import {
  parseDocumentsSearchParams,
  type DocumentsFilterValues,
  type DocumentsSearchParams,
} from "@/lib/dal/documents-query";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import { findViewerWorkspace, parsePublicCompanyId } from "@/lib/dal/workspace-routing";

export const metadata = { title: "Documents | Smart-Job" };

const emptyFilters: DocumentsFilterValues = {
  search: "",
  status: "",
  documentType: "",
  dateFrom: "",
  dateTo: "",
};

function DocumentsPageFrame({
  viewer,
  workspace,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="documents">
      <section className="dashboard-page" aria-labelledby="documents-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered document history
              </p>
              <h1 id="documents-heading" className="dashboard-title mt-4">
                {workspace.name} documents
              </h1>
              <p className="dashboard-copy mt-3">
                Browse a bounded, authorized document page. Search, filters, and cursor pagination run in the backend database.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
            </div>
          </div>
        </div>
        {children}
      </section>
    </ServerWorkspaceShell>
  );
}

function InvalidDocumentsFilterState({ message }: { message: string }) {
  return (
    <Card className="border-red-200 dark:border-red-900/70">
      <div role="alert" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <Filter className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Check the document filters</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export default async function CompanyDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<DocumentsSearchParams>;
}) {
  const [{ companyId: rawCompanyId }, rawSearchParams] = await Promise.all([params, searchParams]);
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/documents`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) redirect("/onboarding");

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) notFound();

  // Reject forged tenant URLs before issuing any company-scoped backend request.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) notFound();

  const documentsAvailable = membership.enabledModules.includes("documents")
    && membership.role !== "worker";
  if (!documentsAvailable) {
    return (
      <DocumentsPageFrame viewer={viewer} workspace={membership}>
        <DocumentsFilters companyId={companyId} filters={emptyFilters} disabled />
        <EmptyState
          title="Documents are unavailable for this workspace"
          description="This workspace module or role does not currently permit document history. Filtering, downloads, and pagination remain disabled until access changes."
          action={(
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <ShieldX className="h-4 w-4" aria-hidden="true" />
              Module disabled
            </span>
          )}
        />
      </DocumentsPageFrame>
    );
  }

  const parsedSearch = parseDocumentsSearchParams(rawSearchParams);
  const canCreateDocuments = ["manager", "user", "basic", "dev"].includes(membership.role);
  const canDeleteDocuments = membership.role === "manager" || membership.role === "dev";
  const initialDate = new Date().toISOString().slice(0, 10);
  if (!parsedSearch.ok) {
    return (
      <DocumentsPageFrame viewer={viewer} workspace={membership}>
        {canCreateDocuments ? (
          <DocumentCreateControl companyId={companyId} initialDate={initialDate} />
        ) : null}
        <DocumentsFilters companyId={companyId} filters={parsedSearch.filters} />
        <InvalidDocumentsFilterState message={parsedSearch.message} />
      </DocumentsPageFrame>
    );
  }

  let page;
  try {
    page = await getCompanyDocuments(companyId, context.sessionToken, parsedSearch.query);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    if (error instanceof BackendTransportError && error.status === 400) {
      return (
        <DocumentsPageFrame viewer={viewer} workspace={membership}>
          <DocumentsFilters companyId={companyId} filters={parsedSearch.filters} />
          <InvalidDocumentsFilterState message="The pagination cursor or filter values are no longer valid. Return to the first page and try again." />
        </DocumentsPageFrame>
      );
    }
    throw error;
  }

  return (
    <DocumentsPageFrame viewer={viewer} workspace={membership}>
      {canCreateDocuments ? (
        <DocumentCreateControl companyId={companyId} initialDate={initialDate} />
      ) : null}
      <DocumentsFilters companyId={companyId} filters={parsedSearch.filters} />
      <DocumentsList
        companyId={companyId}
        documents={page.items}
        filters={parsedSearch.filters}
        afterCursor={parsedSearch.afterCursor}
        nextCursor={page.nextCursor}
        canDeleteDocuments={canDeleteDocuments}
      />
    </DocumentsPageFrame>
  );
}
