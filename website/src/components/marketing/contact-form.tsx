"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppToast } from "@/hooks/use-toast";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";

const schema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  company: z.string().min(2, "Company is required"),
  message: z.string().min(8, "Message should be at least 8 characters"),
  website: z.string().max(0),
});

type ContactFormValues = z.infer<typeof schema>;
type ChallengeConfig =
  | { provider: "recaptcha-enterprise"; action: string; siteKey: string }
  | { provider: "local-proof"; action: string; token: string };

declare global {
  interface Window {
    grecaptcha?: {
      enterprise: {
        ready(callback: () => void): void;
        execute(siteKey: string, options: { action: string }): Promise<string>;
      };
    };
  }
}

function loadEnterpriseScript(siteKey: string): Promise<void> {
  const id = "smart-job-recaptcha-enterprise";
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    script.id = id;
    script.async = true;
    script.defer = true;
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Contact verification failed to load")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

async function enterpriseToken(config: Extract<ChallengeConfig, { provider: "recaptcha-enterprise" }>) {
  await loadEnterpriseScript(config.siteKey);
  const enterprise = window.grecaptcha?.enterprise;
  if (!enterprise) throw new Error("Contact verification is unavailable");
  await new Promise<void>((resolve) => enterprise.ready(resolve));
  return enterprise.execute(config.siteKey, { action: config.action });
}

async function loadChallengeConfig(): Promise<ChallengeConfig> {
  const response = await fetch("/api/contact/challenge", { cache: "no-store" });
  if (!response.ok) throw new Error("Contact verification is unavailable");
  const config = await response.json() as ChallengeConfig;
  if (config.provider === "recaptcha-enterprise") await loadEnterpriseScript(config.siteKey);
  return config;
}

export function ContactForm() {
  const { toast } = useAppToast();
  const [challengeConfig, setChallengeConfig] = useState<ChallengeConfig | null>(null);
  const [challengeUnavailable, setChallengeUnavailable] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { website: "" },
  });

  useEffect(() => {
    let cancelled = false;
    loadChallengeConfig()
      .then((config) => {
        if (!cancelled) setChallengeConfig(config);
      })
      .catch(() => {
        if (!cancelled) setChallengeUnavailable(true);
      });
    return () => { cancelled = true; };
  }, []);

  const onSubmit = async (values: ContactFormValues) => {
    try {
      if (!challengeConfig) throw new Error("Contact verification is unavailable");
      const challengeToken = challengeConfig.provider === "local-proof"
        ? challengeConfig.token
        : await enterpriseToken(challengeConfig);
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const response = await fetch("/api/contact/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          ...values,
          challenge: challengeConfig.action,
          challengeToken,
        }),
      });
      const payload = (await response.json()) as ClientApiResponse<{ requestId: string }>;
      if (!response.ok || !payload.ok) {
        toast({
          title: "Message failed",
          description: getClientApiErrorMessage(payload, "Please try again later."),
          variant: "error",
        });
        return;
      }
      toast({
        title: "Message sent",
        description: "We received your request and will get back to you shortly.",
        variant: "success",
      });
      reset();
      idempotencyKeyRef.current = null;
      if (challengeConfig.provider === "local-proof") {
        setChallengeConfig(await loadChallengeConfig());
      }
    } catch (error) {
      toast({
        title: "Message failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  return (
    <form onSubmit={(event) => { void handleSubmit(onSubmit)(event); }} className="grid gap-4">
      <Input label="Name" placeholder="Your name" {...register("name")} error={errors.name?.message} />
      <Input
        label="Work Email"
        type="email"
        placeholder="name@company.com"
        {...register("email")}
        error={errors.email?.message}
      />
      <Input label="Company" placeholder="Company name" {...register("company")} error={errors.company?.message} />
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" {...register("website")} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Message</span>
        <textarea
          {...register("message")}
          rows={5}
          placeholder="What kind of workflow, rollout, or support do you need?"
          className="min-h-36 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {errors.message?.message ? <span className="text-xs text-red-600">{errors.message.message}</span> : null}
      </label>
      <Button type="submit" disabled={isSubmitting || !challengeConfig || challengeUnavailable}>
        {isSubmitting ? "Sending..." : challengeUnavailable ? "Verification unavailable" : "Send message"}
      </Button>
      <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
        This site is protected by reCAPTCHA Enterprise. Share your workflow, team size, and the modules you want first.
      </p>
    </form>
  );
}
