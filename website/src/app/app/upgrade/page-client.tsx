"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";

const schema = z.object({
  requestedTier: z.enum(["Solo", "Team", "Enterprise"]),
  message: z.string().min(10, "Please provide a short business reason"),
});

type FormValues = z.infer<typeof schema>;

const tierDetails = [
  { name: "Basic", desc: "Clients + Documents only" },
  { name: "Solo", desc: "Jobs + Personal inventory + Docs" },
  { name: "Team", desc: "manager/worker workflows + company inventory" },
  { name: "Enterprise", desc: "All features + priority support (contact)" },
];

export default function UpgradeClient() {
  const { uid, subscription } = useAppContext();
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { requestedTier: "Team", message: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!uid) return;
    try {
      const response = await fetch("/api/callable", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify({
          operation: "requestUpgradeV1",
          payload: {
            currentTier: subscription?.tier ?? "Basic",
            requestedTier: values.requestedTier,
            message: values.message,
          },
        }),
      });
      const payload = (await response.json()) as ClientApiResponse<{ requestId: string }>;
      if (!response.ok || !payload.ok) {
        toast({
          title: "Upgrade request failed",
          description: getClientApiErrorMessage(payload, "Request failed"),
          variant: "error",
        });
        return;
      }
      toast({
        title: "Upgrade request sent",
        description: "Your request was saved and will be reviewed manually.",
        variant: "success",
      });
      reset();
    } catch (error) {
      toast({
        title: "Upgrade request failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  return (
    <ProtectedRoute section="upgrade">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade
              </p>
              <h1 className="dashboard-title mt-5">Request a higher tier</h1>
              <p className="dashboard-copy mt-4">
                Billing is not enabled yet. Use this form to request a manual tier upgrade.
              </p>
            </div>
            <div className="dashboard-stat min-w-60">
              <p className="text-sm text-slate-500 dark:text-slate-400">Current tier</p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
                {subscription?.tier ?? "Basic"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tierDetails.map((tier) => (
            <Card
              key={tier.name}
              className={tier.name === (subscription?.tier ?? "Basic") ? "bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(8,145,178,0.78))] text-white dark:bg-[linear-gradient(145deg,rgba(103,232,249,0.9),rgba(224,242,254,0.95))] dark:text-slate-950" : undefined}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className={tier.name === (subscription?.tier ?? "Basic") ? "text-lg font-semibold text-white dark:text-slate-950" : "text-lg font-semibold text-slate-900 dark:text-slate-100"}>{tier.name}</h2>
                {tier.name === (subscription?.tier ?? "Basic") ? <Badge className="bg-white/15 text-white dark:bg-slate-950/10 dark:text-slate-950">Current</Badge> : null}
              </div>
              <p className={tier.name === (subscription?.tier ?? "Basic") ? "mt-2 text-sm text-slate-200 dark:text-slate-700" : "mt-2 text-sm text-slate-600 dark:text-slate-300"}>{tier.desc}</p>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Request upgrade</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Share the next tier you need and the business reason behind it.
                </p>
              </div>
            </div>
          <form className="mt-4 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Requested tier</span>
              <select
                {...register("requestedTier")}
                className="dashboard-field h-11"
              >
                <option value="Solo">Solo</option>
                <option value="Team">Team</option>
                <option value="Enterprise">Enterprise</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Message</span>
              <textarea
                {...register("message")}
                rows={5}
                className="dashboard-field min-h-36 resize-none"
              />
              {errors.message?.message ? <span className="text-xs text-red-600">{errors.message.message}</span> : null}
            </label>

            <div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </form>
          <div className="mt-4">
            <Input label="Current tier" value={subscription?.tier ?? "Basic"} disabled />
          </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Manual review</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Requests are stored for admin review rather than auto-approved at checkout.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                Current tier and requested tier are saved together for review context.
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                <p className="inline-flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                  <ArrowUpRight className="h-4 w-4" />
                  Move to Team or Enterprise when the workflow needs it.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </ProtectedRoute>
  );
}
