"use client";

import {
  WorkerSummarySchema,
  WorkerUpdateRequestSchema,
  createApiResponseSchema,
  type WorkerDirectoryRole,
  type WorkerSummary,
} from "@smart-job/api-contracts";
import { Pencil, RotateCcw, UserMinus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

const responseSchema = createApiResponseSchema(WorkerSummarySchema);

interface PendingIdentity {
  readonly fingerprint: string;
  readonly key: string;
}

function nullableField(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function WorkerMembershipActions({
  companyId,
  worker,
}: {
  companyId: number;
  worker: WorkerSummary;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(worker);
  const [editing, setEditing] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [displayName, setDisplayName] = useState(worker.displayName ?? "");
  const [phoneNumber, setPhoneNumber] = useState(worker.phoneNumber ?? "");
  const [role, setRole] = useState<WorkerDirectoryRole>(worker.role);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    readonly kind: "error" | "success";
    readonly text: string;
  } | null>(null);
  const pendingIdentity = useRef<PendingIdentity | null>(null);

  useEffect(() => {
    setCurrent(worker);
    setDisplayName(worker.displayName ?? "");
    setPhoneNumber(worker.phoneNumber ?? "");
    setRole(worker.role);
  }, [worker]);

  async function mutate(method: "PATCH" | "DELETE", body: object): Promise<WorkerSummary | null> {
    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setMessage({
        kind: "error",
        text: "Your session could not be verified. Reload the page and try again.",
      });
      return null;
    }

    const fingerprint = JSON.stringify({ method, body });
    if (pendingIdentity.current?.fingerprint !== fingerprint) {
      pendingIdentity.current = { fingerprint, key: crypto.randomUUID() };
    }

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/workers/membership", {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pendingIdentity.current.key,
          "X-SJ-CSRF": csrfToken,
        },
        body: JSON.stringify(body),
      });
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        setMessage({ kind: "error", text: "The server returned an invalid response. Try again." });
        return null;
      }
      if (!parsed.data.ok) {
        setMessage({ kind: "error", text: parsed.data.error.message });
        return null;
      }

      pendingIdentity.current = null;
      setCurrent(parsed.data.data);
      router.refresh();
      return parsed.data.data;
    } catch {
      setMessage({
        kind: "error",
        text: "The team-member change could not be saved. Check your connection and retry.",
      });
      return null;
    } finally {
      setPending(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const request = WorkerUpdateRequestSchema.safeParse({
      entityVersion: current.entityVersion,
      displayName: nullableField(displayName),
      phoneNumber: nullableField(phoneNumber),
      role,
    });
    if (!request.success) {
      setMessage({ kind: "error", text: "Check the team-member fields and try again." });
      return;
    }

    const updated = await mutate("PATCH", {
      companyId,
      memberNo: current.memberNo,
      worker: request.data,
    });
    if (updated) {
      setEditing(false);
      setMessage({ kind: "success", text: "Team member updated." });
    }
  }

  async function restore(): Promise<void> {
    const request = WorkerUpdateRequestSchema.parse({
      entityVersion: current.entityVersion,
      status: "active",
    });
    const updated = await mutate("PATCH", {
      companyId,
      memberNo: current.memberNo,
      worker: request,
    });
    if (updated) setMessage({ kind: "success", text: "Team access restored." });
  }

  async function disable(): Promise<void> {
    const updated = await mutate("DELETE", {
      companyId,
      memberNo: current.memberNo,
      entityVersion: current.entityVersion,
    });
    if (updated) {
      setConfirmDisable(false);
      setEditing(false);
      setMessage({ kind: "success", text: "Team access disabled." });
    }
  }

  return (
    <div className="min-w-52 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setEditing((value) => !value);
            setConfirmDisable(false);
            setMessage(null);
          }}
          className="gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
        {current.status === "disabled" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => void restore()}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restore
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              setConfirmDisable(true);
              setEditing(false);
              setMessage(null);
            }}
            className="gap-1.5"
          >
            <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
            Disable
          </Button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={pending}
              maxLength={200}
              className="dashboard-field h-9 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            Phone number
            <input
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              disabled={pending}
              maxLength={40}
              className="dashboard-field h-9 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as WorkerDirectoryRole)}
              disabled={pending}
              className="dashboard-field h-9 text-sm"
            >
              <option value="worker">Worker</option>
              <option value="user">User</option>
              <option value="basic">Basic</option>
            </select>
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </form>
      ) : null}

      {confirmDisable ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
          <p>Disable this member? Active jobs and remaining inventory must be cleared first.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => void disable()}>
              {pending ? "Disabling..." : "Confirm"}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmDisable(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-4">
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={message.kind === "error"
              ? "text-xs text-red-700 dark:text-red-300"
              : "text-xs text-emerald-700 dark:text-emerald-300"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
