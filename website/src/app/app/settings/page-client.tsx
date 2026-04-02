"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { httpsCallable } from "firebase/functions";
import { Globe2, Palette, Settings2, ShieldCheck, Sparkles } from "lucide-react";
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
  phone: z.string().max(40),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function SettingsClient() {
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
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Settings
              </p>
              <h1 className="dashboard-title mt-5">Profile and workspace preferences</h1>
              <p className="dashboard-copy mt-4">Manage profile, preferences, and account access.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{profile?.role ?? "N/A"}</Badge>
              <Badge variant="success">{subscription?.tier ?? "Basic"}</Badge>
              <Badge>{subscription?.status ?? "active"}</Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
          <form onSubmit={handleSubmit(saveProfile)}>
            <Card className="grid gap-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Profile</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Update the details used across the dashboard and shared company flows.
                  </p>
                </div>
              </div>
              <Input label="Full name" {...register("name")} error={errors.name?.message} />
              <Input label="Phone number" {...register("phone")} error={errors.phone?.message} />
              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save profile"}
                </Button>
              </div>
            </Card>
          </form>

          <Card className="grid gap-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Account status</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Role, tier, and account state are surfaced here for quick verification.
                </p>
              </div>
            </div>
            <div className="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <span className="text-slate-500 dark:text-slate-400">Email</span>
                <p className="mt-1 font-medium text-slate-950 dark:text-white">{profile?.email ?? "N/A"}</p>
              </div>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <Badge>{profile?.role ?? "N/A"}</Badge>
                <Badge variant="success">{subscription?.tier ?? "Basic"}</Badge>
                <Badge>{subscription?.status ?? "active"}</Badge>
              </div>
            </div>
          </Card>
        </div>

        <Card className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Globe2 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Language</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">Choose the interface locale.</p>
              </div>
            </div>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
              className="dashboard-field h-11"
            >
              <option value="en">English</option>
              <option value="he">Hebrew</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Palette className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Theme</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">Adjust the dashboard appearance.</p>
              </div>
            </div>
            <select
              value={theme}
              onChange={(event) => setTheme(event.target.value as "light" | "dark")}
              className="dashboard-field h-11"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </Card>
      </section>
    </ProtectedRoute>
  );
}
