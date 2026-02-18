"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";
import { buildAuthedJsonHeaders, withDevUidFallback } from "@/lib/firebase/client-auth";

const schema = z.object({
  requestedTier: z.enum(["Solo", "Team", "Enterprise"]),
  message: z.string().min(10, "Please provide a short business reason"),
});

type FormValues = z.infer<typeof schema>;

const tierDetails = [
  { name: "Basic", desc: "Clients + Documents only" },
  { name: "Solo", desc: "Jobs + Personal inventory + Docs" },
  { name: "Team", desc: "Manager/Worker workflows + company inventory" },
  { name: "Enterprise", desc: "All features + priority support (contact)" },
];

export default function UpgradePage() {
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
      const response = await fetch("/api/upgrades/request", {
        method: "POST",
        headers: await buildAuthedJsonHeaders(),
        body: JSON.stringify(
          withDevUidFallback(
            {
              currentTier: subscription?.tier ?? "Basic",
              requestedTier: values.requestedTier,
              message: values.message,
            },
            uid,
          ),
        ),
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
      <section className="grid gap-4">
        <Card>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Upgrade</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Billing is not enabled yet. Use this form to request a manual tier upgrade.
          </p>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tierDetails.map((tier) => (
            <Card key={tier.name}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tier.name}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{tier.desc}</p>
            </Card>
          ))}
        </div>

        <Card>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Request upgrade</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleSubmit(onSubmit)}>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Requested tier</span>
              <select
                {...register("requestedTier")}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900"
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
      </section>
    </ProtectedRoute>
  );
}
