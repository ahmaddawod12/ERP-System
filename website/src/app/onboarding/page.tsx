"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Locale } from "@/lib/i18n/translations";
import type { Role } from "@/lib/types";
import { writeUserProfile, writeCompanySubscription, createCompanyForManager } from "@/lib/services/firestore-service";
import { useAuth } from "@/hooks/use-auth";
import { useAppToast } from "@/hooks/use-toast";
import { useLocale } from "@/hooks/use-i18n";
import { useTheme } from "@/components/providers/theme-provider";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";
import { buildAuthedJsonHeaders, withDevUidFallback } from "@/lib/firebase/client-auth";

const schema = z
  .object({
    accountType: z.enum(["solo", "business"]),
    role: z.enum(["Manager", "Worker", "User", "Basic"]),
    name: z.string().min(2, "Name is required"),
    phoneNumber: z.string().min(6, "Phone number is required"),
    companyName: z.string().optional(),
    businessNumber: z.string().optional(),
    businessAddress: z.string().optional(),
    businessPhone: z.string().optional(),
    joinCompanyId: z.string().optional(),
    inviteCode: z.string().optional(),
    language: z.enum(["en", "he", "ar"]),
    theme: z.enum(["light", "dark"]),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === "solo" && value.role !== "User") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Solo accounts use User role.",
        path: ["role"],
      });
    }

    if (value.accountType === "business" && value.role !== "Manager" && value.role !== "Worker") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Business accounts must use Manager or Worker role.",
        path: ["role"],
      });
    }

    if (value.accountType === "business" && value.role === "Manager") {
      if (!value.companyName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Company name is required", path: ["companyName"] });
      if (!value.businessNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business number is required", path: ["businessNumber"] });
      if (!value.businessAddress) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Address is required", path: ["businessAddress"] });
      if (!value.businessPhone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Business phone is required", path: ["businessPhone"] });
    }

    if (value.accountType === "business" && value.role === "Worker") {
      if (!value.joinCompanyId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "companyId is required", path: ["joinCompanyId"] });
      if (!value.inviteCode) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invite code is required", path: ["inviteCode"] });
    }
  });

type FormValues = z.infer<typeof schema>;

