"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAppToast } from "@/hooks/use-toast";

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
    await addDoc(collection(db, "contact_requests"), {
      ...values,
      createdAt: new Date().toISOString(),
      status: "new",
    });
    toast({
      title: "Message sent",
      description: "We received your request and will get back to you shortly.",
      variant: "success",
    });
    reset();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3">
      <Input label="Name" {...register("name")} error={errors.name?.message} />
      <Input label="Work Email" type="email" {...register("email")} error={errors.email?.message} />
      <Input label="Company" {...register("company")} error={errors.company?.message} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Message</span>
        <textarea
          {...register("message")}
          rows={5}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {errors.message?.message ? <span className="text-xs text-red-600">{errors.message.message}</span> : null}
      </label>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending..." : "Send message"}
      </Button>
      <p className="text-xs text-slate-500 dark:text-slate-400">Support email placeholder: support@smart-job.example</p>
    </form>
  );
}

