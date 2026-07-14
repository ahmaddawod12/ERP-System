"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ViewerProfileSchema,
  ViewerProfileUpdateRequestSchema,
  createApiResponseSchema,
} from "@smart-job/api-contracts";
import { Save, UserRound } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

const formSchema = z.object({
  displayName: z.string().trim().max(200, "Use at most 200 characters."),
  phoneNumber: z.string().trim().max(40, "Use at most 40 characters."),
}).strict();
const responseSchema = createApiResponseSchema(ViewerProfileSchema);

type FormValues = z.infer<typeof formSchema>;

interface PendingIdentity {
  readonly fingerprint: string;
  readonly key: string;
}

export interface ViewerProfileFormInitial {
  readonly displayName: string | null;
  readonly phoneNumber: string | null;
}

function nullableField(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function ViewerProfileForm({
  companyId,
  initial,
}: {
  companyId: number;
  initial: ViewerProfileFormInitial;
}) {
  const [message, setMessage] = useState<{
    readonly kind: "error" | "success";
    readonly text: string;
  } | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PendingIdentity | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { dirtyFields, errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: initial.displayName ?? "",
      phoneNumber: initial.phoneNumber ?? "",
    },
  });
  const displayName = useWatch({ control, name: "displayName", exact: true });

  async function submit(values: FormValues): Promise<void> {
    setMessage(null);
    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setMessage({
        kind: "error",
        text: "Your session could not be verified. Reload the page and try again.",
      });
      return;
    }

    const request = ViewerProfileUpdateRequestSchema.safeParse({
      companyId,
      ...(dirtyFields.displayName
        ? { displayName: nullableField(values.displayName) }
        : {}),
      ...(dirtyFields.phoneNumber
        ? { phoneNumber: nullableField(values.phoneNumber) }
        : {}),
    });
    if (!request.success) {
      setMessage({ kind: "error", text: "Check the profile fields and try again." });
      return;
    }

    const fingerprint = JSON.stringify(request.data);
    const idempotencyKey = pendingIdentity?.fingerprint === fingerprint
      ? pendingIdentity.key
      : crypto.randomUUID();
    if (pendingIdentity?.fingerprint !== fingerprint) {
      setPendingIdentity({ fingerprint, key: idempotencyKey });
    }

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-SJ-CSRF": csrfToken,
        },
        body: JSON.stringify(request.data),
      });
      const payload = responseSchema.safeParse(await response.json().catch(() => null));
      if (!payload.success) {
        setMessage({ kind: "error", text: "The server returned an invalid response. Try again." });
        return;
      }
      if (!payload.data.ok) {
        const fieldErrors = payload.data.error.fieldErrors;
        if (fieldErrors?.displayName?.[0]) {
          setError("displayName", { type: "server", message: fieldErrors.displayName[0] });
        }
        if (fieldErrors?.phoneNumber?.[0]) {
          setError("phoneNumber", { type: "server", message: fieldErrors.phoneNumber[0] });
        }
        setMessage({ kind: "error", text: payload.data.error.message });
        return;
      }

      reset({
        displayName: payload.data.data.displayName ?? "",
        phoneNumber: payload.data.data.phoneNumber ?? "",
      });
      setPendingIdentity(null);
      setMessage({ kind: "success", text: "Your profile was saved." });
    } catch {
      setMessage({
        kind: "error",
        text: "The profile could not be saved. Check your connection and retry.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} aria-label="Personal profile settings">
      <Card className="h-full">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Personal profile</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              These details identify you inside the selected workspace.
            </p>
          </div>
        </div>

        <fieldset disabled={isSubmitting} className="mt-5 grid gap-4">
          <div>
            <Input
              label="Display name"
              autoComplete="name"
              maxLength={200}
              {...register("displayName")}
              error={errors.displayName?.message}
            />
            <p className="mt-1 text-right text-xs text-slate-500 dark:text-slate-400">
              {displayName.length}/200
            </p>
          </div>
          <Input
            label="Phone number"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            {...register("phoneNumber")}
            error={errors.phoneNumber?.message}
          />
        </fieldset>

        <div aria-live="polite" className="mt-4 min-h-5">
          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error"
                ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"}
            >
              {message.text}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={isSubmitting || !isDirty} className="gap-2">
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Saving..." : "Save personal profile"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
