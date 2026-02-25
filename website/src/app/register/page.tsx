"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

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
    description: "Email + password with Firebase Authentication.",
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

export default function RegisterPage() {
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
      await createUserWithEmailAndPassword(auth, values.email, values.password);
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
      <section className="relative overflow-hidden py-12">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_10%_15%,rgba(14,165,233,0.2),transparent_38%),radial-gradient(circle_at_85%_0%,rgba(16,185,129,0.12),transparent_32%),linear-gradient(180deg,rgba(248,250,252,0.95)_0%,rgba(241,245,249,0.82)_100%)] dark:bg-[radial-gradient(circle_at_10%_15%,rgba(14,165,233,0.28),transparent_44%),radial-gradient(circle_at_85%_0%,rgba(16,185,129,0.2),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.88)_0%,rgba(2,6,23,0.96)_100%)]" />

        <div className="page-shell">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_1.15fr]">
            <Card className="h-fit">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
                Step 1 of 2
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                Create your Smart-Job ERP account
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Registration is now a guided flow: create account first, then complete onboarding in modern step-by-step screens.
              </p>

              <div className="mt-6 space-y-3">
                {setupFlow.map((item, index) => (
                  <div
                    key={item.title}
                    className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-600 text-xs font-semibold text-white">
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
            </Card>

            <Card>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Start with account credentials</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                You will enter your name and business details in the next onboarding step.
              </p>

              <form className="mt-5 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
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

                <Button type="submit" disabled={isSubmitting} className="inline-flex items-center gap-1">
                  {isSubmitting ? "Creating account..." : "Continue to onboarding"}
                  {!isSubmitting ? <ChevronRight className="h-4 w-4" /> : null}
                </Button>
              </form>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
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
                <Link href="/login" className="font-semibold text-cyan-700 hover:underline dark:text-cyan-400">
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
