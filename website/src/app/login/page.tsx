"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { auth } from "@/lib/firebase/client";
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

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      await signInWithEmailAndPassword(auth, values.email, values.password);
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
      <section className="page-shell py-12">
        <div className="mx-auto max-w-md">
          <Card>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Login</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Access your Smart-Job ERP web account.</p>
            <form className="mt-5 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
              <Input label="Email" type="email" {...register("email")} error={errors.email?.message} />
              <Input label="Password" type="password" {...register("password")} error={errors.password?.message} />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Sign in"}
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
