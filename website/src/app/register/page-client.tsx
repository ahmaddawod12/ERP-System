"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { signInWithConfiguredProvider } from "@/lib/firebase/client-auth";

const schema = z
  .object({
    email: z.string().email("Valid email is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Confirm your password"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

const setupFlow = [
  {
    title: "Create account",
    description: "Email + password with Supabase Authentication.",
  },
  {
    title: "Add profile and business info",
    description: "Guided onboarding collects name, role, and company details.",
  },
  {
    title: "Cloud Function provisioning",
    description:
      "registerBusinessV1 initializes profile, cache, company, and business_info docs.",
  },
] as const;

export default function RegisterClient() {
  const router = useRouter();
  const { toast } = useAppToast();
  const { user, profile } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!user) return;
    if (profile?.role) {
      router.replace("/app");
      return;
    }
    router.replace("/onboarding");
  }, [profile?.role, router, user]);

  const onSubmit = async (values: FormValues) => {
    try {
      const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
      const supabaseAnonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase auth is not configured");
      }

      const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error_description?: unknown; msg?: unknown };
      if (!response.ok) {
        throw new Error(String(payload.error_description || payload.msg || "Registration failed"));
      }

      await signInWithConfiguredProvider(values.email, values.password);

      toast({
        title: "Account created",
        description: "Continue through onboarding to save role and business setup.",
        variant: "success",
      });
      router.push("/onboarding");
    } catch (error) {
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <PublicLayout>
      <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell py-12">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <div>
              <p className="section-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Step 1 of 2
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 dark:text-white">
                Create your Smart-Job ERP account
              </h1>
              <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
                Registration is now a guided flow: create account first, then complete onboarding in modern step-by-step screens.
              </p>

              <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-900/70 dark:bg-blue-950/30">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-300" />
                  <div>
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">Backend provisioning stays protected</p>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      Account creation happens here, while company-scoped setup continues through server-backed onboarding.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {setupFlow.map((item, index) => (
                  <div
                    key={item.title}
                    className="quiet-list-item"
                  >
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                        {index + 1}
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
                ))}
              </div>
            </div>

            <Card className="p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                Start with account credentials
              </h2>
              <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                You will enter your name and business details in the next onboarding step.
              </p>

              <form className="mt-5 grid gap-4" onSubmit={handleSubmit(onSubmit)}>
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                  error={errors.email?.message}
                />
                <Input
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  {...register("password")}
                  error={errors.password?.message}
                />
                <Input
                  label="Confirm Password"
                  type="password"
                  autoComplete="new-password"
                  {...register("confirmPassword")}
                  error={errors.confirmPassword?.message}
                />

                <Button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-2">
                  {isSubmitting ? "Creating account..." : "Continue to onboarding"}
                  {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </form>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <p className="inline-flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Backend setup is atomic and server-side.
                </p>
                <p className="mt-1">
                  Business registration data is written by Cloud Functions, not client direct writes.
                </p>
              </div>

              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-blue-700 hover:underline dark:text-blue-300">
                  Login
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
