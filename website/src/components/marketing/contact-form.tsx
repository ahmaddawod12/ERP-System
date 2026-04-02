"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";
import type { ClientApiResponse } from "@/lib/api/client";
import { getClientApiErrorMessage } from "@/lib/api/client";

const schema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  company: z.string().min(2, "Company is required"),
  message: z.string().min(8, "Message should be at least 8 characters"),
});

type ContactFormValues = z.infer<typeof schema>;

export function ContactForm() {
  const { toast } = useAppToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: ContactFormValues) => {
    try {
      const response = await fetch("/api/contact/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
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
    } catch (error) {
      toast({
        title: "Message failed",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "error",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
      <Input label="Name" placeholder="Your name" {...register("name")} error={errors.name?.message} />
      <Input
        label="Work Email"
        type="email"
        placeholder="name@company.com"
        {...register("email")}
        error={errors.email?.message}
      />
      <Input label="Company" placeholder="Company name" {...register("company")} error={errors.company?.message} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Message</span>
        <textarea
          {...register("message")}
          rows={5}
          placeholder="What kind of workflow, rollout, or support do you need?"
          className="min-h-36 w-full resize-none rounded-[1.2rem] border border-slate-300 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-100"
        />
        {errors.message?.message ? <span className="text-xs text-red-600">{errors.message.message}</span> : null}
      </label>
      <Button type="submit" disabled={isSubmitting} className="rounded-2xl">
        {isSubmitting ? "Sending..." : "Send message"}
      </Button>
      <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">
        Share your current workflow, team size, and the modules you want first. The more specific the request, the more useful the reply.
      </p>
    </form>
  );
}
