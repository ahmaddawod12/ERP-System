"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  UpgradeRequestCreateRequestSchema,
  type UpgradeRequestSummary,
} from "@smart-job/api-contracts";
import { UPGRADEABLE_TIERS } from "@smart-job/contracts";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";
import { Button } from "@/components/ui/Button";

const UpgradeFormSchema = UpgradeRequestCreateRequestSchema.omit({ companyId: true });
type UpgradeFormValues = z.infer<typeof UpgradeFormSchema>;

interface UpgradeMutationResponse {
  readonly ok: boolean;
  readonly data?: UpgradeRequestSummary;
  readonly error?: { readonly message?: string };
}

export function UpgradeRequestForm({ companyId }: { companyId: number }) {
  const idempotencyKey = useRef<string | null>(null);
  const [submitted, setSubmitted] = useState<UpgradeRequestSummary | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpgradeFormValues>({
    resolver: zodResolver(UpgradeFormSchema),
    defaultValues: {
      requestedTier: "Team",
      message: "",
    },
  });

  async function submit(values: UpgradeFormValues) {
    const csrf = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrf) {
      setServerError("Your session could not be verified. Reload and try again.");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    setServerError(null);
    const response = await fetch("/api/upgrade-requests", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.current,
        "X-SJ-CSRF": csrf,
      },
      body: JSON.stringify({ companyId, ...values }),
    });
    const payload = await response.json().catch(() => null) as UpgradeMutationResponse | null;
    if (!response.ok || payload?.ok !== true || payload.data === undefined) {
      setServerError(payload?.error?.message ?? "The upgrade request could not be sent.");
      return;
    }
    setSubmitted(payload.data);
    idempotencyKey.current = null;
    reset({ requestedTier: values.requestedTier, message: "" });
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => { void handleSubmit(submit)(event); }}
    >
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Requested tier</span>
        <select {...register("requestedTier")} className="dashboard-field h-11">
          {UPGRADEABLE_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Business need</span>
        <textarea
          {...register("message")}
          rows={6}
          className="dashboard-field min-h-36 resize-y"
          placeholder="Describe the team size, workflow, and modules you need."
        />
        {errors.message?.message ? <span className="text-xs text-red-600">{errors.message.message}</span> : null}
      </label>
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
      {serverError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{serverError}</p> : null}
      {submitted ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Request received: {submitted.currentTier} → {submitted.requestedTier}. Status: {submitted.status}.
        </p>
      ) : null}
    </form>
  );
}
