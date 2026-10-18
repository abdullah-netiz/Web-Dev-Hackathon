"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, describeError } from "@/lib/api";
import { BatonMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";

const schema = z
  .object({
    name: z.string().trim().min(2, "Tell us your name.").max(80),
    phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "Use a number we can call or WhatsApp, e.g. +1 415 555 0134.").or(z.literal("")),
    email: z.email("That email doesn't look right.").or(z.literal("")),
    company: z.string().trim().max(80).optional(),
    message: z.string().trim().min(10, "A sentence or two helps us send the right person.").max(2000),
    website: z.string().max(0).optional(),
  })
  .refine((v) => v.phone || v.email, { message: "Leave a phone number or an email so we can reply.", path: ["phone"] });
type Values = z.infer<typeof schema>;

export function LeadForm({ slug }: { slug: string }) {
  const router = useRouter();
  const ws = useQuery({ queryKey: ["public-ws", slug], queryFn: () => api().public.workspace(slug), retry: false });
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { name: "", phone: "", email: "", company: "", message: "", website: "" } });
  const submit = useMutation({
    mutationFn: (v: Values) => api().public.submitLead(slug, v),
    onSuccess: ({ reference }) => router.push(`/f/${slug}/sent?ref=${encodeURIComponent(reference)}&name=${encodeURIComponent(form.getValues("name").split(" ")[0] ?? "")}`),
  });
  const { errors } = form.formState;
  const err = submit.error ? describeError(submit.error) : null;

  if (ws.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5">
        <h1 className="display text-5xl text-ink">This form isn&apos;t available.</h1>
        <p className="mt-4 text-lg text-ink-soft">{describeError(ws.error).title} Check the link you were given, or contact the company directly.</p>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col justify-between bg-brand px-5 py-8 text-on-brand sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-2 text-on-brand">
          <BatonMark className="h-5 w-5" />
          <span className="text-[15px] font-medium">{ws.data ? ws.data.name : <Skeleton className="h-4 w-32 opacity-30" />}</span>
        </div>
        <div className="py-12 lg:py-0">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="display max-w-[12ch] text-[52px] text-on-brand sm:text-[72px] xl:text-[88px]"
          >
            Ask us anything.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className="mt-6 max-w-md text-lg leading-relaxed text-on-brand/85">
            The moment you send this, one named person on our team becomes responsible for replying to you. If they can&apos;t, it goes straight to someone who can.
          </motion.p>
        </div>
        <p className="hidden text-[13px] text-on-brand/60 lg:block">Your details are used only to reply to this request.</p>
      </section>

      <section className="flex items-center px-5 py-10 sm:px-10 lg:px-14">
        <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} noValidate className="flex w-full max-w-lg flex-col gap-5" aria-label={`Contact ${ws.data?.name ?? "us"}`}>
          <Field label="Your name" error={errors.name?.message} required>
            {(p) => <Input {...p} autoComplete="name" {...form.register("name")} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone or WhatsApp" error={errors.phone?.message}>
              {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} />}
            </Field>
            <Field label="Email" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="email" {...form.register("email")} />}
            </Field>
          </div>
          <Field label="Company" hint="Only if you're asking for a business.">
            {(p) => <Input {...p} autoComplete="organization" {...form.register("company")} />}
          </Field>
          <Field label="How can we help?" error={errors.message?.message} required>
            {(p) => <Textarea {...p} rows={5} {...form.register("message")} />}
          </Field>
          <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label>
              Leave this empty
              <input tabIndex={-1} autoComplete="off" {...form.register("website")} />
            </label>
          </div>
          {err && (
            <div role="alert" className="rounded-[3px] bg-signal-tint px-4 py-3 text-sm">
              <p className="font-semibold text-signal">{err.title}</p>
              <p className="text-ink">{err.action ?? "Your message is still here; try sending it again."}</p>
            </div>
          )}
          <Button type="submit" size="lg" loading={submit.isPending} className="w-full justify-center sm:w-auto sm:self-start">
            Send to {ws.data?.name ?? "the team"}
          </Button>
        </form>
      </section>
    </main>
  );
}
