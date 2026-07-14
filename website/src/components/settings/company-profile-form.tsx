"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BusinessProfileSchema,
  BusinessProfileUpdateRequestSchema,
  createApiResponseSchema,
  type EntityVersion,
} from "@smart-job/api-contracts";
import { Building2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";

const optionalEmail = z.union([
  z.literal(""),
  z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(320)),
]);
const formSchema = z.object({
  heName: z.string().trim().max(200, "Use at most 200 characters."),
  enName: z.string().trim().max(200, "Use at most 200 characters."),
  businessType: z.string().trim().max(120, "Use at most 120 characters."),
  city: z.string().trim().max(120, "Use at most 120 characters."),
  address: z.string().trim().max(500, "Use at most 500 characters."),
  businessEmail: optionalEmail,
  businessPhone: z.string().trim().max(40, "Use at most 40 characters."),
  businessFax: z.string().trim().max(40, "Use at most 40 characters."),
  accountantName: z.string().trim().max(200, "Use at most 200 characters."),
  accountantEmail: optionalEmail,
  accountantPhone: z.string().trim().max(40, "Use at most 40 characters."),
}).strict();
const responseSchema = createApiResponseSchema(BusinessProfileSchema);

type FormValues = z.infer<typeof formSchema>;

interface PendingIdentity {
  readonly fingerprint: string;
  readonly key: string;
}

export interface CompanyProfileFormInitial extends FormValues {
  readonly entityVersion: EntityVersion;
}

