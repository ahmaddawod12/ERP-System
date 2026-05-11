"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithConfiguredProvider } from "@/lib/firebase/client-auth";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";

const schema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      await signInWithConfiguredProvider(values.email, values.password);
      const redirect = searchParams.get("redirect");
      // Validate redirect is a safe internal path (no protocol-relative URLs like //evil.com)
      if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
        router.push(redirect);
        return;
      }
      router.push("/app");
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <PublicLayout>
      <section className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="page-shell grid min-h-[calc(100vh-4rem)] gap-8 py-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <Card className="mx-auto w-full max-w-lg p-8">
            <h1 className="text-center text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
              Sign in
            </h1>
            <p className="mt-2 text-center text-sm leading-7 text-slate-600 dark:text-slate-300">
              Welcome back. Continue to your Smart-Job ERP workspace.
            </p>

            <form className="mt-7 grid gap-4" onSubmit={handleSubmit(onSubmit)}>
              <Input label="Email" type="email" {...register("email")} error={errors.email?.message} />
              <Input label="Password" type="password" {...register("password")} error={errors.password?.message} />
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting ? "Signing in..." : "Sign in"}
                {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </form>
            <div className="mt-4 flex items-center justify-between text-sm">
              <Link href="/forgot-password" className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                Forgot password?
              </Link>
              <Link href="/register" className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                Create account
              </Link>
            </div>
            <div className="mt-8 border-t border-slate-200 pt-5 text-center text-xs leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Secure sign in for company-scoped operations.
            </div>
          </Card>

          <div>
            <h2 className="text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">
              Web access for the control surface your team uses every day.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
              Manage onboarding, dashboard modules, and company-scoped workflows without losing alignment with the mobile app.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                [ShieldCheck, "Secure auth", "Email and password authentication with protected route checks."],
                [Wrench, "Field-ready workflow", "Jobs, workers, documents, and inventory stay in the same system."],
                [CheckCircle2, "Clean handoff", "Registration begins on the website, then provisioning continues in onboarding."],
              ].map(([Icon, title, copy]) => (
                <div key={title as string} className="quiet-list-item">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-white">{title as string}</p>
                      <p className="mt-1 leading-7 text-slate-600 dark:text-slate-300">{copy as string}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
