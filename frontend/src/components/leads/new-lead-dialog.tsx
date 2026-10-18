"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { api, describeError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter the person's name."),
    phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "Use an international number, e.g. +1 415 555 0134.").or(z.literal("")),
    email: z.email("Enter a valid email.").or(z.literal("")),
    message: z.string().trim().min(3, "Say what they asked for, in a sentence."),
  })
  .refine((v) => v.phone || v.email, { message: "Add a phone number or an email so someone can reply.", path: ["phone"] });
type Values = z.infer<typeof schema>;

export function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { name: "", phone: "", email: "", message: "" } });
  const m = useMutation({
    mutationFn: (v: Values) => api().leads.create(v),
    onSuccess: (l) => {
      toast.success(l.ownerName ? `Lead created and assigned to ${l.ownerName}` : "Lead created", {
        description: l.ownerName ? "Their acknowledgement clock has started." : "Nobody is available, so it's waiting in the recovery queue.",
      });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      form.reset();
      setOpen(false);
    },
  });
  const err = m.error ? describeError(m.error) : null;
  const { errors } = form.formState;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon size={16} weight="bold" aria-hidden /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a lead by hand" description="For phone calls and walk-ins. It's assigned by the same round-robin rules as web and WhatsApp leads.">
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))} noValidate className="flex flex-col gap-4">
          <Field label="Name" error={errors.name?.message} required>
            {(p) => <Input {...p} autoComplete="off" {...form.register("name")} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" error={errors.phone?.message}>
              {(p) => <Input {...p} type="tel" inputMode="tel" {...form.register("phone")} />}
            </Field>
            <Field label="Email" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...form.register("email")} />}
            </Field>
          </div>
          <Field label="What do they need?" error={errors.message?.message} required>
            {(p) => <Textarea {...p} rows={3} {...form.register("message")} />}
          </Field>
          {err && (
            <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
              {err.title} {err.action}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending}>
              Create and assign
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
