"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BusinessRegistrationResultSchema,
  InvitationRedemptionResultSchema,
  createApiResponseSchema,
  type Viewer,
} from "@smart-job/api-contracts";
import {
  Building2,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { OpaqueSessionLogout } from "@/components/auth/opaque-session-logout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useAppToast } from "@/hooks/use-toast";
import { useLocale } from "@/hooks/use-i18n";
import { useTheme } from "@/components/providers/theme-provider";
import { readCookie, WEB_CSRF_COOKIE } from "@/lib/auth/opaque-session";
import type { Locale } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";

const flowValues = ["solo", "business", "basic", "join"] as const;

const schema = z.object({
  flow: z.enum(flowValues),
  displayName: z.string().trim().min(2, "Name is required").max(200),
  phoneNumber: z.string().trim().min(6, "Phone number is required").max(40),
  companyName: z.string().trim().max(200).optional(),
  vatNumber: z.string().trim().max(32).optional(),
  businessType: z.string().trim().max(120).optional(),
  businessAddress: z.string().trim().max(500).optional(),
  businessCity: z.string().trim().max(120).optional(),
  businessPhone: z.string().trim().max(40).optional(),
  companyId: z.string().trim().optional(),
  inviteCode: z.string().trim().optional(),
  language: z.enum(["en", "he", "ar"]),
  theme: z.enum(["light", "dark"]),
}).strict().superRefine((value, context) => {
  if (value.flow === "business") {
    const required = [
      ["companyName", value.companyName, "Company name is required"],
      ["vatNumber", value.vatNumber, "VAT or business number is required"],
      ["businessType", value.businessType, "Business type is required"],
      ["businessAddress", value.businessAddress, "Business address is required"],
      ["businessPhone", value.businessPhone, "Business phone is required"],
    ] as const;
    for (const [field, fieldValue, message] of required) {
      if (!fieldValue) {
        context.addIssue({ code: "custom", path: [field], message });
      }
    }
  }

  if (value.flow === "join") {
    if (!value.companyId || !/^[1-9]\d*$/.test(value.companyId)) {
      context.addIssue({
        code: "custom",
        path: ["companyId"],
        message: "Enter the numeric company ID from your invitation",
      });
    }
    if (!value.inviteCode || value.inviteCode.length < 4 || value.inviteCode.length > 80) {
      context.addIssue({
        code: "custom",
        path: ["inviteCode"],
        message: "Enter a valid invitation code",
      });
    }
  }
});

type FormValues = z.infer<typeof schema>;

const registrationResponseSchema = createApiResponseSchema(BusinessRegistrationResultSchema);
const invitationResponseSchema = createApiResponseSchema(InvitationRedemptionResultSchema);

const choices = [
  {
    value: "solo",
    title: "Solo workspace",
    description: "A full field-service workspace for one owner.",
    icon: UserRound,
  },
  {
    value: "business",
    title: "Business team",
    description: "Create a company workspace and manage a team.",
    icon: Building2,
  },
  {
    value: "basic",
    title: "Basic workspace",
    description: "Start with a lightweight personal workspace.",
    icon: CheckCircle2,
  },
  {
    value: "join",
    title: "Join by invitation",
    description: "Use the company ID and code sent by a manager.",
    icon: KeyRound,
  },
] as const;

export default function OnboardingClient({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const { toast } = useAppToast();
  const { setLocale } = useLocale();
  const { setTheme } = useTheme();
  const [idempotency, setIdempotency] = useState<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      flow: "solo",
      displayName: viewer.displayName ?? "",
      phoneNumber: "",
      language: "en",
      theme: "light",
    },
  });
  const flow = useWatch({ control, name: "flow" });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    const csrfToken = readCookie(document.cookie, WEB_CSRF_COOKIE);
    if (!csrfToken) {
      setSubmitError("Your session could not be verified. Reload the page and try again.");
      return;
    }

    const isInvitation = values.flow === "join";
    const endpoint = isInvitation
      ? "/api/onboarding/invitation"
      : "/api/onboarding/business-registration";
    const body = isInvitation
      ? {
          companyId: Number(values.companyId),
          inviteCode: values.inviteCode?.trim().toUpperCase(),
          displayName: values.displayName,
          phoneNumber: values.phoneNumber,
        }
      : {
          workspaceMode: values.flow,
          displayName: values.displayName,
          phoneNumber: values.phoneNumber,
          ...(values.flow === "business"
            ? {
                businessProfile: {
                  name: values.companyName,
                  englishName: values.companyName,
                  vatNumber: values.vatNumber,
                  businessType: values.businessType,
                  city: values.businessCity,
                  address: values.businessAddress,
                  phone: values.businessPhone,
                },
              }
            : {}),
        };
    const fingerprint = `${endpoint}:${JSON.stringify(body)}`;
    const idempotencyKey = idempotency?.fingerprint === fingerprint
      ? idempotency.key
      : crypto.randomUUID();
    if (idempotency?.fingerprint !== fingerprint) {
      setIdempotency({ fingerprint, key: idempotencyKey });
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-SJ-CSRF": csrfToken,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const rawPayload: unknown = await response.json().catch(() => null);
      const parsed = isInvitation
        ? invitationResponseSchema.safeParse(rawPayload)
        : registrationResponseSchema.safeParse(rawPayload);
      if (!parsed.success) {
        throw new Error("The server returned an invalid onboarding response.");
      }
      if (!parsed.data.ok) {
        throw new Error(parsed.data.error.message);
      }

      setLocale(values.language as Locale);
      setTheme(values.theme);
      toast({
        title: isInvitation ? "Invitation accepted" : "Workspace created",
        description: `Opening ${parsed.data.data.workspace.name}.`,
        variant: "success",
      });
      router.replace(`/app/c/${parsed.data.data.workspace.companyId}`);
      router.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Onboarding failed. Try again.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="border-b border-slate-200 bg-white py-10 dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-kicker">
                <ShieldCheck className="h-4 w-4" />
                Verified account
              </p>
              <h1 className="mt-4 text-3xl font-semibold text-slate-950 dark:text-white">
                Set up your workspace
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Signed in as {viewer.email ?? "a verified Smart-Job user"}. Your role and access are assigned by the server.
              </p>
            </div>
            <OpaqueSessionLogout />
          </div>

          <form className="mx-auto mt-8 grid max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]" onSubmit={handleSubmit(onSubmit)}>
            <Card className="h-fit p-5">
              <fieldset disabled={isSubmitting}>
                <legend className="text-lg font-semibold text-slate-950 dark:text-white">
                  Choose a setup path
                </legend>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  You can belong to more than one company later.
                </p>
                <div className="mt-5 grid gap-3">
                  {choices.map(({ value, title, description, icon: Icon }) => (
                    <label
                      key={value}
                      className={cn(
                        "cursor-pointer rounded-xl border p-4 transition",
                        flow === value
                          ? "border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40"
                          : "border-slate-200 hover:border-blue-300 dark:border-slate-800 dark:hover:border-blue-800",
                      )}
                    >
                      <input className="sr-only" type="radio" value={value} {...register("flow")} />
                      <span className="flex items-start gap-3">
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
                        <span>
                          <span className="block text-sm font-semibold text-slate-950 dark:text-white">{title}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>

            <Card className="p-5 sm:p-6">
              <fieldset disabled={isSubmitting} className="grid gap-4">
                <legend className="text-lg font-semibold text-slate-950 dark:text-white">
                  {flow === "join" ? "Invitation details" : "Workspace details"}
                </legend>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Your name" autoComplete="name" {...register("displayName")} error={errors.displayName?.message} />
                  <Input label="Your phone" type="tel" autoComplete="tel" {...register("phoneNumber")} error={errors.phoneNumber?.message} />
                </div>

                {flow === "business" ? (
                  <div className="grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2">
                    <Input label="Company name" {...register("companyName")} error={errors.companyName?.message} />
                    <Input label="VAT / business number" inputMode="numeric" {...register("vatNumber")} error={errors.vatNumber?.message} />
                    <Input label="Business type" {...register("businessType")} error={errors.businessType?.message} />
                    <Input label="Business phone" type="tel" {...register("businessPhone")} error={errors.businessPhone?.message} />
                    <Input label="City (optional)" {...register("businessCity")} error={errors.businessCity?.message} />
                    <Input label="Business address" {...register("businessAddress")} error={errors.businessAddress?.message} />
                  </div>
                ) : null}

                {flow === "join" ? (
                  <div className="grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2">
                    <Input label="Company ID" inputMode="numeric" {...register("companyId")} error={errors.companyId?.message} />
                    <Input label="Invitation code" autoCapitalize="characters" {...register("inviteCode")} error={errors.inviteCode?.message} />
                  </div>
                ) : null}

                <div className="grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                    Language
                    <select className="h-11 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" {...register("language")}>
                      <option value="en">English</option>
                      <option value="he">Hebrew</option>
                      <option value="ar">Arabic</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                    Theme
                    <select className="h-11 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" {...register("theme")}>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                </div>
              </fieldset>

              {submitError ? (
                <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {submitError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                <p className="max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">
                  The browser sends no Supabase token. This form uses your opaque website session and a replay-safe operation key.
                </p>
                <Button type="submit" disabled={isSubmitting} className="gap-2">
                  {isSubmitting
                    ? "Saving..."
                    : flow === "join"
                      ? "Accept invitation"
                      : "Create workspace"}
                  {!isSubmitting ? <UsersRound className="h-4 w-4" /> : null}
                </Button>
              </div>
            </Card>
          </form>
        </div>
      </section>
    </div>
  );
}
