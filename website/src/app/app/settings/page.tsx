"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { httpsCallable } from "firebase/functions";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { functions } from "@/lib/firebase/client";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { useLocale } from "@/hooks/use-i18n";
import { useTheme } from "@/components/providers/theme-provider";
import type { Locale } from "@/lib/i18n/translations";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  phone: z.string().max(40).optional().default(""),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function SettingsPage() {
  const { uid, profile, subscription, refreshUserData } = useAppContext();
  const { toast } = useAppToast();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", phone: "" },
  });

  useEffect(() => {
    reset({
      name: profile?.name ?? "",
      phone: profile?.phoneNumber ?? "",
    });
  }, [profile?.name, profile?.phoneNumber, reset]);

  const saveProfile = async (values: ProfileFormValues) => {
    if (!uid || !profile) return;
    const updateProfileFn = httpsCallable(functions, "updateProfileV1");
    await updateProfileFn({ name: values.name, phoneNumber: values.phone });
    await refreshUserData();
    toast({ title: "Settings saved", variant: "success" });
  };

  return (
    <ProtectedRoute section="settings">
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Manage profile, preferences, and account access.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{profile?.role ?? "N/A"}</Badge>
            <Badge variant="success">{subscription?.tier ?? "Basic"}</Badge>
            <Badge>{subscription?.status ?? "active"}</Badge>
          </div>
        </Card>

        <form onSubmit={handleSubmit(saveProfile)}>
          <Card className="grid gap-3">
            <Input label="Full name" {...register("name")} error={errors.name?.message} />
            <Input label="Phone number" {...register("phone")} error={errors.phone?.message} />
            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </Card>
        </form>

        <Card className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Language</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
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
              value={theme}
              onChange={(event) => setTheme(event.target.value as "light" | "dark")}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </Card>
      </section>
    </ProtectedRoute>
  );
}

