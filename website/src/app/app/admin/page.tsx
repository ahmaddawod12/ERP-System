import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { UpgradeRequestListQuerySchema } from "@smart-job/api-contracts";

import { OpaqueSessionLogout } from "@/components/auth/opaque-session-logout";
import { UpgradeModerationControls } from "@/components/upgrade/upgrade-moderation-controls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { BackendTransportError } from "@/lib/backend/transport-core";
import { listUpgradeRequests } from "@/lib/backend/upgrade-request-client";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Upgrade review | Smart-Job" };

type SearchValue = string | string[] | undefined;

function single(value: SearchValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function queueHref(status?: string, afterCursor?: string): string {
  const search = new URLSearchParams();
  if (status) search.set("status", status);
  if (afterCursor) search.set("afterCursor", afterCursor);
  const suffix = search.size === 0 ? "" : `?${search.toString()}`;
  return `/app/admin${suffix}`;
}

export default async function AdminUpgradeQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  if (Array.isArray(raw.status) || Array.isArray(raw.afterCursor)) notFound();
  const query = UpgradeRequestListQuerySchema.safeParse({
    status: single(raw.status),
    afterCursor: single(raw.afterCursor),
    pageSize: 50,
  });
  if (!query.success) notFound();
  const context = await requireWebsiteRequestContext("/app/admin");

  let page;
  try {
    page = await listUpgradeRequests(query.data, context.sessionToken);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent("/app/admin")}`);
    }
    if (error instanceof BackendTransportError && (error.status === 403 || error.status === 404)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-[86rem] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold text-slate-950 dark:text-white">Smart-Job administration</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Server-authorized developer queue</p>
          </div>
          <OpaqueSessionLogout />
        </div>
      </header>
      <main className="mx-auto grid max-w-[86rem] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="dashboard-hero">
          <p className="dashboard-kicker"><Sparkles className="h-3.5 w-3.5" /> Admin</p>
          <h1 className="dashboard-title mt-4">Upgrade request review</h1>
          <p className="dashboard-copy mt-3">
            Approval applies subscription state and module entitlements atomically. The database verifies developer authority.
          </p>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Upgrade status filters">
          {[undefined, "pending", "approved", "rejected"].map((status) => (
            <Link
              key={status ?? "all"}
              href={queueHref(status)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {status ?? "all"}
            </Link>
          ))}
        </nav>

        {page.items.length === 0 ? (
          <Card>
            <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5" /><h2 className="font-semibold">No requests in this queue</h2></div>
          </Card>
        ) : (
          <div className="grid gap-4">
            {page.items.map((item) => (
              <Card key={item.requestId} className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning"}>{item.status}</Badge>
                    <Badge variant="info">Company {item.companyId}</Badge>
                    <span className="text-xs text-slate-500">{item.role}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{item.currentTier} → {item.requestedTier}</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{item.message}</p>
                  <p className="mt-3 text-xs text-slate-500">
                    <bdi dir="auto">{item.requesterEmail ?? "Email unavailable"}</bdi> · <time dateTime={item.createdAt}><bdi dir="ltr">{formatDateTime(item.createdAt)}</bdi></time>
                  </p>
                  {item.moderationNote ? <p className="mt-2 text-xs text-slate-500">Review note: {item.moderationNote}</p> : null}
                </div>
                <UpgradeModerationControls request={item} />
              </Card>
            ))}
          </div>
        )}

        {page.nextCursor ? (
          <div>
            <Link
              href={queueHref(query.data.status, page.nextCursor)}
              className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium dark:border-slate-700 dark:bg-slate-950"
            >
              Next page
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
