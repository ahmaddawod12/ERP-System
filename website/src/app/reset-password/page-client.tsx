"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PublicLayout } from "@/components/layout/public-layout";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Confirm your password"),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordClient() {
  const router = useRouter();
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const accessToken = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    return url.hash ? new URLSearchParams(url.hash.slice(1)).get("access_token") || "" : "";
  }, []);

  const onSubmit = async (values: FormValues) => {
    try {
      if (!accessToken) {
        throw new Error("Reset link is missing or expired");
      }

      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, password: values.password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to reset password");
      }

      toast({
        title: "Password updated",
        description: "Your password has been reset. You can sign in now.",
        variant: "success",
      });
      router.replace("/login");
    } catch (error) {
      toast({
        title: "Password reset failed",
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
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Reset password</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Choose a new password for your account.</p>
            <form className="mt-5 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
              <Input label="New password" type="password" {...register("password")} error={errors.password?.message} />
              <Input label="Confirm password" type="password" {...register("confirmPassword")} error={errors.confirmPassword?.message} />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Updating..." : "Reset password"}
              </Button>
            </form>
          </Card>
        </div>
      </section>
    </PublicLayout>
  );
}