const steps = ["Account Type", "Role + Profile", "Company Setup", "Preferences"] as const;

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
      role: "User",
      language: "en",
      theme: "light",
    },
  });

  const accountType = watch("accountType");
  const role = watch("role");

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
      setValue("role", "User");
      return;
    }
    if (role !== "Manager" && role !== "Worker") {
      setValue("role", "Manager");
    }
  }, [accountType, role, setValue]);

  const showCompanySetup = useMemo(() => accountType === "business", [accountType]);

  const goNext = async () => {
    if (step === 0) {
      const ok = await trigger(["accountType"]);
      if (ok) setStep(1);
      return;
    }

    if (step === 1) {
      const ok = await trigger(["role", "name", "phoneNumber"]);
      if (ok) {
        if (!showCompanySetup) {
          setStep(3);
        } else {
          setStep(2);
        }
      }
      return;
    }

    if (step === 2) {
      if (role === "Manager") {
        const ok = await trigger(["companyName", "businessNumber", "businessAddress", "businessPhone"]);
        if (ok) setStep(3);
      } else if (role === "Worker") {
        const ok = await trigger(["joinCompanyId", "inviteCode"]);
        if (ok) setStep(3);
      } else {
        setStep(3);
      }
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user || !user.email) return;

    try {
      let companyId: string | null = null;
      let joinedRole: Role | null = null;

      if (values.accountType === "business" && values.role === "Manager") {
        companyId = await createCompanyForManager({
          uid: user.uid,
          email: user.email,
          name: values.name,
          phoneNumber: values.phoneNumber,
          businessInfo: {
            name: values.companyName ?? "",
            number: values.businessNumber ?? "",
            address: values.businessAddress ?? "",
            phone: values.businessPhone ?? "",
          },
        });
      }

      if (values.accountType === "business" && values.role === "Worker") {
        const response = await fetch("/api/onboarding/join-company", {
          method: "POST",
          headers: await buildAuthedJsonHeaders(),
          body: JSON.stringify(
            withDevUidFallback(
              {
                email: user.email,
                role: "Worker",
                name: values.name,
                phoneNumber: values.phoneNumber,
                companyId: values.joinCompanyId,
                inviteCode: values.inviteCode,
              },
              user.uid,
            ),
          ),
        });
        const data = (await response.json()) as ClientApiResponse<{
          companyId: string;
          role: "Worker" | "User" | "Basic";
        }>;
        if (!response.ok || !data.ok || !data.data.companyId) {
          throw new Error(getClientApiErrorMessage(data, "Invite validation failed"));
        }
        companyId = data.data.companyId;
        joinedRole = data.data.role;
      }

      const resolvedRole = values.accountType === "solo" ? "User" : joinedRole ?? values.role;

      await writeUserProfile(user.uid, {
        role: resolvedRole as Role,
        email: user.email,
        companyId,
        name: values.name,
        phoneNumber: values.phoneNumber,
        accountType: values.accountType,
      });

      if (values.accountType !== "business" || values.role !== "Worker") {
        const subscriptionCompanyId = companyId ?? user.uid;
        await writeCompanySubscription(subscriptionCompanyId, {
          role: resolvedRole as Role,
          accountType: values.accountType,
        });
      }

      setLocale(values.language as Locale);
      setTheme(values.theme);

      await refreshUserData();
      toast({
        title: "Onboarding complete",
        description: "Your profile and account preferences were saved.",
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
      <section className="page-shell py-12">
        <div className="mx-auto max-w-3xl">
          <Card>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Onboarding Wizard</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Complete account setup for Smart-Job ERP website access.</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {steps.map((label, index) => (
                <div
                  key={label}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    index === step
                      ? "bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {index + 1}. {label}
                </div>
              ))}
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSubmit(onSubmit)}>
              {step === 0 ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Choose account type</p>
                  <label className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <input type="radio" value="solo" {...register("accountType")} className="me-2" />
                    Solo owner
                  </label>
                  <label className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <input type="radio" value="business" {...register("accountType")} className="me-2" />
                    Business with workers
                  </label>
                  {errors.accountType?.message ? <p className="text-xs text-red-600">{errors.accountType.message}</p> : null}
                </div>
              ) : null}

              {step === 1 ? (
                <div className="grid gap-3">
                  <Input label="Full Name" {...register("name")} error={errors.name?.message} />
                  <Input label="Phone Number" {...register("phoneNumber")} error={errors.phoneNumber?.message} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Role</span>
                    <select
                      {...register("role")}
                      disabled={accountType === "solo"}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-800"
                    >
                      {accountType === "solo" ? (
                        <option value="User">User</option>
                      ) : (
                        <>
                          <option value="Manager">Manager</option>
                          <option value="Worker">Worker</option>
                        </>
                      )}
                    </select>
                    {accountType === "solo" ? <p className="text-xs text-slate-500 dark:text-slate-400">Solo account defaults to User role.</p> : null}
                    {errors.role?.message ? <p className="text-xs text-red-600">{errors.role.message}</p> : null}
                  </label>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="grid gap-3">
                  {role === "Manager" ? (
                    <>
                      <Input label="Company Name" {...register("companyName")} error={errors.companyName?.message} />
                      <Input label="Business Number" {...register("businessNumber")} error={errors.businessNumber?.message} />
                      <Input label="Address" {...register("businessAddress")} error={errors.businessAddress?.message} />
                      <Input label="Business Phone" {...register("businessPhone")} error={errors.businessPhone?.message} />
                    </>
                  ) : null}

                  {role === "Worker" ? (
                    <>
                      <Input label="Company ID" {...register("joinCompanyId")} error={errors.joinCompanyId?.message} />
                      <Input label="Invite Code" {...register("inviteCode")} error={errors.inviteCode?.message} />
                    </>
                  ) : null}

                  {role !== "Manager" && role !== "Worker" ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">No additional company setup is required for this role.</p>
                  ) : null}
                </div>
              ) : null}

              {step === 3 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Language</span>
                    <select
                      {...register("language")}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="en">English</option>
                      <option value="he">Hebrew</option>
                      <option value="ar">Arabic</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Theme</span>
                    <select
                      {...register("theme")}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {step > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => setStep((prev) => Math.max(prev - 1, 0))}>
                    Back
                  </Button>
                ) : null}
                {step < 3 ? (
                  <Button type="button" onClick={goNext}>
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : "Finish onboarding"}
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
