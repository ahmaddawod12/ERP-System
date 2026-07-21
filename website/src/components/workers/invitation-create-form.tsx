"use client";

import {
  InvitationCreateRequestSchema,
  InvitationCreateResultSchema,
  createApiResponseSchema,
  type InvitationCreateResult,
  type InvitationTargetRole,
} from "@smart-job/api-contracts";
import { KeyRound, Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

const invitationResponseSchema = createApiResponseSchema(InvitationCreateResultSchema);
type InviteRole = Exclude<InvitationTargetRole, "manager">;

interface PendingIdentity {
  readonly fingerprint: string;
  readonly key: string;
}

export function InvitationCreateForm({ companyId }: { companyId: number }) {
  const [targetRole, setTargetRole] = useState<InviteRole>("worker");
  const [targetEmail, setTargetEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitationCreateResult | null>(null);
  const pendingIdentity = useRef<PendingIdentity | null>(null);

  function resetMutationResult(): void {
    pendingIdentity.current = null;
    setCreated(null);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const parsed = InvitationCreateRequestSchema.safeParse({
      targetRole,
      ...(targetEmail.trim() ? { targetEmail: targetEmail.trim() } : {}),
      expiresInDays: Number(expiresInDays),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the invitation details.");
      return;
    }

    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setError("Your session could not be verified. Reload the page and try again.");
      return;
    }

    const fingerprint = JSON.stringify(parsed.data);
    if (pendingIdentity.current?.fingerprint !== fingerprint) {
      pendingIdentity.current = { fingerprint, key: crypto.randomUUID() };
    }
    const idempotencyKey = pendingIdentity.current.key;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/workers/invitation", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-SJ-CSRF": csrfToken,
        },
        body: JSON.stringify({ companyId, invitation: parsed.data }),
      });
      const payload = invitationResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!payload.success) {
        setError("The server returned an invalid response. Try again.");
        return;
      }
      if (!payload.data.ok) {
        setError(payload.data.error.message);
        return;
      }

      setCreated(payload.data.data);
      pendingIdentity.current = null;
    } catch {
      setError("The invitation could not be created. Check your connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Create a team invitation</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Generate a role-scoped code. An optional email binds redemption to that verified address.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)_150px_auto] lg:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Role</span>
          <select
            value={targetRole}
            disabled={pending}
            onChange={(event) => {
              setTargetRole(event.target.value as InviteRole);
              resetMutationResult();
            }}
            className="dashboard-field h-10"
          >
            <option value="worker">Worker</option>
            <option value="user">User</option>
            <option value="basic">Basic</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Verified email (optional)</span>
          <input
            type="email"
            value={targetEmail}
            disabled={pending}
            onChange={(event) => {
              setTargetEmail(event.target.value);
              resetMutationResult();
            }}
            maxLength={320}
            autoComplete="off"
            placeholder="technician@example.com"
            className="dashboard-field h-10"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Expires in days</span>
          <input
            type="number"
            value={expiresInDays}
            disabled={pending}
            onChange={(event) => {
              setExpiresInDays(event.target.value);
              resetMutationResult();
            }}
            min={1}
            max={365}
            inputMode="numeric"
            className="dashboard-field h-10"
          />
        </label>

        <Button type="submit" disabled={pending} className="gap-2">
          <Send className="h-4 w-4" aria-hidden="true" />
          {pending ? "Creating..." : "Create invite"}
        </Button>
      </form>

      <div aria-live="polite" className="mt-4">
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {created ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
            <p className="font-medium">Invitation ready for a {created.targetRole}.</p>
            <p className="mt-1 break-all font-mono text-base font-semibold tracking-[0.08em]">{created.inviteCode}</p>
            <p className="mt-1 text-xs opacity-80">
              Expires <time dateTime={created.expiresAt}><bdi dir="ltr">{formatDateTime(created.expiresAt)}</bdi></time>
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