function nullableField(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function valuesFromProfile(profile: z.infer<typeof BusinessProfileSchema>): FormValues {
  return {
    heName: profile.heName ?? "",
    enName: profile.enName ?? "",
    businessType: profile.businessType ?? "",
    city: profile.city ?? "",
    address: profile.address ?? "",
    businessEmail: profile.businessEmail ?? "",
    businessPhone: profile.businessPhone ?? "",
    businessFax: profile.businessFax ?? "",
    accountantName: profile.accountantName ?? "",
    accountantEmail: profile.accountantEmail ?? "",
    accountantPhone: profile.accountantPhone ?? "",
  };
}

export function CompanyProfileForm({
  companyId,
  initial,
  canEdit,
}: {
  companyId: number;
  initial: CompanyProfileFormInitial;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{
    readonly kind: "conflict" | "error" | "success";
    readonly text: string;
  } | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PendingIdentity | null>(null);
  const [entityVersion, setEntityVersion] = useState<EntityVersion>(initial.entityVersion);
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
      heName: initial.heName,
      enName: initial.enName,
      businessType: initial.businessType,
      city: initial.city,
      address: initial.address,
      businessEmail: initial.businessEmail,
      businessPhone: initial.businessPhone,
      businessFax: initial.businessFax,
      accountantName: initial.accountantName,
      accountantEmail: initial.accountantEmail,
      accountantPhone: initial.accountantPhone,
    },
  });
  const address = useWatch({ control, name: "address", exact: true });

  async function submit(values: FormValues): Promise<void> {
    if (!canEdit) return;
    setMessage(null);
    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setMessage({
        kind: "error",
        text: "Your session could not be verified. Reload the page and try again.",
      });
      return;
    }

    const profile = BusinessProfileUpdateRequestSchema.safeParse({
      entityVersion,
      ...(dirtyFields.heName ? { heName: nullableField(values.heName) } : {}),
      ...(dirtyFields.enName ? { enName: nullableField(values.enName) } : {}),
      ...(dirtyFields.businessType
        ? { businessType: nullableField(values.businessType) }
        : {}),
      ...(dirtyFields.city ? { city: nullableField(values.city) } : {}),
      ...(dirtyFields.address ? { address: nullableField(values.address) } : {}),
      ...(dirtyFields.businessEmail
        ? { businessEmail: nullableField(values.businessEmail) }
        : {}),
      ...(dirtyFields.businessPhone
        ? { businessPhone: nullableField(values.businessPhone) }
        : {}),
      ...(dirtyFields.businessFax
        ? { businessFax: nullableField(values.businessFax) }
        : {}),
      ...(dirtyFields.accountantName
        ? { accountantName: nullableField(values.accountantName) }
        : {}),
      ...(dirtyFields.accountantEmail
        ? { accountantEmail: nullableField(values.accountantEmail) }
        : {}),
      ...(dirtyFields.accountantPhone
        ? { accountantPhone: nullableField(values.accountantPhone) }
        : {}),
    });
    if (!profile.success) {
      setMessage({ kind: "error", text: "Check the company fields and try again." });
      return;
    }

    const body = { companyId, profile: profile.data };
    const fingerprint = JSON.stringify(body);
    const idempotencyKey = pendingIdentity?.fingerprint === fingerprint
      ? pendingIdentity.key
      : crypto.randomUUID();
    if (pendingIdentity?.fingerprint !== fingerprint) {
      setPendingIdentity({ fingerprint, key: idempotencyKey });
    }

    try {
      const response = await fetch("/api/settings/company-profile", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-SJ-CSRF": csrfToken,
        },
        body: JSON.stringify(body),
      });
      const payload = responseSchema.safeParse(await response.json().catch(() => null));
      if (!payload.success) {
        setMessage({ kind: "error", text: "The server returned an invalid response. Try again." });
        return;
      }
      if (!payload.data.ok) {
        if (payload.data.error.code === "STALE_ENTITY_VERSION") {
          setMessage({
            kind: "conflict",
            text: "This company profile changed elsewhere. Reload the latest values before saving again.",
          });
          return;
        }
        const fieldErrors = payload.data.error.fieldErrors;
        for (const field of Object.keys(formSchema.shape) as Array<keyof FormValues>) {
          const fieldMessage = fieldErrors?.[field]?.[0];
          if (fieldMessage) setError(field, { type: "server", message: fieldMessage });
        }
        setMessage({ kind: "error", text: payload.data.error.message });
        return;
      }

      setEntityVersion(payload.data.data.entityVersion);
      reset(valuesFromProfile(payload.data.data));
      setPendingIdentity(null);
      setMessage({ kind: "success", text: "The company profile was saved." });
    } catch {
      setMessage({
        kind: "error",
        text: "The company profile could not be saved. Check your connection and retry.",
      });
    }
  }

  const formDisabled = isSubmitting || !canEdit;
  return (
    <form onSubmit={handleSubmit(submit)} aria-label="Company profile settings">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Company profile</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Business and accountant contact details for this workspace.
              </p>
            </div>
          </div>
          {!canEdit ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Read-only for your role
            </span>
          ) : null}
        </div>

        <fieldset disabled={formDisabled} aria-disabled={formDisabled} className="mt-5 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Company name (Hebrew)" maxLength={200} readOnly={!canEdit} {...register("heName")} error={errors.heName?.message} />
            <Input label="Company name (English)" maxLength={200} readOnly={!canEdit} {...register("enName")} error={errors.enName?.message} />
            <Input label="Business type" maxLength={120} readOnly={!canEdit} {...register("businessType")} error={errors.businessType?.message} />
            <Input label="City" maxLength={120} readOnly={!canEdit} {...register("city")} error={errors.city?.message} />
            <Input label="Business email" type="email" maxLength={320} readOnly={!canEdit} {...register("businessEmail")} error={errors.businessEmail?.message} />
            <Input label="Business phone" type="tel" maxLength={40} readOnly={!canEdit} {...register("businessPhone")} error={errors.businessPhone?.message} />
            <Input label="Business fax" type="tel" maxLength={40} readOnly={!canEdit} {...register("businessFax")} error={errors.businessFax?.message} />
            <Input label="Accountant name" maxLength={200} readOnly={!canEdit} {...register("accountantName")} error={errors.accountantName?.message} />
            <Input label="Accountant email" type="email" maxLength={320} readOnly={!canEdit} {...register("accountantEmail")} error={errors.accountantEmail?.message} />
            <Input label="Accountant phone" type="tel" maxLength={40} readOnly={!canEdit} {...register("accountantPhone")} error={errors.accountantPhone?.message} />
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Business address</span>
            <textarea
              rows={3}
              maxLength={500}
              readOnly={!canEdit}
              className="dashboard-field min-h-24 resize-y py-2"
              aria-invalid={Boolean(errors.address)}
              aria-describedby={errors.address ? "company-address-error" : undefined}
              {...register("address")}
            />
            <span className="flex justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span id="company-address-error" className="text-red-600">{errors.address?.message}</span>
              <span className="ml-auto">{address.length}/500</span>
            </span>
          </label>
        </fieldset>

        <div aria-live="polite" className="mt-4 min-h-5">
          {message ? (
            <div
              role={message.kind === "success" ? "status" : "alert"}
              className={message.kind === "success"
                ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"
                : message.kind === "conflict"
                  ? "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
                  : "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"}
            >
              <p>{message.text}</p>
              {message.kind === "conflict" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-3 gap-2"
                  onClick={() => router.refresh()}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reload latest profile
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
            VAT is immutable after onboarding and is intentionally not part of this form.
          </p>
          <Button type="submit" disabled={formDisabled || !isDirty} className="gap-2">
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Saving..." : canEdit ? "Save company profile" : "Company profile locked"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
