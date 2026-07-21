import Link from "next/link";
import { CalendarDays, Download, UserRound } from "lucide-react";
import type { Cursor, DocumentSummary } from "@smart-job/api-contracts";
import { DocumentRowActions } from "@/components/documents/document-row-actions";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/states/empty-state";
import { DOC_TYPE, getDocumentTypeLabel } from "@/lib/document-types";
import {
  buildDocumentDownloadHref,
  buildDocumentsPageHref,
  hasActiveDocumentsFilters,
  type DocumentsFilterValues,
} from "@/lib/dal/documents-query";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusVariant(status: DocumentSummary["generationStatus"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "queued" || status === "processing") return "warning" as const;
  return "default" as const;
}

function formatDocumentDate(document: DocumentSummary): string {
  return formatDateTime(document.documentDate ?? document.createdAt);
}

export function DocumentsList({
  companyId,
  documents,
  filters,
  afterCursor,
  nextCursor,
  canDeleteDocuments,
}: {
  companyId: number;
  documents: readonly DocumentSummary[];
  filters: DocumentsFilterValues;
  afterCursor: Cursor | null;
  nextCursor: Cursor | null;
  canDeleteDocuments: boolean;
}) {
  if (documents.length === 0) {
    const filtered = hasActiveDocumentsFilters(filters) || afterCursor !== null;
    return (
      <EmptyState
        title={filtered ? "No documents match these filters" : "No documents yet"}
        description={filtered
          ? "Adjust the filters or return to the first page to continue browsing this workspace."
          : "Generated proposals, delivery notes, invoices, refunds, and receipts will appear here."}
        action={filtered ? (
          <Link
            href={buildDocumentsPageHref(companyId)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Clear filters
          </Link>
        ) : undefined}
      />
    );
  }

  const firstPageHref = buildDocumentsPageHref(companyId, filters);
  const nextPageHref = nextCursor
    ? buildDocumentsPageHref(companyId, filters, nextCursor)
    : null;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Document results</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Showing {documents.length} document{documents.length === 1 ? "" : "s"} from this bounded page.
          </p>
        </div>
        {afterCursor ? <Badge variant="info">Continued page</Badge> : <Badge>First page</Badge>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold sm:px-6">Document</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Client</th>
              <th scope="col" className="px-4 py-3 font-semibold">Creator</th>
              <th scope="col" className="px-4 py-3 font-semibold">Total</th>
              <th scope="col" className="px-4 py-3 font-semibold">Date</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-6">File</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {documents.map((document) => (
              <tr key={document.documentId} className="align-top transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                <td className="px-5 py-4 sm:px-6">
                  <p className="font-semibold text-slate-950 dark:text-white">
                    {getDocumentTypeLabel(document.documentType)} #{document.documentNumber}
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {document.documentCode}
                  </p>
                  {document.documentType === DOC_TYPE.TAX_INVOICE ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Tax authority: {document.taxAuthorityStatus}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <Badge variant={statusVariant(document.generationStatus)}>
                    {document.generationStatus}
                  </Badge>
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                  {document.client?.name ?? "No client"}
                </td>
                <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    {document.creator?.displayName
                      ?? (document.creator?.memberNo ? `Member ${document.creator.memberNo}` : "Unknown")}
                  </span>
                </td>
                <td className="px-4 py-4 font-medium text-slate-700 dark:text-slate-200">
                  <bdi dir="ltr">{formatCurrency(document.totalWithVat)}</bdi>
                </td>
                <td className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    <time dateTime={document.documentDate ?? document.createdAt}>
                      <bdi dir="ltr">{formatDocumentDate(document)}</bdi>
                    </time>
                  </span>
                </td>
                <td className="px-5 py-4 text-right sm:px-6">
                  {document.hasFile ? (
                    <a
                      href={buildDocumentDownloadHref(companyId, document.documentId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-medium text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-950"
                      aria-label={`Open ${document.documentCode}`}
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Open PDF
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-600">Not ready</span>
                  )}
                </td>
                <td className="px-5 py-4 text-right sm:px-6">
                  {canDeleteDocuments ? (
                    <DocumentRowActions companyId={companyId} document={document} />
                  ) : (
                    <span className="text-xs text-slate-400" aria-disabled="true">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Documents pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        {afterCursor ? (
          <Link
            href={firstPageHref}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            First page
          </Link>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Newest documents first</span>
        )}

        {nextPageHref ? (
          <Link
            href={nextPageHref}
            rel="next"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            Next page
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg bg-slate-100 px-4 text-sm font-medium text-slate-400 dark:bg-slate-900 dark:text-slate-600"
          >
            Next page
          </span>
        )}
      </nav>
    </Card>
  );
}
