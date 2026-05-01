"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";

const schema = z.object({
  email: z.string().email("Valid email is required"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordClient() {
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
      const supabaseAnonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
      const redirectTo = typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : "";
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase auth is not configured");
      }

      const response = await fetch(`${supabaseUrl}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          email: values.email,
          ...(redirectTo ? { redirect_to: redirectTo } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error_description?: unknown; msg?: unknown };
      if (!response.ok) {
        throw new Error(String(payload.error_description || payload.msg || "Failed to send reset email"));
      }

      toast({
        title: "Reset email sent",
        description: "Check your inbox for password reset instructions.",
        variant: "success",
      });
      reset();
    } catch (error) {
      toast({
        title: "Failed to send reset email",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
  };

  return (
    <PublicLayout>
      <section className="page-shell py-12">
        <div className="mx-auto max-w-md">
          <Card>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Forgot password</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">We&apos;ll email you a reset link.</p>
            <form className="mt-5 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
              <Input label="Email" type="email" {...register("email")} error={errors.email?.message} />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send reset email"}
              </Button>
            </form>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
