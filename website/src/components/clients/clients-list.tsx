import Link from "next/link";
import { Building2, Mail, MapPin, Phone } from "lucide-react";
import type { ClientSummary, Cursor } from "@smart-job/api-contracts";
import { ClientRowActions } from "@/components/clients/client-row-actions";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  buildClientsPageHref,
  hasActiveClientsFilters,
  type ClientsFilterValues,
} from "@/lib/dal/clients-query";

function addressLabel(client: ClientSummary): string | null {
  return [client.address, client.city].filter(Boolean).join(", ") || null;
}

export function ClientsList({
  companyId,
  clients,
  filters,
  afterCursor,
  nextCursor,
  canManageClients,
}: {
  companyId: number;
  clients: readonly ClientSummary[];
  filters: ClientsFilterValues;
  afterCursor: Cursor | null;
  nextCursor: Cursor | null;
  canManageClients: boolean;
}) {
  const firstPageHref = buildClientsPageHref(companyId, filters);
  const nextPageHref = nextCursor
    ? buildClientsPageHref(companyId, filters, nextCursor)
    : null;

  if (clients.length === 0) {
    const filtered = hasActiveClientsFilters(filters) || afterCursor !== null;
    return (
      <EmptyState
        title={filtered ? "No clients match this search" : "No clients yet"}
        description={filtered
          ? "Try a different search or return to the first page of this directory."
          : "Client records will appear here after they are added to this workspace."}
        action={filtered ? (
          <Link
            href={buildClientsPageHref(companyId)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            Clear search
          </Link>
        ) : undefined}
      />
    );
  }

  const pageEmailCount = clients.filter((client) => client.email !== null).length;
  const pagePhoneCount = clients.filter((client) => client.phone !== null).length;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Client directory</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Showing {clients.length} client{clients.length === 1 ? "" : "s"} from this bounded page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Current page client summary">
          <Badge>{clients.length} on page</Badge>
          <Badge variant="info">{pageEmailCount} with email</Badge>
          <Badge variant="success">{pagePhoneCount} with phone</Badge>
          {afterCursor ? <Badge variant="warning">Continued page</Badge> : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold sm:px-6">Client</th>
              <th scope="col" className="px-4 py-3 font-semibold">Contact</th>
              <th scope="col" className="px-4 py-3 font-semibold">Address</th>
              <th scope="col" className="px-4 py-3 font-semibold">VAT number</th>
              <th scope="col" className="px-5 py-3 font-semibold sm:px-6">Status</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {clients.map((client) => {
              const location = addressLabel(client);
              return (
                <tr key={client.clientId} className="align-top transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                  <td className="px-5 py-4 sm:px-6">
                    <p className="font-semibold text-slate-950 dark:text-white">
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{client.clientNo}</span>{" "}
                      {client.name}
                    </p>
                    {client.notes ? (
                      <p className="mt-1 max-w-sm line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {client.notes}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                    <div className="flex flex-col gap-2">
                      {client.phone ? (
                        <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 hover:text-blue-700 hover:underline dark:hover:text-blue-300">
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                          {client.phone}
                        </a>
                      ) : null}
                      {client.email ? (
                        <a href={`mailto:${client.email}`} className="inline-flex items-center gap-1.5 hover:text-blue-700 hover:underline dark:hover:text-blue-300">
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                          {client.email}
                        </a>
                      ) : null}
                      {!client.phone && !client.email ? <span className="text-slate-400">No contact details</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                    {location ? (
                      <span className="inline-flex max-w-xs items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {location}
                      </span>
                    ) : (
                      <span className="text-slate-400">No address</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                    {client.vatNumber ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {client.vatNumber}
                      </span>
                    ) : (
                      <span className="text-slate-400">Not recorded</span>
                    )}
                  </td>
                  <td className="px-5 py-4 sm:px-6">
                    <Badge variant={client.status === "active" ? "success" : "default"}>{client.status}</Badge>
                  </td>
                  <td className="px-5 py-4 text-right sm:px-6">
                    {canManageClients ? (
                      <ClientRowActions companyId={companyId} client={client} />
                    ) : (
                      <span className="text-xs text-slate-400" aria-disabled="true">Read only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav aria-label="Clients pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6">
        {afterCursor ? (
          <Link
            href={firstPageHref}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
          >
            First page
          </Link>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Newest clients first</span>
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
