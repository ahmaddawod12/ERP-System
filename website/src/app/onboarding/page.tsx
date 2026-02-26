"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Building2,
  Check,
  ChevronRight,
  Globe2,
  Palette,
  UserRound,
  Users,
} from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Locale } from "@/lib/i18n/translations";
import { useAuth } from "@/hooks/use-auth";
import { useAppToast } from "@/hooks/use-toast";
import { useLocale } from "@/hooks/use-i18n";
import { useTheme } from "@/components/providers/theme-provider";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";
import {
  buildAuthedJsonHeaders,
  withDevUidFallback,
} from "@/lib/firebase/client-auth";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    accountType: z.enum(["solo", "business"]),
    role: z.enum(["manager", "worker", "user", "basic"]),
    name: z.string().min(2, "Name is required"),
    phoneNumber: z.string().min(6, "Phone number is required"),
    companyName: z.string().optional(),
    businessNumber: z.string().optional(),
    businessAddress: z.string().optional(),
    businessPhone: z.string().optional(),
    businessCity: z.string().optional(),
    businessType: z.string().optional(),
    joinCompanyId: z.string().optional(),
    inviteCode: z.string().optional(),
    language: z.enum(["en", "he", "ar"]),
    theme: z.enum(["light", "dark"]),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === "solo" && value.role !== "user") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Solo accounts use user role.",
        path: ["role"],
      });
    }

    if (
      value.accountType === "business" &&
      value.role !== "manager" &&
      value.role !== "worker"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Business accounts must use manager or worker role.",
        path: ["role"],
      });
    }

    if (value.accountType === "business" && value.role === "manager") {
      if (!value.companyName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Company name is required",
          path: ["companyName"],
        });
      }
      if (!value.businessNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Business number is required",
          path: ["businessNumber"],
        });
      }
      if (!value.businessAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Address is required",
          path: ["businessAddress"],
        });
      }
      if (!value.businessPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Business phone is required",
          path: ["businessPhone"],
        });
      }
      if (!value.businessType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Business type is required",
          path: ["businessType"],
        });
      }
    }

    if (value.accountType === "business" && value.role === "worker") {
      if (!value.joinCompanyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "companyId is required",
          path: ["joinCompanyId"],
        });
      }
      if (!value.inviteCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invite code is required",
          path: ["inviteCode"],
        });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

const steps = [
  {
    title: "Account Model",
    description: "Choose how you will run this workspace.",
  },
  {
    title: "Profile",
    description: "Set your role and personal details.",
  },
  {
    title: "Company Setup",
    description: "Create or join a company workspace.",
  },
  {
    title: "Preferences",
    description: "Pick language and visual style.",
  },
] as const;

