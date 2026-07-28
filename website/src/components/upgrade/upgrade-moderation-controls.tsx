"use client";

import type { UpgradeRequestStatus, UpgradeRequestSummary } from "@smart-job/api-contracts";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

interface ModerationResponse {
  readonly ok: boolean;
  readonly data?: UpgradeRequestSummary;
  readonly error?: { readonly message?: string };
}

export function UpgradeModerationControls({
  request,
}: {
  request: UpgradeRequestSummary;
}) {
  const router = useRouter();
  const retry = useRef<{ status: UpgradeRequestStatus; key: string } | null>(null);
  const [current, setCurrent] = useState(request);
  const [pendingStatus, setPendingStatus] = useState<UpgradeRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function moderate(status: UpgradeRequestStatus) {
    const csrf = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrf) {
      setError("Reload the page before moderating this request.");
      return;
    }
    if (retry.current?.status !== status) {
      retry.current = { status, key: crypto.randomUUID() };
    }
    setPendingStatus(status);
    setError(null);
    try {
      const response = await fetch(`/api/upgrade-requests/${encodeURIComponent(current.requestId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": retry.current.key,
          "X-SJ-CSRF": csrf,
        },
        body: JSON.stringify({ status, entityVersion: current.entityVersion }),
      });
      const payload = await response.json().catch(() => null) as ModerationResponse | null;
      if (!response.ok || payload?.ok !== true || payload.data === undefined) {
        setError(payload?.error?.message ?? "Moderation failed.");
        return;
      }
      setCurrent(payload.data);
      retry.current = null;
      router.refresh();
    } catch {
      setError("Moderation failed. Check the connection and retry.");
    } finally {
      setPendingStatus(null);
    }
  }

  if (current.status === "approved") {
    return <span className="text-xs text-emerald-700 dark:text-emerald-300">Applied</span>;
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pendingStatus !== null}
          onClick={() => void moderate("approved")}
        >
          {pendingStatus === "approved" ? "Approving…" : "Approve"}
        </Button>
        {current.status !== "rejected" ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pendingStatus !== null}
            onClick={() => void moderate("rejected")}
          >
            {pendingStatus === "rejected" ? "Rejecting…" : "Reject"}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="max-w-64 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
