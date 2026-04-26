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
      <section className="page-shell pb-16 pt-8 sm:pt-10">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="mesh-card p-7 sm:p-8">
            <p className="section-kicker">Web access</p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              Sign in to the web control surface for your operation.
            </h1>
            <p className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
              Use the website to manage onboarding, dashboard modules, and company-scoped workflows without losing alignment with the mobile app.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                [ShieldCheck, "Secure auth", "Email and password authentication with protected route checks."],
                [Wrench, "Field-ready workflow", "Jobs, workers, documents, and inventory stay in the same system."],
                [CheckCircle2, "Clean handoff", "Registration begins on the website, then provisioning continues in onboarding."],
              ].map(([Icon, title, copy]) => (
                <div key={title as string} className="rounded-[1.4rem] border border-slate-200/70 bg-white/75 px-4 py-4 dark:border-white/10 dark:bg-slate-900/55">
                  <Icon className="h-5 w-5 text-slate-950 dark:text-white" />
                  <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{title as string}</p>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{copy as string}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="glass-panel rounded-4xl p-6 sm:p-8">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-100">Login</h2>
            <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
              Access your Smart-Job ERP web account.
            </p>
            <form className="mt-5 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
              <Input label="Email" type="email" {...register("email")} error={errors.email?.message} />
              <Input label="Password" type="password" {...register("password")} error={errors.password?.message} />
              <Button type="submit" disabled={isSubmitting} className="rounded-2xl gap-2">
                {isSubmitting ? "Signing in..." : "Sign in"}
                {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>
            </form>
            <div className="mt-4 flex items-center justify-between text-sm">
              <Link href="/forgot-password" className="font-medium text-cyan-700 hover:underline dark:text-cyan-400">
                Forgot password?
              </Link>
              <Link href="/register" className="font-medium text-cyan-700 hover:underline dark:text-cyan-400">
                Create account
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