const profileDocPath = "users/{uid}/data/profile";
const userCacheDocPath = "users/{uid}/data/cache";
const companyRootDocPath = "companies/{companyId}";
const companyWorkerDocPath = "companies/{companyId}/workers/{uid}";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, refreshUserData } = useAuth();
  const { toast } = useAppToast();
  const { setLocale } = useLocale();
  const { setTheme } = useTheme();
  const [step, setStep] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      accountType: "solo",
      role: "user",
      language: "en",
      theme: "light",
    },
  });

  const accountType = watch("accountType");
  const role = watch("role");
  const showCompanySetup = useMemo(() => accountType === "business", [accountType]);
  const totalSteps = steps.length;
  const progress = Math.round(((step + 1) / totalSteps) * 100);
  const isWorkerJoinFlow = accountType === "business" && role === "worker";

  useEffect(() => {
    if (!user) {
      router.replace("/login");
      return;
    }
    if (profile?.role) {
      router.replace("/app");
    }
  }, [profile?.role, router, user]);

  useEffect(() => {
    if (accountType === "solo") {
      setValue("role", "user");
      return;
    }
    if (role !== "manager" && role !== "worker") {
      setValue("role", "manager");
    }
  }, [accountType, role, setValue]);

  const goNext = async () => {
    if (step === 0) {
      const ok = await trigger(["accountType"]);
      if (ok) setStep(1);
      return;
    }

    if (step === 1) {
      const ok = await trigger(["role", "name", "phoneNumber"]);
      if (!ok) return;

      if (!showCompanySetup) {
        setStep(3);
      } else {
        setStep(2);
      }
      return;
    }

    if (step === 2) {
      if (role === "manager") {
        const ok = await trigger([
          "companyName",
          "businessNumber",
          "businessAddress",
          "businessPhone",
          "businessType",
        ]);
        if (ok) setStep(3);
        return;
      }

      if (role === "worker") {
        const ok = await trigger(["joinCompanyId", "inviteCode"]);
        if (ok) setStep(3);
        return;
      }

      setStep(3);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user || !user.email) return;

    try {
      if (values.accountType === "business" && values.role === "worker") {
        // Workers join via invite. Validation and writes remain server-side.
        const response = await fetch("/api/onboarding/join-company", {
          method: "POST",
          headers: await buildAuthedJsonHeaders(),
          body: JSON.stringify(
            withDevUidFallback(
              {
                email: user.email,
                role: "worker",
                name: values.name,
                phoneNumber: values.phoneNumber,
                companyId: values.joinCompanyId?.trim(),
                inviteCode: values.inviteCode,
              },
              user.uid,
            ),
          ),
        });

        const data = (await response.json()) as ClientApiResponse<{
          companyId: string;
          role: "worker" | "user" | "basic";
        }>;

        if (!response.ok || !data.ok || !data.data.companyId) {
          throw new Error(
            getClientApiErrorMessage(data, "Invite validation failed"),
          );
        }
      } else {
        // Solo + manager onboarding goes through one atomic Cloud Function.
        const registerFn = httpsCallable<
          Record<string, unknown>,
          { success: boolean; companyId: string; role: string; tier: string }
        >(functions, "registerBusinessV1");

        await registerFn({
          role: values.accountType === "solo" ? "user" : values.role,
          accountType: values.accountType,
          name: values.name,
          phoneNumber: values.phoneNumber,
          he_name:
            values.accountType === "solo" ? values.name : (values.companyName ?? ""),
          en_name: "",
          vat_number: values.businessNumber ?? "",
          business_type:
            values.accountType === "solo" ? "solo" : (values.businessType ?? ""),
          city: values.businessCity ?? "",
          address: values.businessAddress ?? "",
          business_phone: values.businessPhone ?? "",
          business_email: user.email,
        });
      }

      setLocale(values.language as Locale);
      setTheme(values.theme);

      await refreshUserData();
      toast({
        title: "Onboarding complete",
        description: "Your profile and workspace setup were saved.",
        variant: "success",
      });
      router.push("/app");
    } catch (error) {
      toast({
        title: "Onboarding failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <PublicLayout>
      <section className="relative overflow-hidden py-12">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_10%_10%,rgba(14,165,233,0.18),transparent_35%),radial-gradient(circle_at_90%_0%,rgba(16,185,129,0.12),transparent_30%),linear-gradient(180deg,rgba(248,250,252,0.95)_0%,rgba(241,245,249,0.78)_100%)] dark:bg-[radial-gradient(circle_at_10%_10%,rgba(14,165,233,0.28),transparent_40%),radial-gradient(circle_at_90%_0%,rgba(16,185,129,0.2),transparent_35%),linear-gradient(180deg,rgba(2,6,23,0.85)_0%,rgba(2,6,23,0.96)_100%)]" />
        <div className="page-shell">
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[320px_1fr]">
            <Card className="h-fit">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
                Guided Setup
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Build your workspace in minutes
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Complete the remaining setup and we will provision your profile and company documents automatically.
              </p>

              <div className="mt-6 space-y-3">
                {steps.map((item, index) => {
                  const isActive = index === step;
                  const isCompleted = index < step;

                  return (
                    <div
                      key={item.title}
                      className={cn(
                        "rounded-xl border px-3 py-2 transition",
                        isActive
                          ? "border-cyan-400 bg-cyan-50/70 dark:border-cyan-500 dark:bg-cyan-500/10"
                          : isCompleted
                            ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/50 dark:bg-emerald-500/10"
                            : "border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/40",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                            isCompleted
                              ? "bg-emerald-500 text-white"
                              : isActive
                                ? "bg-cyan-600 text-white"
                                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
                          )}
                        >
                          {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {item.title}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  Server write flow
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700 dark:text-slate-200">
                  {isWorkerJoinFlow ? (
                    <>
                      <li>`joinCompanyV1` validates invite + company membership.</li>
                      <li>
                        <code>{profileDocPath}</code> is set with role and company.
                      </li>
                      <li>
                        <code>{companyWorkerDocPath}</code> is upserted.
                      </li>
                    </>
                  ) : (
                    <>
                      <li>`registerBusinessV1` writes all onboarding docs in one transaction.</li>
                      <li>
                        <code>{profileDocPath}</code> + <code>{userCacheDocPath}</code> are initialized.
                      </li>
                      <li>
                        <code>{companyRootDocPath}</code> + `data/business_info` + `data/cache` are initialized.
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </Card>

            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                    Step {step + 1} of {totalSteps}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                    {steps[step].title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {steps[step].description}
                  </p>
                </div>
                <p className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-200">
                  {progress}% complete
                </p>
              </div>

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <form className="mt-6 grid gap-4" onSubmit={handleSubmit(onSubmit)}>
                {step === 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label
                      className={cn(
                        "cursor-pointer rounded-2xl border p-4 transition",
                        accountType === "solo"
                          ? "border-cyan-400 bg-cyan-50/70 dark:border-cyan-500 dark:bg-cyan-500/10"
                          : "border-slate-200 hover:border-cyan-300 dark:border-slate-700 dark:hover:border-cyan-500/60",
                      )}
                    >
                      <input
                        type="radio"
                        value="solo"
                        {...register("accountType")}
                        className="sr-only"
                      />
                      <div className="flex items-center gap-3">
                        <UserRound className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Solo owner
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Personal workflow with your own company scope.
                          </p>
                        </div>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "cursor-pointer rounded-2xl border p-4 transition",
                        accountType === "business"
                          ? "border-cyan-400 bg-cyan-50/70 dark:border-cyan-500 dark:bg-cyan-500/10"
                          : "border-slate-200 hover:border-cyan-300 dark:border-slate-700 dark:hover:border-cyan-500/60",
                      )}
                    >
                      <input
                        type="radio"
                        value="business"
                        {...register("accountType")}
                        className="sr-only"
                      />
                      <div className="flex items-center gap-3">
                        <Users className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Business team
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Manager or worker setup for shared operations.
                          </p>
                        </div>
                      </div>
                    </label>
                    {errors.accountType?.message ? (
                      <p className="text-xs text-red-600">{errors.accountType.message}</p>
                    ) : null}
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="Full Name"
                        {...register("name")}
                        error={errors.name?.message}
                      />
                      <Input
                        label="Phone Number"
                        {...register("phoneNumber")}
                        error={errors.phoneNumber?.message}
                      />
                    </div>

                    {accountType === "solo" ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          Role: user
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          Solo accounts automatically use the user role.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        <label
                          className={cn(
                            "cursor-pointer rounded-2xl border p-4 transition",
                            role === "manager"
                              ? "border-cyan-400 bg-cyan-50/70 dark:border-cyan-500 dark:bg-cyan-500/10"
                              : "border-slate-200 hover:border-cyan-300 dark:border-slate-700 dark:hover:border-cyan-500/60",
                          )}
                        >
                          <input
                            type="radio"
                            value="manager"
                            {...register("role")}
                            className="sr-only"
                          />
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Manager
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Create and manage your company workspace.
                          </p>
                        </label>
                        <label
                          className={cn(
                            "cursor-pointer rounded-2xl border p-4 transition",
                            role === "worker"
                              ? "border-cyan-400 bg-cyan-50/70 dark:border-cyan-500 dark:bg-cyan-500/10"
                              : "border-slate-200 hover:border-cyan-300 dark:border-slate-700 dark:hover:border-cyan-500/60",
                          )}
                        >
                          <input
                            type="radio"
                            value="worker"
                            {...register("role")}
                            className="sr-only"
                          />
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Worker
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Join an existing company using invite code.
                          </p>
                        </label>
                      </div>
                    )}

                    {errors.role?.message ? (
                      <p className="text-xs text-red-600">{errors.role.message}</p>
                    ) : null}
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="grid gap-3">
                    {role === "manager" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input
                          label="Company Name"
                          {...register("companyName")}
                          error={errors.companyName?.message}
                        />
                        <Input
                          label="Business Number"
                          {...register("businessNumber")}
                          error={errors.businessNumber?.message}
                        />
                        <Input
                          label="Business Phone"
                          {...register("businessPhone")}
                          error={errors.businessPhone?.message}
                        />
                        <Input
                          label="City (optional)"
                          {...register("businessCity")}
                          error={errors.businessCity?.message}
                        />
                        <Input
                          label="Business Type"
                          placeholder="e.g. HVAC, Plumbing, Electrical"
                          {...register("businessType")}
                          error={errors.businessType?.message}
                        />
                        <div className="md:col-span-2">
                          <Input
                            label="Address"
                            {...register("businessAddress")}
                            error={errors.businessAddress?.message}
                          />
                        </div>
                      </div>
                    ) : null}

                    {role === "worker" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input
                          label="Company ID"
                          {...register("joinCompanyId")}
                          error={errors.joinCompanyId?.message}
                        />
                        <Input
                          label="Invite Code"
                          {...register("inviteCode")}
                          error={errors.inviteCode?.message}
                        />
                      </div>
                    ) : null}

                    {role !== "manager" && role !== "worker" ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                        No company details are needed for this role.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {step === 3 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <Globe2 className="h-4 w-4" />
                        Language
                      </span>
                      <select
                        {...register("language")}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="en">English</option>
                        <option value="he">Hebrew</option>
                        <option value="ar">Arabic</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        <Palette className="h-4 w-4" />
                        Theme
                      </span>
                      <select
                        {...register("theme")}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>

                    <div className="md:col-span-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                        {isWorkerJoinFlow ? (
                          <p>
                            Finishing setup will validate the invite and link your profile to the company workspace.
                          </p>
                        ) : (
                          <p>
                            Finishing setup will call <strong>`registerBusinessV1`</strong> to initialize your profile, cache,
                            company document, and `business_info` documents server-side.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                  {step > 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
                    >
                      Back
                    </Button>
                  ) : null}

                  {step < totalSteps - 1 ? (
                    <Button type="button" onClick={goNext} className="inline-flex items-center gap-1">
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-1">
                      {isSubmitting ? "Saving setup..." : "Finish onboarding"}
                      {!isSubmitting ? <Building2 className="h-4 w-4" /> : null}
                    </Button>
                  )}
                </div>
              </form>
            </Card>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
